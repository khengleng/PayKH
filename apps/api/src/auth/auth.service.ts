import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hashPassword, verifyPassword, ids } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { LoginDto, RegisterDto } from './dto';
import { MfaService } from './mfa.service';

/** A valid bcrypt hash used only to equalize login timing for unknown emails. */
const DECOY_HASH = '$2a$12$6OLD4IHTLvrnE7I8TXy/4eUd4pNDXYqkdBYqi22Yv.fVHmzHvAWk.';

export interface AuthResult {
  token: string;
  user: { id: string; email: string; name: string | null };
  organization: { id: string; name: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mfa: MfaService,
  ) {}

  private sign(userId: string, email: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId, email });
  }

  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw ApiError.invalidRequest('An account with this email already exists');
    }

    const passwordHash = await hashPassword(dto.password);
    const orgName = dto.organizationName?.trim() || `${dto.name ?? 'My'} Organization`;

    // Create user + organization + owner membership atomically.
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, name: dto.name ?? null },
      });
      const org = await tx.organization.create({
        data: { id: ids.organization(), name: orgName },
      });
      await tx.organizationMember.create({
        data: { organizationId: org.id, userId: user.id, role: 'OWNER' },
      });
      return { user, org };
    });

    // NOTE: we deliberately do NOT auto-join pending invitations on register.
    // Since registration doesn't verify email ownership, auto-join would let an
    // attacker claim an invited email. Joining requires the invitation token
    // (delivered to the invited mailbox) via POST /team/invitations/accept.

    const token = await this.sign(result.user.id, result.user.email);
    return {
      token,
      user: { id: result.user.id, email: result.user.email, name: result.user.name },
      organization: { id: result.org.id, name: result.org.name },
    };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { include: { organization: true } } },
    });
    // Always run bcrypt (against a decoy hash when the user/hash is absent) so
    // login timing does not reveal whether an account exists (user enumeration).
    const hash = user?.passwordHash ?? DECOY_HASH;
    const passwordOk = await verifyPassword(dto.password, hash);
    if (!user || !user.passwordHash || !passwordOk) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    // Enforce MFA when enabled.
    if (user.mfaEnabled && user.mfaSecret) {
      const valid = await this.mfa.verifyLogin(user.mfaSecret, dto.mfaCode);
      if (!valid) {
        throw new ApiError('unauthorized', 'MFA code required', 401);
      }
    }

    const primary = user.memberships[0];
    const token = await this.sign(user.id, user.email);
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name },
      organization: primary
        ? { id: primary.organization.id, name: primary.organization.name }
        : { id: '', name: '' },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { include: { organization: true } } },
    });
    if (!user) throw ApiError.unauthorized();
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      is_platform_admin: user.isPlatformAdmin,
      organizations: user.memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        role: m.role,
      })),
    };
  }
}
