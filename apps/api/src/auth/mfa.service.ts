import { Injectable } from '@nestjs/common';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { ApiError } from '../common/api-error';

/**
 * TOTP-based MFA. The secret is stored AES-GCM-encrypted; it is set at setup
 * time but only enforced once the user confirms a valid code (enable).
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async setup(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.unauthorized();
    if (user.mfaEnabled) throw ApiError.invalidRequest('MFA is already enabled');
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: this.crypto.encrypt(secret) },
    });
    return { secret, otpauth_url: otpauthUrl(secret, user.email) };
  }

  async enable(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecret) throw ApiError.invalidRequest('Run MFA setup first');
    const secret = this.crypto.decrypt(user.mfaSecret);
    if (!verifyTotp(secret, code)) throw ApiError.invalidRequest('Invalid MFA code');
    await this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
    return { mfa_enabled: true };
  }

  async disable(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaEnabled || !user.mfaSecret) throw ApiError.invalidRequest('MFA is not enabled');
    const secret = this.crypto.decrypt(user.mfaSecret);
    if (!verifyTotp(secret, code)) throw ApiError.invalidRequest('Invalid MFA code');
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null },
    });
    return { mfa_enabled: false };
  }

  /** Verify a login-time code for a user with MFA enabled. */
  async verifyLogin(mfaSecretCiphertext: string, code: string | undefined): Promise<boolean> {
    if (!code) return false;
    const secret = this.crypto.decrypt(mfaSecretCiphertext);
    return verifyTotp(secret, code);
  }
}
