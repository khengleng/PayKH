import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Logger,
  Module,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  createParamDecorator,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import { verifyEd25519 } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

/**
 * PayKH loyalty mini-app for banking apps.
 *
 * A bank ("partner") embeds the mini-app in its app and vouches for its
 * already-authenticated user by minting an **EdDSA-signed handoff token** (a JWT
 * signed with the partner's private key). PayKH verifies it against the
 * partner's registered Ed25519 public key, maps `(partner, bankUserId)` to a
 * unified ConsumerAccount, and issues a short-lived PayKH **mini-app session**
 * JWT that the mini-app UI uses to read the customer's loyalty across merchants.
 *
 * The bank never shares a password with PayKH — the signature IS the trust.
 */

interface HandoffClaims {
  iss: string; // partner id
  sub: string; // the bank's stable user id
  phone?: string;
  name?: string;
  iat?: number;
  exp: number;
}

class SessionDto {
  @IsString() partner_id!: string;
  @IsString() token!: string; // the bank-signed EdDSA JWT
}

class RedeemDto {
  @IsString() reward_id!: string;
  @IsString() customer_id!: string;
}

const MAX_SKEW_S = 5 * 60;

@Injectable()
export class MiniAppService {
  private readonly logger = new Logger('MiniApp');
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Verify a partner's signed handoff token → unified session for the mini-app. */
  async exchange(partnerId: string, token: string) {
    const partner = await this.prisma.partner.findUnique({ where: { id: partnerId } });
    if (!partner || !partner.active) throw new UnauthorizedException('unknown or inactive partner');

    const parts = token.split('.');
    if (parts.length !== 3) throw new BadRequestException('malformed handoff token');
    let header: { alg?: string; kid?: string };
    let claims: HandoffClaims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('handoff token is not valid JSON');
    }
    if (header.alg !== 'EdDSA') throw new BadRequestException('handoff token alg must be EdDSA');
    if (header.kid && header.kid !== partner.keyId) throw new UnauthorizedException('unknown key id');

    // Verify the Ed25519 signature over `${header}.${payload}`.
    const signingInput = `${parts[0]}.${parts[1]}`;
    const signatureBase64 = Buffer.from(parts[2], 'base64url').toString('base64');
    let valid = false;
    try {
      valid = verifyEd25519(partner.publicKeyPem, signingInput, signatureBase64);
    } catch {
      valid = false;
    }
    if (!valid) {
      this.logger.warn(`mini-app handoff signature mismatch for partner ${partnerId}`);
      throw new UnauthorizedException('handoff signature invalid');
    }

    const now = Math.floor(Date.now() / 1000);
    if (!claims.exp || claims.exp < now) throw new UnauthorizedException('handoff token expired');
    if (claims.iat && claims.iat - now > MAX_SKEW_S) throw new UnauthorizedException('handoff token not yet valid');
    if (claims.iss !== partnerId) throw new UnauthorizedException('issuer / partner mismatch');
    if (!claims.sub) throw new BadRequestException('handoff token missing sub (bank user id)');

    // Map (partner, bankUserId) → unified consumer account; keep phone/name fresh.
    const account = await this.prisma.consumerAccount.upsert({
      where: { partnerId_bankUserId: { partnerId, bankUserId: claims.sub } },
      create: { partnerId, bankUserId: claims.sub, phone: claims.phone ?? null, name: claims.name ?? null },
      update: { ...(claims.phone ? { phone: claims.phone } : {}), ...(claims.name ? { name: claims.name } : {}) },
    });

    const sessionToken = await this.jwt.signAsync(
      { sub: account.id, typ: 'miniapp', partner: partnerId },
      { expiresIn: '1h' },
    );
    this.logger.log(`mini-app session issued for consumer ${account.id} (partner ${partner.name})`);
    return { session_token: sessionToken, expires_in: 3600, consumer: { id: account.id, name: account.name, has_phone: !!account.phone } };
  }

  /** The consumer's loyalty across every merchant they've shopped at (by phone). */
  async me(accountId: string) {
    const account = await this.prisma.consumerAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new UnauthorizedException('session no longer valid');
    if (!account.phone) {
      return { consumer: { id: account.id, name: account.name, phone: null }, total_points: 0, merchants: [] };
    }
    const customers = await this.prisma.customer.findMany({
      where: { phone: account.phone },
      include: { store: { include: { branding: true, organization: true } }, tier: true },
    });
    const merchants = customers.map((c) => {
      // Transparency: only claim trustee backing when this issuer is a genuine,
      // live trustee-backed stablecoin issuer (org.stablecoinTrusteeBank set).
      // Null for everyone today → plain loyalty points, never a false badge.
      const trusteeBank = c.store.organization.stablecoinTrusteeBank ?? null;
      return {
        customer_id: c.id,
        store_id: c.storeId,
        merchant_name: c.store.branding?.displayName || c.store.name,
        logo_url: c.store.branding?.logoUrl ?? null,
        points: c.pointsBalance,
        tier: c.tier?.name ?? null,
        backing: trusteeBank
          ? { type: 'stablecoin', trustee_bank: trusteeBank, label: `Backed by ${trusteeBank}` }
          : { type: 'loyalty_points', trustee_bank: null, label: 'Loyalty points' },
      };
    });
    return {
      consumer: { id: account.id, name: account.name, phone: account.phone },
      total_points: merchants.reduce((s, m) => s + m.points, 0),
      merchants,
    };
  }
}

/** Validates the PayKH mini-app session JWT (typ=miniapp) and attaches the account id. */
@Injectable()
export class MiniAppGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { consumerAccountId?: string }>();
    const auth = req.header('authorization');
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ: string }>(auth.slice(7));
      if (payload.typ !== 'miniapp') throw new UnauthorizedException();
      req.consumerAccountId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}

export const ConsumerId = createParamDecorator((_d, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest<Request & { consumerAccountId?: string }>().consumerAccountId ?? '';
});

@ApiTags('miniapp')
@Controller('miniapp')
export class MiniAppController {
  constructor(private readonly svc: MiniAppService) {}

  @Post('session')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 60, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Exchange a bank-signed handoff token for a mini-app session' })
  session(@Body() dto: SessionDto) {
    return this.svc.exchange(dto.partner_id, dto.token);
  }

  @Get('me')
  @UseGuards(MiniAppGuard)
  @ApiOperation({ summary: "The consumer's loyalty across all merchants (mini-app session)" })
  me(@ConsumerId() accountId: string) {
    return this.svc.me(accountId);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [MiniAppController],
  providers: [MiniAppService, MiniAppGuard],
})
export class MiniAppModule {}
