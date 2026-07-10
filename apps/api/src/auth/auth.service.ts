import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hashPassword, verifyPassword, ids } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { LoginDto, RegisterDto } from './dto';
import { MfaService } from './mfa.service';

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

    // Auto-accept any pending invitations addressed to this email.
    const invites = await this.prisma.invitation.findMany({
      where: { email, status: 'pending', expiresAt: { gt: new Date() } },
    });
    for (const invite of invites) {
      await this.prisma.$transaction([
        this.prisma.organizationMember.upsert({
          where: { organizationId_userId: { organizationId: invite.organizationId, userId: result.user.id } },
          create: { organizationId: invite.organizationId, userId: result.user.id, role: invite.role },
          update: {},
        }),
        this.prisma.invitation.update({ where: { id: invite.id }, data: { status: 'accepted' } }),
      ]);
    }

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
    // Constant-ish work whether or not the user exists to reduce enumeration.
    const ok =
      user?.passwordHash && (await verifyPassword(dto.password, user.passwordHash));
    if (!user || !ok) {
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
      organizations: user.memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        role: m.role,
      })),
    };
  }
}
