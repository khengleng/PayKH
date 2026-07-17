import { KhqrImportService } from './khqr-import.module';
import { crc16, parseKhqr } from '../providers/khqr.util';

const tlv = (t: string, v: string) => `${t}${v.length.toString().padStart(2, '0')}${v}`;

/** A bank's static personal "receive" QR — what a merchant would actually upload. */
function bankReceiveQr(accountId = 'khengleng@wing', name = 'KHENGLENG TRY') {
  const body =
    tlv('00', '01') + tlv('01', '11') + tlv('29', tlv('00', accountId)) +
    tlv('52', '5999') + tlv('53', '840') + tlv('58', 'KH') + tlv('59', name) + tlv('60', 'Phnom Penh') + '6304';
  return body + crc16(body);
}

function make(role = 'owner') {
  type Row = { secretCiphertext: string; label: string; updatedAt: Date };
  const rows = new Map<string, Row>();
  const prisma = {
    store: { findUnique: jest.fn().mockResolvedValue({ id: 's1', organizationId: 'org_1' }) },
    providerCredential: {
      upsert: jest.fn((args: { where: { storeId_provider_mode: { mode: string } }; create: Partial<Row>; update: Partial<Row> }) => {
        const key = args.where.storeId_provider_mode.mode;
        const prev = rows.get(key);
        const next: Row = { updatedAt: new Date(0), secretCiphertext: '', label: '', ...(prev ?? {}), ...(prev ? args.update : args.create) };
        rows.set(key, next);
        return Promise.resolve(next);
      }),
      findUnique: jest.fn((args: { where: { storeId_provider_mode: { mode: string } } }) =>
        Promise.resolve(rows.get(args.where.storeId_provider_mode.mode) ?? null),
      ),
      deleteMany: jest.fn(() => { rows.clear(); return Promise.resolve({ count: 1 }); }),
    },
  };
  // Base64 stand-in: a fake cipher echoing the plaintext would make the
  // "encrypted at rest" assertion vacuous.
  const crypto = {
    encrypt: jest.fn((s: string) => `enc:${Buffer.from(s, 'utf8').toString('base64')}`),
    decrypt: jest.fn((s: string) => Buffer.from(String(s).replace(/^enc:/, ''), 'base64').toString('utf8')),
  };
  const svc = new KhqrImportService(prisma as never, crypto as never);
  // get() returns a union (imported | not | unreadable); tests assert on the
  // imported shape, so narrow once here rather than casting at every call.
  const getImported = (u: never, s: string, m?: 'test' | 'live') =>
    svc.get(u, s, m) as Promise<Record<string, unknown>>;
  const user = { userId: 'u1', memberships: [{ organizationId: 'org_1', role }] } as never;
  return { svc, user, rows, crypto, prisma, getImported };
}

describe('KhqrImportService.import', () => {
  it('reads the Bakong account out of a bank receive QR', async () => {
    const { svc, user } = make();
    const r = await svc.import(user, 's1', { qr_string: bankReceiveQr() });
    expect(r.imported).toBe(true);
    expect(r.bakong_account_id).toBe('khengleng@wing');
    expect(r.merchant_name).toBe('KHENGLENG TRY');
    expect(r.account_type).toBe('individual');
    expect(r.source_was_static).toBe(true);
  });

  it('returns a sample QR that names the same account with an amount', async () => {
    // The merchant should be able to scan this and see their own name before
    // trusting it with live payments.
    const { svc, user } = make();
    const r = await svc.import(user, 's1', { qr_string: bankReceiveQr() });
    const sample = parseKhqr(r.sample_qr as string);
    expect(sample.bakongAccountId).toBe('khengleng@wing');
    expect(sample.amount).toBe('1.00');
    expect(sample.isStatic).toBe(false); // reissued as dynamic
  });

  it('encrypts the credential at rest', async () => {
    const { svc, user, rows } = make();
    await svc.import(user, 's1', { qr_string: bankReceiveQr() });
    const stored = rows.get('TEST')!;
    expect(stored.secretCiphertext.startsWith('enc:')).toBe(true);
    expect(stored.secretCiphertext).not.toContain('khengleng@wing');
  });

  it('keeps test and live accounts separate', async () => {
    const { svc, user, rows, getImported } = make();
    await svc.import(user, 's1', { qr_string: bankReceiveQr('a@wing'), mode: 'test' });
    await svc.import(user, 's1', { qr_string: bankReceiveQr('b@aba'), mode: 'live' });
    expect(rows.size).toBe(2);
    expect((await getImported(user, 's1', 'test')).bakong_account_id).toBe('a@wing');
    expect((await getImported(user, 's1', 'live')).bakong_account_id).toBe('b@aba');
  });

  it('re-importing replaces the account rather than duplicating it', async () => {
    const { svc, user, rows, getImported } = make();
    await svc.import(user, 's1', { qr_string: bankReceiveQr('old@wing') });
    await svc.import(user, 's1', { qr_string: bankReceiveQr('new@wing') });
    expect(rows.size).toBe(1);
    expect((await getImported(user, 's1')).bakong_account_id).toBe('new@wing');
  });

  it('works for any bank — the point of the feature', async () => {
    for (const id of ['x@wing', 'y@aba', 'z@acleda', 'w@devb']) {
      const { svc, user } = make();
      expect((await svc.import(user, 's1', { qr_string: bankReceiveQr(id) })).bakong_account_id).toBe(id);
    }
  });

  describe('rejects what would misroute money', () => {
    it('a tampered QR (checksum)', async () => {
      const { svc, user, rows } = make();
      const tampered = bankReceiveQr('khengleng@wing').replace('khengleng@wing', 'attacker@evilbk');
      await expect(svc.import(user, 's1', { qr_string: tampered })).rejects.toThrow(/checksum mismatch/);
      expect(rows.size).toBe(0); // nothing stored
    });

    it('a bare account number — the mistake a merchant will actually make', async () => {
      // "100 587 496" is printed on the card; it is NOT the Bakong id.
      const { svc, user } = make();
      const body = tlv('00', '01') + tlv('01', '11') + tlv('29', tlv('00', '100587496')) + tlv('58', 'KH') + '6304';
      await expect(svc.import(user, 's1', { qr_string: body + crc16(body) })).rejects.toThrow(/not a Bakong account id/);
    });

    it('a non-KHQR string', async () => {
      const { svc, user } = make();
      await expect(svc.import(user, 's1', { qr_string: 'https://example.com/pay/123' })).rejects.toThrow(/Could not read that KHQR/);
    });

    it('a QR from another country', async () => {
      const { svc, user } = make();
      const body = tlv('00', '01') + tlv('01', '11') + tlv('29', tlv('00', 'a@bank')) + tlv('58', 'SG') + '6304';
      await expect(svc.import(user, 's1', { qr_string: body + crc16(body) })).rejects.toThrow(/not KH/);
    });

    it('an analyst without store:write', async () => {
      const { svc, user, rows } = make('analyst');
      await expect(svc.import(user, 's1', { qr_string: bankReceiveQr() })).rejects.toThrow();
      expect(rows.size).toBe(0);
    });
  });
});

describe('KhqrImportService.get / remove', () => {
  it('reports nothing before an import', async () => {
    const { svc, user } = make();
    expect(await svc.get(user, 's1')).toEqual({ imported: false, mode: 'test' });
  });

  it('degrades gracefully when the credential cannot be decrypted', async () => {
    const { svc, user, crypto } = make();
    await svc.import(user, 's1', { qr_string: bankReceiveQr() });
    crypto.decrypt.mockImplementation(() => { throw new Error('bad key'); });
    const r = await svc.get(user, 's1');
    expect(r.unreadable).toBe(true);
    expect(r.detail).toMatch(/re-import/);
  });

  it('removes the account', async () => {
    const { svc, user } = make();
    await svc.import(user, 's1', { qr_string: bankReceiveQr() });
    expect(await svc.remove(user, 's1')).toEqual({ imported: false, mode: 'test' });
    expect(await svc.get(user, 's1')).toEqual({ imported: false, mode: 'test' });
  });
});
