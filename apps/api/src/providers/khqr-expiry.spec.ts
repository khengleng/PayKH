import { buildBakongKhqr, parseKhqr, crc16 } from './khqr.util';

const NBC = '00020101021229190015john_smith@devb5204599953038405405100.05802KH5910John Smith6010Phnom Penh6304BF30';

/** Parse tag 99 out of a payload (sub 00 = created ms, sub 01 = expires ms). */
function tag99(qr: string): { created?: string; expires?: string } | null {
  const body = qr.slice(0, -4);
  let i = 0;
  while (i < body.length) {
    const tag = body.slice(i, i + 2); const len = parseInt(body.slice(i + 2, i + 4), 10);
    const val = body.slice(i + 4, i + 4 + len);
    if (tag === '99') {
      const out: Record<string, string> = {};
      let j = 0;
      while (j < val.length) { const st = val.slice(j, j + 2); const sl = parseInt(val.slice(j + 2, j + 4), 10); out[st] = val.slice(j + 4, j + 4 + sl); j += 4 + sl; }
      return { created: out['00'], expires: out['01'] };
    }
    i += 4 + len;
  }
  return null;
}

describe('KHQR dynamic-QR expiration timestamp (tag 99)', () => {
  it('a STATIC QR carries no tag 99 (NBC vector stays byte-identical)', () => {
    const { qrString } = buildBakongKhqr({ bakongAccountId: 'john_smith@devb', merchantName: 'John Smith', merchantCity: 'Phnom Penh', amount: '100.0', currency: 'USD' });
    expect(qrString).toBe(NBC); // amount but no expiresAt → no tag 99, matches NBC exactly
    // and a truly static one:
    const s = buildBakongKhqr({ bakongAccountId: 'a@wing', merchantName: 'X', merchantCity: 'Phnom Penh', currency: 'KHR' });
    expect(tag99(s.qrString)).toBeNull();
  });

  it('a DYNAMIC QR with an expiry carries tag 99', () => {
    const expiresAt = new Date(1739324796824 + 15 * 60_000);
    const { qrString } = buildBakongKhqr({
      bakongAccountId: 'a@wing', accountInformation: '012345678', merchantName: 'Shop', merchantCity: 'Phnom Penh',
      amount: '3000', currency: 'KHR', expiresAt, createdAtMs: 1739324796824,
    });
    const t = tag99(qrString);
    expect(t).not.toBeNull();
    expect(t!.created).toBe('1739324796824');
    expect(t!.expires).toBe(String(expiresAt.getTime()));
    expect(t!.expires!.length).toBe(13); // 13-digit ms epoch per NBC
  });

  it('the dynamic QR stays CRC-valid and parses back', () => {
    const { qrString } = buildBakongKhqr({
      bakongAccountId: 'a@wing', accountInformation: '012345678', merchantName: 'Shop', merchantCity: 'Phnom Penh',
      amount: '3000', currency: 'KHR', expiresAt: new Date(Date.now() + 9e5),
    });
    expect(crc16(qrString.slice(0, -4))).toBe(qrString.slice(-4));
    const p = parseKhqr(qrString);
    expect(p.bakongAccountId).toBe('a@wing');
    expect(p.amount).toBe('3000');
  });

  it('the expiration is in the future (not read as already expired)', () => {
    const { qrString } = buildBakongKhqr({
      bakongAccountId: 'a@wing', merchantName: 'X', merchantCity: 'Phnom Penh',
      amount: '5.00', currency: 'USD', expiresAt: new Date(Date.now() + 6e5),
    });
    expect(Number(tag99(qrString)!.expires)).toBeGreaterThan(Date.now());
  });
});
