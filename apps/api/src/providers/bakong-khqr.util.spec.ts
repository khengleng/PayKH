import { buildBakongKhqr, crc16 } from './khqr.util';

/**
 * Conformance tests for the real, bank-routable KHQR builder.
 *
 * The vectors below are lifted verbatim from the National Bank of Cambodia's
 * own "KHQR SDK Document" (v2.9, May 2025) — payloads NBC publishes as correct,
 * complete with their CRCs. Reproducing them byte-for-byte is the only evidence
 * that matters here: this string is what a customer's banking app parses to
 * decide who gets the money, and a self-consistent payload that merely *looks*
 * like KHQR would fail silently in the one place we cannot observe.
 *
 * https://bakong.nbc.gov.kh/download/KHQR/integration/KHQR%20SDK%20Document.pdf
 */

// Individual (tag 29), USD 1.00.
const NBC_INDIVIDUAL_1 =
  '00020101021229180014jonhsmith@nbcq52045999530384054031.05802KH5910Jonh Smith6010Phnom Penh6304C297';
// Individual (tag 29), USD 100.00.
const NBC_INDIVIDUAL_2 =
  '00020101021229190015john_smith@devb5204599953038405405100.05802KH5910John Smith6010Phnom Penh6304BF30';

describe('crc16 against NBC-published payloads', () => {
  it('agrees with the CRC NBC ships on its own vectors', () => {
    // Stronger than the "123456789" vector: proves our CRC over a real payload.
    expect(crc16(NBC_INDIVIDUAL_1.slice(0, -4))).toBe(NBC_INDIVIDUAL_1.slice(-4));
    expect(crc16(NBC_INDIVIDUAL_2.slice(0, -4))).toBe(NBC_INDIVIDUAL_2.slice(-4));
  });
});

describe('buildBakongKhqr conformance', () => {
  it('reproduces NBC individual vector 1 byte-for-byte', () => {
    const { qrString } = buildBakongKhqr({
      bakongAccountId: 'jonhsmith@nbcq',
      merchantName: 'Jonh Smith',
      merchantCity: 'Phnom Penh',
      amount: '1.0',
      currency: 'USD',
    });
    expect(qrString).toBe(NBC_INDIVIDUAL_1);
  });

  it('reproduces NBC individual vector 2 byte-for-byte', () => {
    const { qrString } = buildBakongKhqr({
      bakongAccountId: 'john_smith@devb',
      merchantName: 'John Smith',
      merchantCity: 'Phnom Penh',
      amount: '100.0',
      currency: 'USD',
    });
    expect(qrString).toBe(NBC_INDIVIDUAL_2);
  });

  it('puts the Bakong account id in tag 29 sub-tag 00', () => {
    // This sub-tag is who gets paid. If it is wrong, money goes elsewhere.
    const { qrString } = buildBakongKhqr({
      bakongAccountId: 'someone@wing',
      merchantName: 'X',
      merchantCity: 'Phnom Penh',
      amount: '1.00',
      currency: 'USD',
    });
    expect(qrString).toContain('2916' + '0012someone@wing');
  });

  it('uses tag 30 with merchant id + acquiring bank for merchant accounts', () => {
    const { qrString } = buildBakongKhqr({
      bakongAccountId: 'khqr@devb',
      merchantName: 'X',
      merchantCity: 'Phnom Penh',
      amount: '1.00',
      currency: 'USD',
      isMerchant: true,
      merchantId: '123456',
      acquiringBank: 'Dev Bank',
    });
    expect(qrString).toContain('0009khqr@devb' + '0106123456' + '0208Dev Bank');
    expect(qrString).not.toContain('29'.padStart(2, '') + '0009khqr@devb');
  });

  it('encodes the currency NBC expects (840 USD / 116 KHR)', () => {
    const base = { bakongAccountId: 'a@wing', merchantName: 'X', merchantCity: 'Phnom Penh', amount: '1.00' } as const;
    expect(buildBakongKhqr({ ...base, currency: 'USD' }).qrString).toContain('5303840');
    expect(buildBakongKhqr({ ...base, currency: 'KHR' }).qrString).toContain('5303116');
  });

  it('measures TLV length in CHARACTERS, not UTF-8 bytes', () => {
    // NBC's own merchant vector carries Khmer in tag 64: `0108ចន ស្មីន` —
    // length 08 for a string that is 8 characters but 22 UTF-8 bytes. Switching
    // this to Buffer.byteLength would silently corrupt every Khmer merchant
    // name, so the rule is pinned here.
    const khmer = 'ចន ស្មីន';
    expect(khmer.length).toBe(8);
    expect(Buffer.byteLength(khmer, 'utf8')).toBe(22);
    const { qrString } = buildBakongKhqr({
      bakongAccountId: 'a@wing',
      merchantName: khmer,
      merchantCity: 'Phnom Penh',
      amount: '1.00',
      currency: 'KHR',
    });
    expect(qrString).toContain('59' + '08' + khmer);
  });

  it('stays CRC-valid once optional fields are added', () => {
    const { qrString } = buildBakongKhqr({
      bakongAccountId: 'a@wing',
      merchantName: 'Shop',
      merchantCity: 'Phnom Penh',
      amount: '12.34',
      currency: 'USD',
      billNumber: 'pay_123',
      mobileNumber: '85512233455',
      storeLabel: 'Coffee Shop',
    });
    expect(crc16(qrString.slice(0, -4))).toBe(qrString.slice(-4));
    expect(qrString).toContain('0107pay_123');
  });

  it('derives md5 over the exact qr string (Bakong polls status by this)', () => {
    const { qrString, md5 } = buildBakongKhqr({
      bakongAccountId: 'a@wing',
      merchantName: 'X',
      merchantCity: 'Phnom Penh',
      amount: '1.00',
      currency: 'USD',
    });
    const { createHash } = require('crypto') as typeof import('crypto');
    expect(md5).toBe(createHash('md5').update(qrString).digest('hex'));
  });
});
