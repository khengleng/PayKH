import { canTransition, PAYMENT_TRANSITIONS } from '@paykh/shared-types';

describe('payment state machine', () => {
  it('allows pending -> scanned -> paid', () => {
    expect(canTransition('pending', 'scanned')).toBe(true);
    expect(canTransition('scanned', 'paid')).toBe(true);
  });

  it('allows pending -> expired / failed / cancelled', () => {
    expect(canTransition('pending', 'expired')).toBe(true);
    expect(canTransition('pending', 'failed')).toBe(true);
    expect(canTransition('pending', 'cancelled')).toBe(true);
  });

  it('allows paid -> refunded (only)', () => {
    expect(canTransition('paid', 'refunded')).toBe(true);
    expect(canTransition('paid', 'cancelled')).toBe(false);
    expect(canTransition('paid', 'expired')).toBe(false);
    expect(PAYMENT_TRANSITIONS.refunded).toHaveLength(0); // refunded is terminal
  });

  it('allows an expired payment to be revived to paid (late real-world receipt)', () => {
    // The QR's 5-min window can lapse before a cashier confirms a matched bank
    // alert, or before a provider poll/webhook lands — but the money arrived.
    expect(canTransition('expired', 'paid')).toBe(true);
    // ...and nothing else out of expired.
    expect(canTransition('expired', 'scanned')).toBe(false);
    expect(canTransition('expired', 'cancelled')).toBe(false);
    expect(canTransition('expired', 'refunded')).toBe(false);
  });

  it('rejects reviving cancelled/failed payments', () => {
    expect(canTransition('cancelled', 'paid')).toBe(false);
    expect(canTransition('failed', 'paid')).toBe(false);
  });

  it('rejects skipping straight back to pending', () => {
    expect(canTransition('scanned', 'pending')).toBe(false);
  });
});
