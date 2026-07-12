import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { hashPassword, verifyPassword, ids, prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { LoginDto, RegisterDto } from './dto';
import { MfaService } from './mfa.service';
import { EmailService } from '../email/email.service';

/** A valid bcrypt hash used only to equalize login timing for unknown emails. */
const DECOY_HASH = '$2a$12$6OLD4IHTLvrnE7I8TXy/4eUd4pNDXYqkdBYqi22Yv.fVHmzHvAWk.';

export interface AuthResult {
  token: string;
  user: { id: string; email: string; name: string | null };
  organization: { id: string; name: string };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mfa: MfaService,
    private readonly config: ConfigService,
    // EmailService is resolved lazily (moduleRef) to avoid a module cycle —
    // AuthModule is a hub imported everywhere and EmailService → SettingsService.
    private readonly moduleRef: ModuleRef,
  ) {}

  private sign(userId: string, email: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId, email });
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Begin a password reset. Always succeeds (no account enumeration). If the
   * email maps to a user, a single-use, 1-hour token is emailed as a reset link
   * (from the configured EMAIL_FROM, e.g. contact@cambobia.com).
   */
  async forgotPassword(rawEmail: string): Promise<{ ok: true }> {
    const email = rawEmail.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && user.passwordHash) {
      // Invalidate any outstanding tokens, then issue a fresh one.
      await this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      const raw = randomBytes(32).toString('base64url');
      await this.prisma.passwordResetToken.create({
        data: { id: prefixedId('prt'), userId: user.id, tokenHash: this.hashToken(raw), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      });
      const base = this.config.get<string>('dashboardBaseUrl') ?? '';
      const url = `${base}/reset-password?token=${raw}`;
      const mailer = this.moduleRef.get(EmailService, { strict: false });
      await mailer.send({
        to: email,
        subject: 'Reset your PayKH password',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:auto">
          <h2 style="color:#1E5BD6">Reset your password</h2>
          <p>We received a request to reset the password for your PayKH account. This link expires in <b>1 hour</b> and can be used once.</p>
          <p><a href="${url}" style="display:inline-block;background:#1E5BD6;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Reset password</a></p>
          <p style="color:#64748b;font-size:13px">If you didn't request this, you can safely ignore this email — your password won't change.</p>
          <p style="color:#94a3b8;font-size:12px">Or paste this link: ${url}</p>
        </div>`,
        text: `Reset your PayKH password (expires in 1 hour): ${url}`,
      });
      this.logger.log(`password reset requested for ${email}`);
    }
    return { ok: true };
  }

  /** Complete a password reset with a valid, unexpired, unused token. */
  async resetPassword(rawToken: string, newPassword: string): Promise<{ ok: true }> {
    if (!newPassword || newPassword.length < 8) throw ApiError.invalidRequest('Password must be at least 8 characters');
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: this.hashToken(rawToken) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw ApiError.invalidRequest('This reset link is invalid or has expired');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // Invalidate any other outstanding tokens for this user.
      this.prisma.passwordResetToken.deleteMany({ where: { userId: record.userId, usedAt: null } }),
    ]);
    this.logger.log(`password reset completed for user ${record.userId}`);
    return { ok: true };
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
