import { Body, Controller, Delete, Get, Injectable, Logger, Module, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { ApiError } from '../common/api-error';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthModule } from '../auth/auth.module';
import { requireMembership } from '../auth/rbac';
import { assertSafeUrl } from '../common/ssrf';
import { FeatureFlagsService } from '../feature-flags/feature-flags.module';
import { PayChainClient, PayChainError } from './paychain-client';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

/** Turn a raw PayChain error into a clean, user-facing message instead of a 500. */
async function pc<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PayChainError) {
      if (e.status === 409) throw ApiError.invalidRequest(`PayChain: ${e.detail || 'that already exists — pick a different code'}`);
      if (e.status === 401 || e.status === 403) throw ApiError.invalidRequest('PayChain rejected the request — check your credentials and scopes');
      throw ApiError.invalidRequest(`PayChain: ${e.detail || e.message}`);
    }
    throw e;
  }
}

const DEFAULT_BASE_URL = 'https://api.paychain.cambobia.com';

export class UpsertPayChainDto {
  @IsOptional() @IsUrl({ require_tld: false }) @MaxLength(200) base_url?: string;
  @IsString() @MinLength(1) @MaxLength(200) client_id!: string;
  /** Write-only. Omit on update to keep the stored secret. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(400) client_secret?: string;
  /** Optional: leave blank to create a loyalty asset in the PayChain Console. */
  @IsOptional() @IsString() @MaxLength(200) loyalty_asset_id?: string;
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
        loyaltyAssetId: dto.loyalty_asset_id || null,
        updatedByUserId: user.userId,
      },
      update: {
        baseUrl,
        clientId: dto.client_id,
        secretCiphertext,
        // Omitting the asset on update keeps the stored/console-created one, so
        // editing creds never wipes an asset made in the console.
        ...(dto.loyalty_asset_id !== undefined ? { loyaltyAssetId: dto.loyalty_asset_id || null } : {}),
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

  /** Resolve a tenant's connection for the adapter. Null when unusable — value
   *  ops are gated on the paychain.enabled flag. */
  async resolve(orgId: string): Promise<{ baseUrl: string; clientId: string; clientSecret: string; loyaltyAssetId: string } | null> {
    if (!(await this.flags.isEnabled('paychain.enabled', orgId))) return null;
    const conn = await this.connectionRow(orgId);
    // No asset chosen yet → value ops (earn/issue) have no target, so stay a
    // no-op until the owner creates one in the console. The sale still succeeds.
    if (!conn || !conn.loyaltyAssetId) return null;
    return conn;
  }

  /** Owner-scoped connection for the management console — available even before
   *  the flag is on, so an owner can create/activate their asset, then enable. */
  async resolveForOwner(user: AuthUser, orgId: string) {
    this.assertOwner(user, orgId);
    const conn = await this.connectionRow(orgId);
    if (!conn) throw ApiError.invalidRequest('PayChain is not configured for this organization');
    return conn;
  }

  private async connectionRow(orgId: string) {
    const row = await this.prisma.payChainIntegration.findUnique({ where: { organizationId: orgId } });
    if (!row) return null;
    return {
      baseUrl: row.baseUrl,
      clientId: row.clientId,
      clientSecret: this.crypto.decrypt(row.secretCiphertext),
      loyaltyAssetId: row.loyaltyAssetId ?? '',
    };
  }

  /** Persist a newly-created asset id as the org's loyalty asset. */
  async setLoyaltyAsset(user: AuthUser, orgId: string, assetId: string) {
    this.assertOwner(user, orgId);
    await this.prisma.payChainIntegration.update({ where: { organizationId: orgId }, data: { loyaltyAssetId: assetId } });
  }

  async flagEnabled(orgId: string): Promise<boolean> {
    return this.flags.isEnabled('paychain.enabled', orgId);
  }

  async webhookStatus(orgId: string): Promise<{ connected: boolean; url: string }> {
    const row = await this.prisma.payChainIntegration.findUnique({ where: { organizationId: orgId } });
    return { connected: !!row?.webhookId, url: `${this.config.get<string>('apiPublicUrl')}/paychain/webhook/${orgId}` };
  }

  /** One-click: register PayKH's own receiver with PayChain, store the secret. */
  async connectWebhook(user: AuthUser, orgId: string, client: PayChainClient) {
    this.assertOwner(user, orgId);
    const conn = await this.connectionRow(orgId);
    if (!conn) throw ApiError.invalidRequest('PayChain is not configured');
    const url = `${this.config.get<string>('apiPublicUrl')}/paychain/webhook/${orgId}`;
    const events = ['asset.issued', 'asset.transferred', 'asset.redeemed', 'asset.burned', 'transaction.compensated'];
    const wh = await pc(() => client.createWebhook(conn, url, events, prefixedId('pcwh')));
    const secret = wh.secret ?? wh.signingSecret;
    await this.prisma.payChainIntegration.update({
      where: { organizationId: orgId },
      data: { webhookId: wh.id, ...(secret ? { webhookSecret: this.crypto.encrypt(secret) } : {}) },
    });
    this.logger.log(`paychain webhook connected for org ${orgId} → ${url}`);
    return { connected: true, url };
  }

  async disconnectWebhook(user: AuthUser, orgId: string, client: PayChainClient) {
    this.assertOwner(user, orgId);
    const row = await this.prisma.payChainIntegration.findUnique({ where: { organizationId: orgId } });
    const conn = await this.connectionRow(orgId);
    if (row?.webhookId && conn) await client.deleteWebhook(conn, row.webhookId).catch(() => undefined);
    await this.prisma.payChainIntegration.update({ where: { organizationId: orgId }, data: { webhookId: null, webhookSecret: null } });
    return { connected: false };
  }

  /** For the receiver: the org's decrypted webhook secret, or null. */
  async webhookSecret(orgId: string): Promise<string | null> {
    const row = await this.prisma.payChainIntegration.findUnique({ where: { organizationId: orgId } });
    if (!row?.webhookSecret) return null;
    try { return this.crypto.decrypt(row.webhookSecret); } catch { return null; }
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

/**
 * Owner-only console over the full PayChain service surface — so a shop owner
 * can exercise every PayChain capability from PayKH: asset lifecycle, on-chain
 * transaction history, webhooks, health. All per-tenant (their own credentials).
 */
class CreateAssetConsoleDto {
  @IsString() @MinLength(1) @MaxLength(12) assetCode!: string;
  @IsString() @MinLength(1) @MaxLength(60) assetName!: string;
  @IsOptional() @IsString() expiryPolicy?: string;
  @IsOptional() setAsLoyaltyAsset?: boolean;
}
class TransferConsoleDto {
  @IsString() fromWalletId!: string;
  @IsString() toWalletId!: string;
  @IsString() amount!: string;
}
class CreateWebhookConsoleDto {
  @IsUrl({ require_tld: false }) url!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) events?: string[];
}

@Injectable()
export class PayChainConsoleService {
  private readonly logger = new Logger('PayChainConsole');
  constructor(private readonly integration: PayChainIntegrationService, private readonly client: PayChainClient) {}

  /** One call for the console: connection status + assets + recent txns + webhooks. */
  async overview(user: AuthUser, orgId: string) {
    const conn = await this.integration.resolveForOwner(user, orgId);
    const [status, assets, transactions, webhooks, enabled, webhook] = await Promise.all([
      this.client.status(conn).catch(() => ({ health: false, ready: false, blockchain: null })),
      this.client.listAssets(conn).catch(() => []),
      this.client.listTransactions(conn).catch(() => []),
      this.client.listWebhooks(conn).catch(() => []),
      this.integration.flagEnabled(orgId),
      this.integration.webhookStatus(orgId),
    ]);
    return { loyalty_asset_id: conn.loyaltyAssetId, enabled, webhook, status, assets, transactions: transactions.slice(0, 25), webhooks };
  }

  async createAsset(user: AuthUser, orgId: string, dto: CreateAssetConsoleDto) {
    const conn = await this.integration.resolveForOwner(user, orgId);
    const eventId = prefixedId('pcasset');
    const asset = await pc(() => this.client.createAsset(
      conn,
      { assetCode: dto.assetCode.toUpperCase(), assetName: dto.assetName, expiryPolicy: dto.expiryPolicy },
      eventId,
    ));
    // Best-effort activate so it can issue immediately.
    await this.client.activateAsset(conn, asset.id, eventId).catch((e) => this.logger.warn(`activate ${asset.id} failed: ${e}`));
    // Auto-adopt it as the loyalty asset if the org doesn't have one yet, so the
    // owner never has to copy an id — one click and it's wired.
    if (dto.setAsLoyaltyAsset || !conn.loyaltyAssetId) await this.integration.setLoyaltyAsset(user, orgId, asset.id);
    return asset;
  }

  async activateAsset(user: AuthUser, orgId: string, assetId: string) {
    const conn = await this.integration.resolveForOwner(user, orgId);
    return pc(() => this.client.activateAsset(conn, assetId, prefixedId('pcact')));
  }

  /** Adopt an existing PayChain asset as this org's loyalty asset. */
  async useAsset(user: AuthUser, orgId: string, assetId: string) {
    await this.integration.resolveForOwner(user, orgId);
    await this.integration.setLoyaltyAsset(user, orgId, assetId);
    return { loyalty_asset_id: assetId };
  }

  async transfer(user: AuthUser, orgId: string, dto: TransferConsoleDto) {
    const conn = await this.integration.resolveForOwner(user, orgId);
    return pc(() => this.client.transfer(conn, dto.fromWalletId, dto.toWalletId, dto.amount, prefixedId('pctx')));
  }

  async listWebhooks(user: AuthUser, orgId: string) {
    const conn = await this.integration.resolveForOwner(user, orgId);
    return pc(() => this.client.listWebhooks(conn));
  }

  async createWebhook(user: AuthUser, orgId: string, dto: CreateWebhookConsoleDto) {
    const conn = await this.integration.resolveForOwner(user, orgId);
    const events = dto.events?.length ? dto.events : ['asset.issued', 'asset.transferred', 'asset.redeemed', 'asset.burned', 'transaction.compensated'];
    const wh = await pc(() => this.client.createWebhook(conn, dto.url, events, prefixedId('pcwh')));
    // The signing secret is returned once — surface it so the owner can store it.
    return wh;
  }

  async deleteWebhook(user: AuthUser, orgId: string, id: string) {
    const conn = await this.integration.resolveForOwner(user, orgId);
    await pc(() => this.client.deleteWebhook(conn, id));
    return { deleted: true };
  }

  /** One-click: register PayKH's own webhook receiver with PayChain and store
   *  the returned signing secret. The owner never has to find or type a URL. */
  async connectWebhook(user: AuthUser, orgId: string) {
    return this.integration.connectWebhook(user, orgId, this.client);
  }
  async disconnectWebhook(user: AuthUser, orgId: string) {
    return this.integration.disconnectWebhook(user, orgId, this.client);
  }
}

@ApiTags('paychain')
@ApiBearerAuth()
// Owner-only AND per-route rate-limited: even a valid owner token (runaway
// script / stolen session) can't loop asset creation or value transfers to spam
// or drain the org's own PayChain tenant.
@UseGuards(JwtAuthGuard, RateLimitGuard)
@Controller('dashboard/orgs/:orgId/paychain/console')
export class PayChainConsoleController {
  constructor(private readonly console: PayChainConsoleService) {}

  @Get()
  @RateLimit({ limit: 30, windowSec: 10, by: 'ip' })
  @ApiOperation({ summary: 'PayChain console overview: status + assets + transactions + webhooks (owner)' })
  overview(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string) {
    return this.console.overview(user, orgId);
  }

  @Post('assets')
  @RateLimit({ limit: 6, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Create (and activate) a loyalty asset on PayChain' })
  createAsset(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string, @Body() dto: CreateAssetConsoleDto) {
    return this.console.createAsset(user, orgId, dto);
  }

  @Post('assets/:assetId/activate')
  @ApiOperation({ summary: 'Activate an asset' })
  activate(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string, @Param('assetId') assetId: string) {
    return this.console.activateAsset(user, orgId, assetId);
  }

  @Post('assets/:assetId/use')
  @ApiOperation({ summary: 'Use this asset as the loyalty asset' })
  use(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string, @Param('assetId') assetId: string) {
    return this.console.useAsset(user, orgId, assetId);
  }

  @Post('webhooks/connect')
  @RateLimit({ limit: 10, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'One-click: register PayKH’s webhook receiver with PayChain' })
  connectWebhook(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string) {
    return this.console.connectWebhook(user, orgId);
  }

  @Post('webhooks/disconnect')
  @ApiOperation({ summary: 'Remove PayKH’s webhook registration' })
  disconnectWebhook(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string) {
    return this.console.disconnectWebhook(user, orgId);
  }

  @Post('transfer')
  @RateLimit({ limit: 5, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Transfer points between two wallets' })
  transfer(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string, @Body() dto: TransferConsoleDto) {
    return this.console.transfer(user, orgId, dto);
  }

  @Post('webhooks')
  @RateLimit({ limit: 10, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Register a PayChain webhook (secret returned once)' })
  createWebhook(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string, @Body() dto: CreateWebhookConsoleDto) {
    return this.console.createWebhook(user, orgId, dto);
  }

  @Delete('webhooks/:id')
  @ApiOperation({ summary: 'Delete a PayChain webhook' })
  deleteWebhook(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string, @Param('id') id: string) {
    return this.console.deleteWebhook(user, orgId, id);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [PayChainIntegrationController, PayChainConsoleController],
  providers: [PayChainIntegrationService, PayChainConsoleService, PayChainClient],
  exports: [PayChainIntegrationService, PayChainClient],
})
export class PayChainIntegrationModule {}
