import { Body, Controller, Get, Injectable, Logger, Module, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TrusteeArtifactType } from '@prisma/client';
import { prefixedId, publicKeyPemFromPrivateKey, signEd25519 } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsCoreModule, SettingsService } from '../settings/settings.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ReconciliationService } from '../ledger/reconciliation.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthModule } from '../auth/auth.module';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { ApiError } from '../common/api-error';

class CreateTrusteeArtifactDto {
  @IsIn(['TRUSTEE_READINESS', 'RESERVE_SNAPSHOT', 'MINT_POLICY'])
  type!: TrusteeArtifactType;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

@Injectable()
export class TrusteeService {
  private readonly logger = new Logger('Trustee');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly recon: ReconciliationService,
  ) {}

  async keys() {
    const [requestPem, requestKeyId, artifactPem, artifactKeyId] = await Promise.all([
      this.settings.resolve('trustee_request_signing_private_key'),
      this.settings.resolve('trustee_request_signing_key_id'),
      this.settings.resolve('trustee_artifact_signing_private_key'),
      this.settings.resolve('trustee_artifact_signing_key_id'),
    ]);
    return {
      generated_at: new Date().toISOString(),
      keys: [
        ...(requestPem && requestKeyId ? [{ purpose: 'TRUSTEE_REQUEST_SIGNING', key_id: requestKeyId, public_key_pem: publicKeyPemFromPrivateKey(requestPem) }] : []),
        ...(artifactPem && artifactKeyId ? [{ purpose: 'TRUSTEE_ARTIFACT_SIGNING', key_id: artifactKeyId, public_key_pem: publicKeyPemFromPrivateKey(artifactPem) }] : []),
      ],
    };
  }

  async status(user: AuthUser) {
    await this.assertAdmin(user.userId);
    const [trusteeBaseUrl, requestPem, requestKeyId, artifactPem, artifactKeyId, orgs, connected, webhooks, tb, recon, drift, latest] = await Promise.all([
      this.settings.resolve('trustee_base_url'),
      this.settings.resolve('trustee_request_signing_private_key'),
      this.settings.resolve('trustee_request_signing_key_id'),
      this.settings.resolve('trustee_artifact_signing_private_key'),
      this.settings.resolve('trustee_artifact_signing_key_id'),
      this.prisma.organization.count(),
      this.prisma.payChainIntegration.count(),
      this.prisma.payChainIntegration.count({ where: { webhookId: { not: null } } }),
      this.recon.trialBalance(),
      this.recon.reconcile(user),
      this.recon.adminPointsDrift(user),
      this.prisma.trusteeArtifact.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
    ]);
    const requestOk = !!(requestPem && requestKeyId && this.canDerivePublicKey(requestPem));
    const artifactOk = !!(artifactPem && artifactKeyId && this.canDerivePublicKey(artifactPem));
    return {
      ready: !!trusteeBaseUrl && requestOk && artifactOk && recon.balanced && drift.ok,
      trustee: {
        base_url: trusteeBaseUrl ?? null,
        request_signing_configured: requestOk,
        artifact_signing_configured: artifactOk,
        request_signing_key_id: requestKeyId ?? null,
        artifact_signing_key_id: artifactKeyId ?? null,
      },
      paychain: {
        organizations_total: orgs,
        organizations_connected: connected,
        webhooks_connected: webhooks,
      },
      ledger: {
        in_balance: tb.in_balance,
        currency_totals: tb.currency_totals,
        reconciliation: recon,
      },
      points: drift,
      latest_artifacts: latest.map((a) => ({
        id: a.id,
        type: a.type,
        scope: a.scope,
        key_id: a.keyId,
        algorithm: a.algorithm,
        created_at: a.createdAt.toISOString(),
        note: a.note,
      })),
    };
  }

  async listArtifacts(user: AuthUser, limit = 20) {
    await this.assertAdmin(user.userId);
    const rows = await this.prisma.trusteeArtifact.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(limit, 100) });
    return {
      data: rows.map((a) => ({
        id: a.id,
        type: a.type,
        scope: a.scope,
        key_id: a.keyId,
        algorithm: a.algorithm,
        payload: a.payload,
        signature: a.signature,
        note: a.note,
        created_at: a.createdAt.toISOString(),
      })),
    };
  }

  async createArtifact(user: AuthUser, dto: CreateTrusteeArtifactDto) {
    await this.assertAdmin(user.userId);
    const privateKeyPem = await this.settings.resolve('trustee_artifact_signing_private_key');
    const keyId = await this.settings.resolve('trustee_artifact_signing_key_id');
    if (!privateKeyPem || !keyId) {
      throw ApiError.invalidRequest('Trustee artifact-signing key is not configured');
    }
    const payload = await this.payloadFor(dto.type, user);
    const canonical = JSON.stringify(payload);
    const signature = signEd25519(privateKeyPem, canonical);
    const row = await this.prisma.trusteeArtifact.create({
      data: {
        id: prefixedId('tart'),
        type: dto.type,
        scope: 'platform',
        payload,
        signature,
        keyId,
        note: dto.note ?? null,
        createdByUserId: user.userId,
      },
    });
    this.logger.log(`trustee artifact created: ${row.type} (${row.id}) by ${user.userId}`);
    return {
      id: row.id,
      type: row.type,
      scope: row.scope,
      key_id: row.keyId,
      algorithm: row.algorithm,
      payload: row.payload,
      signature: row.signature,
      note: row.note,
      created_at: row.createdAt.toISOString(),
    };
  }

  private async payloadFor(type: TrusteeArtifactType, user: AuthUser) {
    switch (type) {
      case 'TRUSTEE_READINESS':
        return this.readinessPayload(user);
      case 'RESERVE_SNAPSHOT':
        return this.reserveSnapshotPayload(user);
      case 'MINT_POLICY':
        return this.mintPolicyPayload(user);
    }
  }

  private async readinessPayload(user: AuthUser) {
    const status = await this.status(user);
    return {
      type: 'trustee_readiness',
      generated_at: new Date().toISOString(),
      platform: 'paykh',
      trustee_base_url: status.trustee.base_url,
      ready: status.ready,
      request_signing_key_id: status.trustee.request_signing_key_id,
      artifact_signing_key_id: status.trustee.artifact_signing_key_id,
      paychain: status.paychain,
      ledger: {
        in_balance: status.ledger.in_balance,
        currency_totals: status.ledger.currency_totals,
        reconciliation_ok: status.ledger.reconciliation.balanced,
        points_drift_ok: status.points.ok,
      },
      supported_artifacts: ['TRUSTEE_READINESS', 'RESERVE_SNAPSHOT', 'MINT_POLICY'],
    };
  }

  private async reserveSnapshotPayload(user: AuthUser) {
    const [tb, recon, drift, paid, pointsLiability, giftCards] = await Promise.all([
      this.recon.trialBalance(),
      this.recon.reconcile(user),
      this.recon.adminPointsDrift(user),
      this.prisma.payment.groupBy({ by: ['currency'], where: { status: 'PAID' }, _sum: { amount: true } }),
      this.prisma.ledgerEntry.groupBy({ by: ['currency', 'direction'], where: { accountCode: 'points_liability' }, _sum: { amount: true } }),
      this.prisma.giftCard.groupBy({ by: ['currency'], _sum: { balance: true } }),
    ]);
    const pointsByDirection = Object.fromEntries(pointsLiability.map((r) => [`${r.currency}:${r.direction}`, (r._sum.amount ?? 0).toString()]));
    return {
      type: 'reserve_snapshot',
      generated_at: new Date().toISOString(),
      scope: 'platform',
      ledger_in_balance: tb.in_balance,
      reconciliation_ok: recon.balanced,
      points_drift_ok: drift.ok,
      paid_volume_by_currency: Object.fromEntries(paid.map((r) => [r.currency, (r._sum.amount ?? 0).toString()])),
      gift_card_liability_by_currency: Object.fromEntries(giftCards.map((r) => [r.currency, (r._sum.balance ?? 0).toString()])),
      points_liability_ledger: drift.liability_ledger,
      points_liability_breakdown: pointsByDirection,
      trial_balance: tb.currency_totals,
    };
  }

  private async mintPolicyPayload(user: AuthUser) {
    const [enabled, integrations] = await Promise.all([
      this.prisma.featureFlag.count({ where: { key: 'paychain.enabled', enabled: true } }),
      this.prisma.payChainIntegration.findMany({ select: { organizationId: true, loyaltyAssetId: true, webhookId: true, lastTestOk: true } }),
    ]);
    return {
      type: 'mint_policy',
      generated_at: new Date().toISOString(),
      scope: 'platform',
      policy: {
        local_ledger_authoritative: true,
        paychain_shadow_mode_supported: true,
        trustee_required_for_real_money_production: true,
        mint_prerequisites: [
          'merchant verification approved',
          'paychain credentials tested',
          'loyalty asset selected',
          'paychain webhook connected',
          'platform books reconciled',
          'trustee authorization verified',
        ],
      },
      paychain_enabled_overrides: enabled,
      configured_organizations: integrations.length,
      organizations_meeting_local_prereqs: integrations.filter((i) => i.loyaltyAssetId && i.webhookId && i.lastTestOk).map((i) => i.organizationId),
    };
  }

  private canDerivePublicKey(privateKeyPem: string): boolean {
    try {
      publicKeyPemFromPrivateKey(privateKeyPem);
      return true;
    } catch {
      return false;
    }
  }

  private async assertAdmin(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u?.isPlatformAdmin) throw ApiError.forbidden('Platform admin access required');
  }
}

@ApiTags('trustee')
@Controller('.well-known')
export class TrusteeWellKnownController {
  constructor(private readonly trustee: TrusteeService) {}

  @Get('paykh-trustee-keys')
  @ApiOperation({ summary: 'Public signing keys PayKH exposes for trustee verification' })
  keys() {
    return this.trustee.keys();
  }
}

@ApiTags('trustee')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/trustee')
export class TrusteeAdminController {
  constructor(private readonly trustee: TrusteeService) {}

  @Get('status')
  @ApiOperation({ summary: 'Trustee integration readiness and regulator-demo status (admin)' })
  status(@CurrentUser() user: AuthUser) {
    return this.trustee.status(user);
  }

  @Get('artifacts')
  @ApiOperation({ summary: 'List signed trustee/regulator artifacts (admin)' })
  artifacts(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    return this.trustee.listArtifacts(user, limit ? Number(limit) : undefined);
  }

  @Post('artifacts')
  @ApiOperation({ summary: 'Create a signed trustee/regulator artifact (admin)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTrusteeArtifactDto) {
    return this.trustee.createArtifact(user, dto);
  }
}

@Module({
  imports: [AuthModule, SettingsCoreModule, LedgerModule],
  controllers: [TrusteeWellKnownController, TrusteeAdminController],
  providers: [TrusteeService],
})
export class TrusteeModule {}
