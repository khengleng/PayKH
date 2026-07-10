import { buildMockKhqr, crc16 } from './khqr.util';

describe('crc16 (CCITT-FALSE)', () => {
  it('matches the well-known "123456789" test vector (0x29B1)', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
});

describe('buildMockKhqr', () => {
  it('produces an EMVCo-style payload beginning with 000201 and a CRC tag', () => {
    const { qrString, md5 } = buildMockKhqr({
      merchantName: 'Demo Coffee Shop',
      merchantCity: 'Phnom Penh',
      amount: '1.50',
      currency: 'USD',
      billNumber: 'order_1024',
    });
    expect(qrString.startsWith('000201')).toBe(true);
    // last 8 chars are "6304" + 4 hex CRC digits
    expect(qrString.slice(-8, -4)).toBe('6304');
    expect(qrString.slice(-4)).toMatch(/^[0-9A-F]{4}$/);
    expect(md5).toMatch(/^[0-9a-f]{32}$/);
  });

  it('embeds the currency code (840 for USD, 116 for KHR)', () => {
    expect(buildMockKhqr({ merchantName: 'x', merchantCity: 'y', amount: '1', currency: 'USD' }).qrString).toContain('5303840');
    expect(buildMockKhqr({ merchantName: 'x', merchantCity: 'y', amount: '1', currency: 'KHR' }).qrString).toContain('5303116');
  });

  it('is CRC-valid: recomputing over the payload matches the trailing checksum', () => {
    const { qrString } = buildMockKhqr({ merchantName: 'x', merchantCity: 'y', amount: '2.00', currency: 'USD' });
    const withoutCrc = qrString.slice(0, -4); // includes "6304"
    expect(crc16(withoutCrc)).toBe(qrString.slice(-4));
  });
});
