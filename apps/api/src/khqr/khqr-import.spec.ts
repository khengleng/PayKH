import { KhqrImportService } from './khqr-import.module';
import { crc16, parseKhqr } from '../providers/khqr.util';

const tlv = (t: string, v: string) => `${t}${v.length.toString().padStart(2, '0')}${v}`;

/** A bank's static "receive" QR. `cur`: 116 = KHR, 840 = USD. */
function bankQr(accountId = 'khengleng@wing', cur = '116', name = 'KHENGLENG TRY') {
  const body =
    tlv('00', '01') + tlv('01', '11') + tlv('29', tlv('00', accountId)) +
    tlv('52', '5999') + tlv('53', cur) + tlv('58', 'KH') + tlv('59', name) + tlv('60', 'Phnom Penh') + '6304';
  return body + crc16(body);
}

type Row = { id: string; secretCiphertext: string; label: string; updatedAt: Date };

function make(role = 'owner') {
  const rows = new Map<string, Row>();
  const prisma = {
    store: { findUnique: jest.fn().mockResolvedValue({ id: 's1', organizationId: 'org_1' }) },
    providerCredential: {
      upsert: jest.fn((args: { where: { storeId_provider_mode: { mode: string } }; create: Partial<Row>; update: Partial<Row> }) => {
        const key = args.where.storeId_provider_mode.mode;
        const prev = rows.get(key);
        const next: Row = { id: 'cred_' + key, updatedAt: new Date(0), secretCiphertext: '', label: '', ...(prev ?? {}), ...(prev ? args.update : args.create) };
        rows.set(key, next);
        return Promise.resolve(next);
      }),
      findUnique: jest.fn((args: { where: { storeId_provider_mode: { mode: string } } }) =>
        Promise.resolve(rows.get(args.where.storeId_provider_mode.mode) ?? null)),
      update: jest.fn((args: { where: { id: string }; data: Partial<Row> }) => {
        for (const [k, r] of rows) if (r.id === args.where.id) rows.set(k, { ...r, ...args.data });
        return Promise.resolve({});
      }),
      deleteMany: jest.fn(() => { rows.clear(); return Promise.resolve({ count: 1 }); }),
    },
  };
  const crypto = {
    encrypt: jest.fn((s: string) => `enc:${Buffer.from(s, 'utf8').toString('base64')}`),
    decrypt: jest.fn((s: string) => Buffer.from(String(s).replace(/^enc:/, ''), 'base64').toString('utf8')),
  };
  const svc = new KhqrImportService(prisma as never, crypto as never);
  const user = { userId: 'u1', memberships: [{ organizationId: 'org_1', role }] } as never;
  return { svc, user, rows, crypto };
}

describe('KhqrImportService.import', () => {
  it('reads the account and its currency from the QR', async () => {
    const { svc, user } = make();
    const r = await svc.import(user, 's1', { qr_string: bankQr('khengleng@wing', '116') });
    expect(r.imported).toBe(true);
    expect(r.just_imported).toBe('KHR');
    expect(r.accounts).toEqual([
      expect.objectContaining({ currency: 'KHR', bakong_account_id: 'khengleng@wing', account_type: 'individual' }),
    ]);
  });

  it('returns an amount-free (static) sample QR naming the account', async () => {
    const { svc, user } = make();
    const r = await svc.import(user, 's1', { qr_string: bankQr() });
    const sample = parseKhqr(r.sample_qr as string);
    expect(sample.bakongAccountId).toBe('khengleng@wing');
    expect(sample.amount).toBeUndefined();
    expect(sample.isStatic).toBe(true);
  });

  it('holds BOTH a KHR and a USD account for one store', async () => {
    // Kimkhun's Wing card has separate KHR and USD accounts; a USD payment must
    // reach the USD account, not a USD QR pointed at the KHR one.
    const { svc, user } = make();
    await svc.import(user, 's1', { qr_string: bankQr('wing_khr@wing', '116') });
    const r = await svc.import(user, 's1', { qr_string: bankQr('wing_usd@wing', '840') });
    expect(r.accounts).toHaveLength(2);
    expect(r.accounts.find((a) => a.currency === 'KHR')?.bakong_account_id).toBe('wing_khr@wing');
    expect(r.accounts.find((a) => a.currency === 'USD')?.bakong_account_id).toBe('wing_usd@wing');
  });

  it('importing the same currency again replaces just that currency', async () => {
    const { svc, user } = make();
    await svc.import(user, 's1', { qr_string: bankQr('wing_khr@wing', '116') });
    await svc.import(user, 's1', { qr_string: bankQr('wing_usd@wing', '840') });
    const r = await svc.import(user, 's1', { qr_string: bankQr('new_khr@wing', '116') });
    expect(r.accounts.find((a) => a.currency === 'KHR')?.bakong_account_id).toBe('new_khr@wing');
    expect(r.accounts.find((a) => a.currency === 'USD')?.bakong_account_id).toBe('wing_usd@wing'); // untouched
  });

  it('encrypts the blob at rest', async () => {
    const { svc, user, rows } = make();
    await svc.import(user, 's1', { qr_string: bankQr() });
    const stored = rows.get('TEST')!;
    expect(stored.secretCiphertext.startsWith('enc:')).toBe(true);
    expect(stored.secretCiphertext).not.toContain('khengleng@wing');
  });

  describe('rejects what would misroute money', () => {
    it('a tampered QR (checksum)', async () => {
      const { svc, user, rows } = make();
      const tampered = bankQr('khengleng@wing').replace('khengleng@wing', 'attacker@evilbk');
      await expect(svc.import(user, 's1', { qr_string: tampered })).rejects.toThrow(/checksum mismatch/);
      expect(rows.size).toBe(0);
    });

    it('a bare account number, not a Bakong id', async () => {
      const { svc, user } = make();
      const body = tlv('00', '01') + tlv('01', '11') + tlv('29', tlv('00', '100587496')) + tlv('53', '116') + tlv('58', 'KH') + '6304';
      await expect(svc.import(user, 's1', { qr_string: body + crc16(body) })).rejects.toThrow(/not a Bakong account id/);
    });

    it('a QR with no currency and none supplied', async () => {
      const { svc, user } = make();
      const body = tlv('00', '01') + tlv('01', '11') + tlv('29', tlv('00', 'a@wing')) + tlv('58', 'KH') + '6304';
      await expect(svc.import(user, 's1', { qr_string: body + crc16(body) })).rejects.toThrow(/does not state a currency/);
    });

    it('but accepts a no-currency QR when the currency is supplied', async () => {
      const { svc, user } = make();
      const body = tlv('00', '01') + tlv('01', '11') + tlv('29', tlv('00', 'a@wing')) + tlv('58', 'KH') + '6304';
      const r = await svc.import(user, 's1', { qr_string: body + crc16(body), currency: 'USD' });
      expect(r.just_imported).toBe('USD');
    });

    it('an analyst without store:write', async () => {
      const { svc, user, rows } = make('analyst');
      await expect(svc.import(user, 's1', { qr_string: bankQr() })).rejects.toThrow();
      expect(rows.size).toBe(0);
    });
  });
});

describe('KhqrImportService.preview / counter', () => {
  it('builds a static QR for a specific currency', async () => {
    const { svc, user } = make();
    await svc.import(user, 's1', { qr_string: bankQr('wing_khr@wing', '116') });
    const r = await svc.preview(user, 's1', undefined, 'KHR');
    const p = parseKhqr(r.qr_string);
    expect(p.bakongAccountId).toBe('wing_khr@wing');
    expect(p.isStatic).toBe(true);
    expect(p.currency).toBe('KHR');
  });

  it('refuses to build a QR for a currency the store has not imported', async () => {
    // The whole point: never issue a USD QR against a KHR-only account.
    const { svc, user } = make();
    await svc.import(user, 's1', { qr_string: bankQr('wing_khr@wing', '116') });
    await expect(svc.preview(user, 's1', undefined, 'USD')).rejects.toThrow(/No USD account imported/);
  });
});

describe('KhqrImportService.get / remove', () => {
  it('reports nothing before an import', async () => {
    const { svc, user } = make();
    expect(await svc.get(user, 's1')).toEqual({ imported: false, mode: 'test' });
  });

  it('lists every imported currency', async () => {
    const { svc, user } = make();
    await svc.import(user, 's1', { qr_string: bankQr('wing_khr@wing', '116') });
    await svc.import(user, 's1', { qr_string: bankQr('wing_usd@wing', '840') });
    const r = (await svc.get(user, 's1')) as { accounts: { currency: string }[] };
    expect(r.accounts.map((a) => a.currency).sort()).toEqual(['KHR', 'USD']);
  });

  it('removes one currency and keeps the other', async () => {
    const { svc, user } = make();
    await svc.import(user, 's1', { qr_string: bankQr('wing_khr@wing', '116') });
    await svc.import(user, 's1', { qr_string: bankQr('wing_usd@wing', '840') });
    const r = (await svc.remove(user, 's1', 'test', 'USD')) as { imported: boolean; accounts: { currency: string }[] };
    expect(r.imported).toBe(true);
    expect(r.accounts.map((a) => a.currency)).toEqual(['KHR']);
  });

  it('removing the last currency clears the credential', async () => {
    const { svc, user } = make();
    await svc.import(user, 's1', { qr_string: bankQr('wing_khr@wing', '116') });
    expect(await svc.remove(user, 's1', 'test', 'KHR')).toEqual({ imported: false, mode: 'test' });
    expect(await svc.get(user, 's1')).toEqual({ imported: false, mode: 'test' });
  });

  it('degrades gracefully when the credential cannot be decrypted', async () => {
    const { svc, user, crypto } = make();
    await svc.import(user, 's1', { qr_string: bankQr() });
    crypto.decrypt.mockImplementation(() => { throw new Error('bad key'); });
    const r = (await svc.get(user, 's1')) as { unreadable?: boolean };
    expect(r.unreadable).toBe(true);
  });
});
