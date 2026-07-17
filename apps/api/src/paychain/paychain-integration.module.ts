import { Body, Controller, Delete, Get, Injectable, Logger, Module, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { ApiError } from '../common/api-error';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthModule } from '../auth/auth.module';
import { requireMembership } from '../auth/rbac';
import { assertSafeUrl } from '../common/ssrf';
import { FeatureFlagsService } from '../feature-flags/feature-flags.module';

const DEFAULT_BASE_URL = 'https://api.paychain.cambobia.com';

export class UpsertPayChainDto {
  @IsOptional() @IsUrl({ require_tld: false }) @MaxLength(200) base_url?: string;
  @IsString() @MinLength(1) @MaxLength(200) client_id!: string;
  /** Write-only. Omit on update to keep the stored secret. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(400) client_secret?: string;
  @IsString() @MinLength(1) @MaxLength(200) loyalty_asset_id!: string;
}

/**
 * A tenant's own PayChain connection (wallet-as-a-service).
 *
 * Configured by the organization OWNER, not a platform administrator: each
 * tenant brings their own PayChain client credentials and loyalty asset, so the
 * platform never holds or brokers them. That is also why this is separate from
 * SystemSetting, which is platform-wide and platform-admin-only.
 *
 * The secret is AES-256-GCM encrypted at rest via the same CryptoService that
 * protects ProviderCredential, and is never returned — reads get a masked
 * preview only.
 */
@Injectable()
export class PayChainIntegrationService {
  private readonly logger = new Logger('PayChainIntegration');

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /**
   * Only the tenant owner may see or change value-moving credentials. Analysts
   * and developers are members of the org but have no business reading them,
   * and a platform admin configuring a tenant's own PayChain account would
   * defeat the point of the tenant holding it.
   */
  private assertOwner(user: AuthUser, orgId: string) {
    const role = requireMembership(user, orgId);
    if (role !== 'owner') {
      throw ApiError.forbidden(`Your role (${role}) cannot manage the PayChain integration — owner only`);
    }
  }

  /** Reject a base URL that points anywhere internal — this value is tenant-supplied
   *  and the server makes requests to it, so it is an SSRF sink. */
  private async assertSafeBaseUrl(rawUrl: string) {
    const allowPrivate = this.config.get<string>('nodeEnv') !== 'production';
    const check = await assertSafeUrl(rawUrl, allowPrivate);
    if (!check.ok) throw ApiError.invalidRequest(`PayChain base URL rejected: ${check.reason}`);
  }

  async get(user: AuthUser, orgId: string) {
    this.assertOwner(user, orgId);
    const row = await this.prisma.payChainIntegration.findUnique({ where: { organizationId: orgId } });
    if (!row) {
      return {
        configured: false,
        base_url: DEFAULT_BASE_URL,
        enabled: await this.flags.isEnabled('paychain.enabled', orgId),
        shadow_mode: await this.flags.isEnabled('paychain.shadow_mode.enabled', orgId),
      };
    }
    return {
      configured: true,
      base_url: row.baseUrl,
      client_id: row.clientId,
      client_secret_preview: this.mask(row.clientId ? this.safeDecrypt(row.secretCiphertext) : undefined),
      loyalty_asset_id: row.loyaltyAssetId,
      enabled: await this.flags.isEnabled('paychain.enabled', orgId),
      shadow_mode: await this.flags.isEnabled('paychain.shadow_mode.enabled', orgId),
      last_tested_at: row.lastTestedAt,
      last_test_ok: row.lastTestOk,
      last_test_detail: row.lastTestDetail,
      updated_at: row.updatedAt,
    };
  }

  async upsert(user: AuthUser, orgId: string, dto: UpsertPayChainDto) {
    this.assertOwner(user, orgId);
    const baseUrl = dto.base_url ?? DEFAULT_BASE_URL;
    await this.assertSafeBaseUrl(baseUrl);

    const existing = await this.prisma.payChainIntegration.findUnique({ where: { organizationId: orgId } });
    if (!dto.client_secret && !existing) {
      throw ApiError.invalidRequest('client_secret is required when first configuring PayChain');
    }
    // Omitting the secret on update keeps the stored one, so an owner can edit
    // the asset id or URL without re-entering (or having to retrieve) it.
    const secretCiphertext = dto.client_secret ? this.crypto.encrypt(dto.client_secret) : existing!.secretCiphertext;

    await this.prisma.payChainIntegration.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        baseUrl,
        clientId: dto.client_id,
        secretCiphertext,
        loyaltyAssetId: dto.loyalty_asset_id,
        updatedByUserId: user.userId,
      },
      update: {
        baseUrl,
        clientId: dto.client_id,
        secretCiphertext,
        loyaltyAssetId: dto.loyalty_asset_id,
        updatedByUserId: user.userId,
        // Credentials changed → any previous test result is stale.
        ...(dto.client_secret ? { lastTestedAt: null, lastTestOk: null, lastTestDetail: null } : {}),
      },
    });
    this.logger.log(`paychain integration saved for org ${orgId} by ${user.userId}`);
    return this.get(user, orgId);
  }

  async remove(user: AuthUser, orgId: string) {
    this.assertOwner(user, orgId);
    await this.prisma.payChainIntegration.deleteMany({ where: { organizationId: orgId } });
    // Disconnecting must also stop us issuing against it.
    await this.flags.setForOrg(user, orgId, 'paychain.enabled', false);
    return { configured: false };
  }

  /**
   * Verify the tenant's credentials against PayChain's OAuth endpoint. A real
   * call, not a stored guess — bad credentials should be discovered here rather
   * than the first time a customer earns points.
   */
  async test(user: AuthUser, orgId: string) {
    this.assertOwner(user, orgId);
    const row = await this.prisma.payChainIntegration.findUnique({ where: { organizationId: orgId } });
    if (!row) throw ApiError.invalidRequest('PayChain is not configured for this organization');
    await this.assertSafeBaseUrl(row.baseUrl);

    const started = Date.now();
    let ok = false;
    let detail: string;
    try {
      const res = await fetch(`${row.baseUrl.replace(/\/$/, '')}/api/v1/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: row.clientId,
          client_secret: this.crypto.decrypt(row.secretCiphertext),
          grant_type: 'client_credentials',
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const body = (await res.json()) as { access_token?: string; expires_in?: number };
        ok = !!body.access_token;
        detail = ok ? `authenticated (token expires in ${body.expires_in ?? '?'}s)` : 'no access_token in response';
      } else {
        // Never surface the response body — it may echo back credentials.
        detail = res.status === 401 ? 'invalid client credentials' : `PayChain returned HTTP ${res.status}`;
      }
    } catch (e) {
      detail = e instanceof Error ? `could not reach PayChain: ${e.message}` : 'could not reach PayChain';
    }

    await this.prisma.payChainIntegration.update({
      where: { organizationId: orgId },
      data: { lastTestedAt: new Date(), lastTestOk: ok, lastTestDetail: detail },
    });
    return { ok, detail, latency_ms: Date.now() - started };
  }

  /** Resolve a tenant's connection for the adapter. Null when unusable. */
  async resolve(orgId: string): Promise<{ baseUrl: string; clientId: string; clientSecret: string; loyaltyAssetId: string } | null> {
    if (!(await this.flags.isEnabled('paychain.enabled', orgId))) return null;
    const row = await this.prisma.payChainIntegration.findUnique({ where: { organizationId: orgId } });
    if (!row) return null;
    return {
      baseUrl: row.baseUrl,
      clientId: row.clientId,
      clientSecret: this.crypto.decrypt(row.secretCiphertext),
      loyaltyAssetId: row.loyaltyAssetId,
    };
  }

  private safeDecrypt(ciphertext: string): string | undefined {
    try {
      return this.crypto.decrypt(ciphertext);
    } catch {
      // Almost always ENCRYPTION_KEY rotation. Say so rather than 500 — the
      // owner can re-enter the secret to recover.
      this.logger.error('paychain secret failed to decrypt (ENCRYPTION_KEY rotated?)');
      return undefined;
    }
  }

  private mask(value: string | undefined): string | null {
    if (!value) return null;
    return value.length <= 8 ? '••••' : `${value.slice(0, 4)}••••${value.slice(-4)}`;
  }
}

@ApiTags('paychain')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard/orgs/:orgId/paychain')
export class PayChainIntegrationController {
  constructor(private readonly svc: PayChainIntegrationService) {}

  @Get()
  @ApiOperation({ summary: 'Get this organization’s PayChain integration (owner only)' })
  get(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string) {
    return this.svc.get(user, orgId);
  }

  @Put()
  @ApiOperation({ summary: 'Configure the PayChain integration (owner only)' })
  upsert(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string, @Body() dto: UpsertPayChainDto) {
    return this.svc.upsert(user, orgId, dto);
  }

  @Post('test')
  @ApiOperation({ summary: 'Verify the stored credentials against PayChain' })
  test(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string) {
    return this.svc.test(user, orgId);
  }

  @Delete()
  @ApiOperation({ summary: 'Disconnect PayChain (also disables issuance)' })
  remove(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string) {
    return this.svc.remove(user, orgId);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [PayChainIntegrationController],
  providers: [PayChainIntegrationService],
  exports: [PayChainIntegrationService],
})
export class PayChainIntegrationModule {}
