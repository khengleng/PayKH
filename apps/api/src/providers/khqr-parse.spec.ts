import { parseKhqr, buildBakongKhqr } from './khqr.util';

// NBC "KHQR SDK Document" v2.9 (May 2025) published payloads.
const NBC_INDIVIDUAL =
  '00020101021229190015john_smith@devb5204599953038405405100.05802KH5910John Smith6010Phnom Penh6304BF30';

/** A bank's personal "receive" QR: static (tag 01 = 11), no amount. */
function staticIndividual(accountId = 'khengleng@wing', name = 'KHENGLENG TRY', city = 'Phnom Penh') {
  const tlv = (t: string, v: string) => `${t}${v.length.toString().padStart(2, '0')}${v}`;
  const body =
    tlv('00', '01') + tlv('01', '11') + tlv('29', tlv('00', accountId)) +
    tlv('52', '5999') + tlv('53', '840') + tlv('58', 'KH') + tlv('59', name) + tlv('60', city) + '6304';
  // Reuse the builder's CRC so the fixture is genuinely valid.
  const { crc16 } = require('./khqr.util') as typeof import('./khqr.util');
  return body + crc16(body);
}

describe('parseKhqr', () => {
  it('reads NBC’s own published payload', () => {
    const p = parseKhqr(NBC_INDIVIDUAL);
    expect(p.bakongAccountId).toBe('john_smith@devb');
    expect(p.merchantName).toBe('John Smith');
    expect(p.merchantCity).toBe('Phnom Penh');
    expect(p.currency).toBe('USD');
    expect(p.amount).toBe('100.0');
    expect(p.isMerchant).toBe(false);
  });

  it('recognises a bank’s static receive QR (no amount)', () => {
    const p = parseKhqr(staticIndividual());
    expect(p.isStatic).toBe(true);
    expect(p.amount).toBeUndefined();
    expect(p.bakongAccountId).toBe('khengleng@wing');
    expect(p.merchantName).toBe('KHENGLENG TRY');
  });

  it('reads a merchant QR’s id and acquiring bank from tag 30', () => {
    const tlv = (t: string, v: string) => `${t}${v.length.toString().padStart(2, '0')}${v}`;
    const { qrString } = buildBakongKhqr({
      bakongAccountId: 'khqr@devb', merchantName: 'Shop', merchantCity: 'Phnom Penh',
      amount: '1.00', currency: 'USD', isMerchant: true, merchantId: '123456', acquiringBank: 'Dev Bank',
    });
    const p = parseKhqr(qrString);
    expect(p.isMerchant).toBe(true);
    expect(p.bakongAccountId).toBe('khqr@devb');
    expect(p.merchantId).toBe('123456');
    expect(p.acquiringBank).toBe('Dev Bank');
    expect(tlv('00', 'x')).toBe('0001x'); // sanity on the fixture helper
  });

  describe('rejects anything it cannot prove', () => {
    it('a tampered account id (CRC no longer matches)', () => {
      // The attack that matters: swap in your own account and hope nobody checks.
      const tampered = NBC_INDIVIDUAL.replace('john_smith@devb', 'attacker@evilbk');
      expect(() => parseKhqr(tampered)).toThrow(/checksum mismatch/);
    });

    it('a truncated payload', () => {
      expect(() => parseKhqr(NBC_INDIVIDUAL.slice(0, 40))).toThrow();
    });

    it('a payload with no CRC tag', () => {
      expect(() => parseKhqr('000201010212' + '2919' + '0015john_smith@devb')).toThrow(/missing the trailing CRC/);
    });

    it('random text', () => {
      expect(() => parseKhqr('hello world, this is not a qr code at all')).toThrow();
    });

    it('an empty string', () => {
      expect(() => parseKhqr('')).toThrow(/too short/);
    });

    it('a non-KH country code', () => {
      const tlv = (t: string, v: string) => `${t}${v.length.toString().padStart(2, '0')}${v}`;
      const { crc16 } = require('./khqr.util') as typeof import('./khqr.util');
      const body = tlv('00', '01') + tlv('01', '11') + tlv('29', tlv('00', 'a@bank')) + tlv('58', 'SG') + '6304';
      expect(() => parseKhqr(body + crc16(body))).toThrow(/not KH/);
    });

    it('an account id that is not name@bank — it would not route', () => {
      const tlv = (t: string, v: string) => `${t}${v.length.toString().padStart(2, '0')}${v}`;
      const { crc16 } = require('./khqr.util') as typeof import('./khqr.util');
      const body = tlv('00', '01') + tlv('01', '11') + tlv('29', tlv('00', '100587496')) + tlv('58', 'KH') + '6304';
      // A bare account number is exactly the mistake a merchant would make.
      expect(() => parseKhqr(body + crc16(body))).toThrow(/not a Bakong account id/);
    });

    it('a QR with no Bakong account block at all', () => {
      const tlv = (t: string, v: string) => `${t}${v.length.toString().padStart(2, '0')}${v}`;
      const { crc16 } = require('./khqr.util') as typeof import('./khqr.util');
      const body = tlv('00', '01') + tlv('01', '11') + tlv('58', 'KH') + '6304';
      expect(() => parseKhqr(body + crc16(body))).toThrow(/no individual \(29\) or merchant \(30\)/);
    });

    it('a TLV whose length overruns the string', () => {
      const { crc16 } = require('./khqr.util') as typeof import('./khqr.util');
      const body = '000201' + '0102' + '11' + '2999' + '0015john_smith@devb' + '6304';
      expect(() => parseKhqr(body + crc16(body))).toThrow();
    });
  });
});

describe('import → reissue (the product flow)', () => {
  it('reissues an imported static QR as a dynamic one for the SAME account', () => {
    // This is the whole feature: a merchant uploads the QR their bank gave
    // them, and PayKH charges specific amounts against that same account.
    const imported = parseKhqr(staticIndividual('khengleng@wing', 'KHENGLENG TRY'));
    const { qrString } = buildBakongKhqr({
      bakongAccountId: imported.bakongAccountId,
      merchantName: imported.merchantName!,
      merchantCity: imported.merchantCity!,
      amount: '7.25',
      currency: 'USD',
      billNumber: 'pay_abc',
    });
    const reissued = parseKhqr(qrString);
    expect(reissued.bakongAccountId).toBe('khengleng@wing'); // money still goes to them
    expect(reissued.amount).toBe('7.25');
    expect(reissued.isStatic).toBe(false); // now dynamic
    expect(reissued.merchantName).toBe('KHENGLENG TRY');
  });

  it('round-trips every field it claims to extract', () => {
    const p = parseKhqr(NBC_INDIVIDUAL);
    const { qrString } = buildBakongKhqr({
      bakongAccountId: p.bakongAccountId,
      merchantName: p.merchantName!,
      merchantCity: p.merchantCity!,
      amount: '100.0',
      currency: 'USD',
    });
    expect(qrString).toBe(NBC_INDIVIDUAL); // byte-identical back to NBC's vector
  });
});
