import { computeSettlementAmounts } from './settlement.util';

describe('computeSettlementAmounts', () => {
  it('no fee: net = gross - refunds', () => {
    const r = computeSettlementAmounts('100.00', '10.00', 0);
    expect(r.fee.toFixed(2)).toBe('0.00');
    expect(r.net.toFixed(2)).toBe('90.00');
  });

  it('1% fee (100 bps) on gross', () => {
    const r = computeSettlementAmounts('100.00', '0', 100);
    expect(r.fee.toFixed(2)).toBe('1.00');
    expect(r.net.toFixed(2)).toBe('99.00');
  });

  it('fee applies to refund-net volume (matches the ledger fee reversal)', () => {
    const r = computeSettlementAmounts('200.00', '50.00', 250); // 2.5%
    // netVolume = 200 - 50 = 150; fee = 150 * 2.5% = 3.75; net = 150 - 3.75
    expect(r.fee.toFixed(2)).toBe('3.75');
    expect(r.net.toFixed(2)).toBe('146.25');
  });

  it('fully-refunded volume owes no fee (agrees with a zero ledger balance)', () => {
    const r = computeSettlementAmounts('100.00', '100.00', 200); // 2%
    expect(r.fee.toFixed(2)).toBe('0.00');
    expect(r.net.toFixed(2)).toBe('0.00');
  });

  it('rounds fee to 4dp', () => {
    const r = computeSettlementAmounts('1.50', '0', 30); // 0.3% => 0.0045
    expect(r.fee.toString()).toBe('0.0045');
  });
});
