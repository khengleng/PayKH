import { Body, Controller, Get, Global, Injectable, Logger, Module, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthModule } from '../auth/auth.module';
import { requireMembership } from '../auth/rbac';

export const GLOBAL_SCOPE = 'global';

/**
 * How a flag combines its platform row with its organization row.
 *
 * - `override`: the org row wins if present, else the platform row, else the
 *   code default. Ordinary product toggles.
 * - `gated`: enabled only if BOTH the platform and the org say yes. A tenant
 *   can never switch these on alone — the platform has to have enabled them
 *   first. Used for anything that moves real value.
 */
type Resolution = 'override' | 'gated';

interface Def {
  key: string;
  label: string;
  group: string;
  /** Value when neither a platform nor an org row exists. */
  default: boolean;
  resolution: Resolution;
}

/**
 * The registry of known flags. A key absent from this list does not exist —
 * `isEnabled` throws rather than guessing, so a typo fails loudly instead of
 * silently resolving to `false` and disabling a feature in production.
 */
const DEFS: Def[] = [
  // Product surfaces. `false` where the module is not built yet, so the flag
  // tells the truth about what the platform can actually do today.
  { key: 'loyalty.enabled', label: 'Loyalty engine', group: 'Product', default: true, resolution: 'override' },
  { key: 'referral.enabled', label: 'Referrals', group: 'Product', default: true, resolution: 'override' },
  { key: 'scratch.enabled', label: 'Scratch games', group: 'Product', default: true, resolution: 'override' },
  { key: 'rewards_catalog.enabled', label: 'Rewards catalog', group: 'Product', default: true, resolution: 'override' },
  { key: 'coupon.enabled', label: 'Coupons & vouchers', group: 'Product', default: false, resolution: 'override' },
  { key: 'giftcard.enabled', label: 'Gift cards', group: 'Product', default: false, resolution: 'override' },
  { key: 'cashback.enabled', label: 'Cashback', group: 'Product', default: false, resolution: 'override' },
  { key: 'automatic_promotions.enabled', label: 'Automatic promotions', group: 'Product', default: false, resolution: 'override' },

  // PayChain. Tenant-settable: each tenant configures their OWN PayChain client
  // credentials (see PayChainIntegration), so enabling this spends their
  // PayChain account, not the platform's — there is nothing for a platform gate
  // to protect here, and gating it would only block self-service onboarding.
  // The platform row still acts as a kill switch: it is the fallback when a
  // tenant has expressed no preference, and stablecoin (below) stays gated.
  { key: 'paychain.enabled', label: 'PayChain digital value', group: 'PayChain', default: false, resolution: 'override' },
  { key: 'paychain.shadow_mode.enabled', label: 'PayChain shadow mode (dual-write, legacy is source of truth)', group: 'PayChain', default: false, resolution: 'override' },

  // Stablecoin. Gated even though PayChain is not: spec §21 requires the
  // PayChain *and* tenant flags to agree, and stablecoin carries regulatory
  // exposure the platform cannot delegate to a tenant's own dashboard.
  { key: 'stablecoin.balance.enabled', label: 'Stablecoin balances', group: 'Stablecoin', default: false, resolution: 'gated' },
  { key: 'stablecoin.transfer.enabled', label: 'Stablecoin transfer', group: 'Stablecoin', default: false, resolution: 'gated' },
  { key: 'stablecoin.redemption.enabled', label: 'Stablecoin redemption', group: 'Stablecoin', default: false, resolution: 'gated' },
  { key: 'stablecoin.conversion.enabled', label: 'Loyalty→stablecoin conversion', group: 'Stablecoin', default: false, resolution: 'gated' },
];
const DEF_BY_KEY = new Map(DEFS.map((d) => [d.key, d]));

/** Flags a tenant may set for themselves. Gated flags are platform-admin only. */
const TENANT_SETTABLE = DEFS.filter((d) => d.resolution === 'override').map((d) => d.key);

@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger('FeatureFlags');
  // Flags are read on hot paths (every earn/redeem), so cache briefly. The TTL
  // is also the worst-case delay before a kill-switch takes effect — keep it
  // short enough to be useful in an incident.
  private cache = new Map<string, { value: boolean; at: number }>();
  private readonly TTL_MS = 10_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a flag for an organization. `orgId` omitted resolves the platform
   * value alone — for gated flags that is the platform half of the AND, which
   * is not the same as "enabled for a tenant", so prefer passing an org.
   */
  async isEnabled(key: string, orgId?: string): Promise<boolean> {
    const def = DEF_BY_KEY.get(key);
    if (!def) throw ApiError.internal(`Unknown feature flag: ${key}`);

    const cacheKey = `${key}:${orgId ?? GLOBAL_SCOPE}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < this.TTL_MS) return cached.value;

    const scopes = orgId ? [GLOBAL_SCOPE, orgId] : [GLOBAL_SCOPE];
    const rows = await this.prisma.featureFlag.findMany({ where: { key, scope: { in: scopes } } });
    const platform = rows.find((r) => r.scope === GLOBAL_SCOPE)?.enabled;
    const org = orgId ? rows.find((r) => r.scope === orgId)?.enabled : undefined;

    const value =
      def.resolution === 'gated'
        ? (platform ?? def.default) && (orgId ? (org ?? def.default) : true)
        : (org ?? platform ?? def.default);

    this.cache.set(cacheKey, { value, at: Date.now() });
    return value;
  }

  /** Throw 403 unless the flag is on. For guarding a whole endpoint. */
  async assertEnabled(key: string, orgId?: string): Promise<void> {
    if (!(await this.isEnabled(key, orgId))) {
      throw ApiError.forbidden(`Feature not enabled: ${key}`);
    }
  }

  private async assertPlatformAdmin(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u?.isPlatformAdmin) throw ApiError.forbidden('Platform admin access required');
  }

  /** Platform admin: every flag with its platform-level value. */
  async listPlatform(user: AuthUser) {
    await this.assertPlatformAdmin(user.userId);
    const rows = await this.prisma.featureFlag.findMany({ where: { scope: GLOBAL_SCOPE } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return {
      flags: DEFS.map((d) => {
        const row = byKey.get(d.key);
        return {
          key: d.key,
          label: d.label,
          group: d.group,
          resolution: d.resolution,
          enabled: row?.enabled ?? d.default,
          source: row ? 'db' : 'default',
          tenant_settable: d.resolution === 'override',
        };
      }),
    };
  }

  /** Tenant: effective values for one org, so the UI can hide what's off. */
  async listForOrg(user: AuthUser, orgId: string) {
    requireMembership(user, orgId);
    return {
      flags: await Promise.all(
        DEFS.map(async (d) => ({
          key: d.key,
          label: d.label,
          group: d.group,
          enabled: await this.isEnabled(d.key, orgId),
          tenant_settable: d.resolution === 'override',
        })),
      ),
    };
  }

  async setPlatform(user: AuthUser, key: string, enabled: boolean) {
    await this.assertPlatformAdmin(user.userId);
    if (!DEF_BY_KEY.has(key)) throw ApiError.invalidRequest(`Unknown feature flag: ${key}`);
    return this.write(key, GLOBAL_SCOPE, enabled, user.userId);
  }

  async setForOrg(user: AuthUser, orgId: string, key: string, enabled: boolean) {
    requireMembership(user, orgId);
    if (!DEF_BY_KEY.has(key)) throw ApiError.invalidRequest(`Unknown feature flag: ${key}`);
    if (!TENANT_SETTABLE.includes(key)) {
      throw ApiError.forbidden(`${key} can only be set by a platform administrator`);
    }
    return this.write(key, orgId, enabled, user.userId);
  }

  private async write(key: string, scope: string, enabled: boolean, userId: string) {
    await this.prisma.featureFlag.upsert({
      where: { key_scope: { key, scope } },
      create: { key, scope, enabled, updatedByUserId: userId },
      update: { enabled, updatedByUserId: userId },
    });
    this.cache.clear(); // a gated flag's platform row affects every org's cache key
    this.logger.log(`feature flag ${key}@${scope} = ${enabled} by ${userId}`);
    return { key, scope, enabled };
  }
}

class SetFlagDto {
  @IsBoolean() enabled!: boolean;
}

@ApiTags('feature-flags')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get('admin/feature-flags')
  @ApiOperation({ summary: 'List platform feature flags (admin)' })
  listPlatform(@CurrentUser() user: AuthUser) {
    return this.flags.listPlatform(user);
  }

  @Put('admin/feature-flags/:key')
  @ApiOperation({ summary: 'Set a platform feature flag (admin)' })
  setPlatform(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body() dto: SetFlagDto) {
    return this.flags.setPlatform(user, key, dto.enabled);
  }

  @Get('dashboard/orgs/:orgId/feature-flags')
  @ApiOperation({ summary: 'Effective feature flags for an organization' })
  listForOrg(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string) {
    return this.flags.listForOrg(user, orgId);
  }

  @Put('dashboard/orgs/:orgId/feature-flags/:key')
  @ApiOperation({ summary: 'Set an organization feature flag' })
  setForOrg(
    @CurrentUser() user: AuthUser,
    @Param('orgId') orgId: string,
    @Param('key') key: string,
    @Body() dto: SetFlagDto,
  ) {
    return this.flags.setForOrg(user, orgId, key, dto.enabled);
  }
}

// Mirrors SettingsCoreModule: the provider is @Global and has no auth
// dependency, so business services can inject it without a module cycle.
@Global()
@Module({
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsCoreModule {}

@Module({
  imports: [AuthModule, FeatureFlagsCoreModule],
  controllers: [FeatureFlagsController],
})
export class FeatureFlagsModule {}
