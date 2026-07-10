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

  it('rejects transitions out of terminal states', () => {
    expect(canTransition('expired', 'paid')).toBe(false);
    expect(canTransition('cancelled', 'paid')).toBe(false);
    expect(canTransition('failed', 'paid')).toBe(false);
  });

  it('rejects skipping straight back to pending', () => {
    expect(canTransition('scanned', 'pending')).toBe(false);
  });
});
