import { PayChainIntegrationService } from './paychain-integration.module';

type Row = Record<string, unknown> | null;

function make(opts: { role: string; row?: Row } = { role: 'owner' }) {
  const row: Row = opts.row ?? null;
  const store: { current: Row } = { current: row };
  const prisma = {
    payChainIntegration: {
      findUnique: jest.fn(() => Promise.resolve(store.current)),
      upsert: jest.fn(({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        store.current = store.current ? { ...store.current, ...update } : { ...create, updatedAt: new Date(0) };
        return Promise.resolve(store.current);
      }),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        store.current = { ...(store.current ?? {}), ...data };
        return Promise.resolve(store.current);
      }),
      deleteMany: jest.fn(() => {
        store.current = null;
        return Promise.resolve({ count: 1 });
      }),
    },
  };
  // Base64 rather than `enc(${s})`: a fake cipher whose output contains the
  // plaintext would make the "never leaks the secret" assertions vacuous.
  const crypto = {
    encrypt: jest.fn((s: string) => `enc:${Buffer.from(s, 'utf8').toString('base64')}`),
    decrypt: jest.fn((s: string) => Buffer.from(String(s).replace(/^enc:/, ''), 'base64').toString('utf8')),
  };
  const config = { get: jest.fn(() => 'production') };
  const flags = {
    isEnabled: jest.fn().mockResolvedValue(false),
    setForOrg: jest.fn().mockResolvedValue({}),
  };
  const svc = new PayChainIntegrationService(prisma as never, crypto as never, config as never, flags as never);
  // The real rbac reads memberships off the JWT payload.
  const user = { userId: 'u1', memberships: [{ organizationId: 'org_1', role: opts.role }] } as never;
  return { svc, user, prisma, crypto, flags, store };
}

const dto = { client_id: 'cid', client_secret: 'supersecret-value', loyalty_asset_id: 'asset_1' };

describe('PayChainIntegrationService access control', () => {
  it('lets the tenant owner configure the integration', async () => {
    const { svc, user, crypto } = make({ role: 'owner' });
    await svc.upsert(user, 'org_1', { ...dto });
    expect(crypto.encrypt).toHaveBeenCalledWith('supersecret-value');
  });

  for (const role of ['developer', 'analyst', 'platform_admin']) {
    it(`refuses ${role}`, async () => {
      // Value-moving credentials are owner-only — a platform admin configuring a
      // tenant's own PayChain account would defeat the point of them holding it.
      const { svc, user } = make({ role });
      await expect(svc.upsert(user, 'org_1', { ...dto })).rejects.toThrow(/owner only/);
      await expect(svc.get(user, 'org_1')).rejects.toThrow(/owner only/);
    });
  }

  it('refuses a non-member outright', async () => {
    const { svc } = make({ role: 'owner' });
    const outsider = { userId: 'u2', memberships: [{ organizationId: 'org_other', role: 'owner' }] } as never;
    await expect(svc.get(outsider, 'org_1')).rejects.toThrow();
  });
});

describe('PayChainIntegrationService secret handling', () => {
  it('never returns the raw secret — only a masked preview', async () => {
    const { svc, user } = make({ role: 'owner' });
    await svc.upsert(user, 'org_1', { ...dto });
    const got = (await svc.get(user, 'org_1')) as Record<string, unknown>;
    expect(JSON.stringify(got)).not.toContain('supersecret-value');
    expect(got.client_secret_preview).toBe('supe••••alue');
    expect(got).not.toHaveProperty('client_secret');
  });

  it('encrypts at rest rather than storing plaintext', async () => {
    const { svc, user, store } = make({ role: 'owner' });
    await svc.upsert(user, 'org_1', { ...dto });
    expect(store.current!.secretCiphertext).toBe(`enc:${Buffer.from('supersecret-value').toString('base64')}`);
    expect(JSON.stringify(store.current)).not.toContain('supersecret-value');
  });

  it('keeps the stored secret when it is omitted on update', async () => {
    // So an owner can change the asset id without re-entering a secret they
    // cannot read back.
    const { svc, user, store } = make({ role: 'owner' });
    await svc.upsert(user, 'org_1', { ...dto });
    await svc.upsert(user, 'org_1', { client_id: 'cid', loyalty_asset_id: 'asset_2' });
    expect(store.current!.secretCiphertext).toBe(`enc:${Buffer.from('supersecret-value').toString('base64')}`);
    expect(store.current!.loyaltyAssetId).toBe('asset_2');
  });

  it('requires a secret when first configuring', async () => {
    const { svc, user } = make({ role: 'owner' });
    await expect(svc.upsert(user, 'org_1', { client_id: 'cid', loyalty_asset_id: 'a' })).rejects.toThrow(/client_secret is required/);
  });

  it('invalidates a stale test result when the secret changes', async () => {
    const { svc, user, store } = make({ role: 'owner' });
    await svc.upsert(user, 'org_1', { ...dto });
    store.current!.lastTestOk = true;
    await svc.upsert(user, 'org_1', { ...dto, client_secret: 'rotated-secret' });
    expect(store.current!.lastTestOk).toBeNull();
  });

  it('degrades gracefully when the secret cannot be decrypted', async () => {
    // ENCRYPTION_KEY rotation must not 500 the settings page — the owner needs
    // to be able to get in and re-enter the secret.
    const { svc, user, crypto } = make({ role: 'owner' });
    await svc.upsert(user, 'org_1', { ...dto });
    crypto.decrypt.mockImplementation(() => {
      throw new Error('bad key');
    });
    const got = (await svc.get(user, 'org_1')) as Record<string, unknown>;
    expect(got.client_secret_preview).toBeNull();
    expect(got.configured).toBe(true);
  });
});

describe('PayChainIntegrationService.resolve', () => {
  it('returns nothing while the flag is off, even when configured', async () => {
    const { svc, user, flags } = make({ role: 'owner' });
    await svc.upsert(user, 'org_1', { ...dto });
    flags.isEnabled.mockResolvedValue(false);
    expect(await svc.resolve('org_1')).toBeNull();
  });

  it('returns the decrypted connection once enabled', async () => {
    const { svc, user, flags } = make({ role: 'owner' });
    await svc.upsert(user, 'org_1', { ...dto });
    flags.isEnabled.mockResolvedValue(true);
    expect(await svc.resolve('org_1')).toEqual({
      baseUrl: 'https://api.paychain.cambobia.com',
      clientId: 'cid',
      clientSecret: 'supersecret-value',
      loyaltyAssetId: 'asset_1',
    });
  });

  it('returns nothing when enabled but never configured', async () => {
    const { svc, flags } = make({ role: 'owner' });
    flags.isEnabled.mockResolvedValue(true);
    expect(await svc.resolve('org_1')).toBeNull();
  });
});

describe('PayChainIntegrationService.remove', () => {
  it('disconnects and disables issuance together', async () => {
    // Leaving the flag on with no credentials would fail every earn.
    const { svc, user, flags, store } = make({ role: 'owner' });
    await svc.upsert(user, 'org_1', { ...dto });
    await svc.remove(user, 'org_1');
    expect(store.current).toBeNull();
    expect(flags.setForOrg).toHaveBeenCalledWith(user, 'org_1', 'paychain.enabled', false);
  });
});

describe('PayChainIntegrationService SSRF protection', () => {
  it('rejects a base URL pointing at cloud metadata', async () => {
    // base_url is tenant-supplied and the server POSTs to it on test().
    const { svc, user } = make({ role: 'owner' });
    await expect(
      svc.upsert(user, 'org_1', { ...dto, base_url: 'http://169.254.169.254/latest/meta-data' }),
    ).rejects.toThrow(/rejected/);
  });

  it('rejects loopback in production', async () => {
    const { svc, user } = make({ role: 'owner' });
    await expect(svc.upsert(user, 'org_1', { ...dto, base_url: 'http://127.0.0.1:8080' })).rejects.toThrow(/rejected/);
  });

  it('accepts the real PayChain URL', async () => {
    const { svc, user } = make({ role: 'owner' });
    await expect(svc.upsert(user, 'org_1', { ...dto, base_url: 'https://api.paychain.cambobia.com' })).resolves.toBeDefined();
  });
});
