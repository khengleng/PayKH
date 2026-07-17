import { FeatureFlagsService, GLOBAL_SCOPE } from './feature-flags.module';

type Row = { key: string; scope: string; enabled: boolean };

/** Build a service over a fixed set of flag rows. */
function make(rows: Row[] = []) {
  const prisma = {
    featureFlag: {
      findMany: jest.fn(({ where }: { where: { key: string; scope: { in: string[] } } }) =>
        Promise.resolve(rows.filter((r) => r.key === where.key && where.scope.in.includes(r.scope))),
      ),
    },
  };
  return new FeatureFlagsService(prisma as never);
}

const ORG = 'org_1';

describe('FeatureFlagsService.isEnabled', () => {
  it('throws on an unknown key rather than silently resolving false', async () => {
    // A typo'd key must fail loudly — resolving to false would quietly disable
    // a live feature and look like a product bug.
    await expect(make().isEnabled('loylaty.enabled', ORG)).rejects.toThrow(/Unknown feature flag/);
  });

  it('falls back to the code default when no rows exist', async () => {
    expect(await make().isEnabled('loyalty.enabled', ORG)).toBe(true);
    expect(await make().isEnabled('coupon.enabled', ORG)).toBe(false);
  });

  describe('override flags', () => {
    it('prefers the org row over the platform row', async () => {
      const s = make([
        { key: 'coupon.enabled', scope: GLOBAL_SCOPE, enabled: false },
        { key: 'coupon.enabled', scope: ORG, enabled: true },
      ]);
      expect(await s.isEnabled('coupon.enabled', ORG)).toBe(true);
    });

    it('uses the platform row when the org has none', async () => {
      const s = make([{ key: 'coupon.enabled', scope: GLOBAL_SCOPE, enabled: true }]);
      expect(await s.isEnabled('coupon.enabled', ORG)).toBe(true);
    });

    it('does not leak one org’s row into another org', async () => {
      const s = make([{ key: 'coupon.enabled', scope: 'org_other', enabled: true }]);
      expect(await s.isEnabled('coupon.enabled', ORG)).toBe(false);
    });
  });

  describe('gated flags', () => {
    it('stays off when the org opts in but the platform has not enabled it', async () => {
      // The load-bearing case: a tenant must not be able to switch on real
      // value movement from their own dashboard.
      const s = make([
        { key: 'paychain.enabled', scope: GLOBAL_SCOPE, enabled: false },
        { key: 'paychain.enabled', scope: ORG, enabled: true },
      ]);
      expect(await s.isEnabled('paychain.enabled', ORG)).toBe(false);
    });

    it('stays off when the platform enables it but the org has not opted in', async () => {
      const s = make([{ key: 'paychain.enabled', scope: GLOBAL_SCOPE, enabled: true }]);
      expect(await s.isEnabled('paychain.enabled', ORG)).toBe(false);
    });

    it('is on only when platform and org both agree', async () => {
      const s = make([
        { key: 'paychain.enabled', scope: GLOBAL_SCOPE, enabled: true },
        { key: 'paychain.enabled', scope: ORG, enabled: true },
      ]);
      expect(await s.isEnabled('paychain.enabled', ORG)).toBe(true);
    });

    it('resolves the platform half alone when no org is supplied', async () => {
      const s = make([{ key: 'paychain.enabled', scope: GLOBAL_SCOPE, enabled: true }]);
      expect(await s.isEnabled('paychain.enabled')).toBe(true);
    });
  });

  it('defaults every stablecoin flag to off (spec §29)', async () => {
    const s = make();
    for (const key of [
      'stablecoin.balance.enabled',
      'stablecoin.transfer.enabled',
      'stablecoin.redemption.enabled',
      'stablecoin.conversion.enabled',
    ]) {
      expect(await s.isEnabled(key, ORG)).toBe(false);
    }
  });

  it('keeps stablecoin off for an org that enabled it while the platform has not', async () => {
    const s = make([
      { key: 'stablecoin.transfer.enabled', scope: ORG, enabled: true },
      { key: 'stablecoin.balance.enabled', scope: ORG, enabled: true },
    ]);
    expect(await s.isEnabled('stablecoin.transfer.enabled', ORG)).toBe(false);
    expect(await s.isEnabled('stablecoin.balance.enabled', ORG)).toBe(false);
  });
});

describe('FeatureFlagsService.assertEnabled', () => {
  it('throws 403 when off and passes when on', async () => {
    await expect(make().assertEnabled('coupon.enabled', ORG)).rejects.toThrow(/Feature not enabled/);
    await expect(make().assertEnabled('loyalty.enabled', ORG)).resolves.toBeUndefined();
  });
});

describe('FeatureFlagsService caching', () => {
  it('serves a repeat read from cache instead of re-querying', async () => {
    const s = make([{ key: 'coupon.enabled', scope: GLOBAL_SCOPE, enabled: true }]);
    const prisma = (s as unknown as { prisma: { featureFlag: { findMany: jest.Mock } } }).prisma;
    await s.isEnabled('coupon.enabled', ORG);
    await s.isEnabled('coupon.enabled', ORG);
    expect(prisma.featureFlag.findMany).toHaveBeenCalledTimes(1);
  });

  it('caches per org, so one org’s read does not answer another’s', async () => {
    const s = make([{ key: 'coupon.enabled', scope: 'org_a', enabled: true }]);
    expect(await s.isEnabled('coupon.enabled', 'org_a')).toBe(true);
    expect(await s.isEnabled('coupon.enabled', 'org_b')).toBe(false);
  });
});
