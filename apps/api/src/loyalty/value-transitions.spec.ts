import {
  canTransitionValue,
  VALUE_TXN_TRANSITIONS,
  SETTLED_VALUE_STATUSES,
  IN_FLIGHT_VALUE_STATUSES,
  ValueTxnStatus,
} from '@paykh/shared-types';

describe('value transaction state machine', () => {
  it('walks the normal provider path pending -> processing -> confirmed', () => {
    expect(canTransitionValue('pending', 'processing')).toBe(true);
    expect(canTransitionValue('processing', 'confirmed')).toBe(true);
  });

  it('lets internal-only value confirm without a provider round-trip', () => {
    expect(canTransitionValue('pending', 'confirmed')).toBe(true);
  });

  it('allows a failure or an ambiguous result from either in-flight state', () => {
    for (const from of ['pending', 'processing'] as ValueTxnStatus[]) {
      expect(canTransitionValue(from, 'failed')).toBe(true);
      expect(canTransitionValue(from, 'manual_review')).toBe(true);
    }
  });

  it('never lets a confirmed reward be silently un-issued', () => {
    // Confirmed value is compensated, never rewritten — reversed is the only exit.
    expect(VALUE_TXN_TRANSITIONS.confirmed).toEqual(['reversed']);
    expect(canTransitionValue('confirmed', 'failed')).toBe(false);
    expect(canTransitionValue('confirmed', 'pending')).toBe(false);
    expect(canTransitionValue('confirmed', 'processing')).toBe(false);
  });

  it('lets a failure be pulled back for review but not straight to confirmed', () => {
    // A provider timeout is reported as a failure yet may have moved value, so
    // an operator must be able to investigate it — without being able to
    // rubber-stamp it confirmed in one hop.
    expect(canTransitionValue('failed', 'manual_review')).toBe(true);
    expect(canTransitionValue('failed', 'confirmed')).toBe(false);
  });

  it('lets review resolve either way', () => {
    expect(canTransitionValue('manual_review', 'confirmed')).toBe(true);
    expect(canTransitionValue('manual_review', 'failed')).toBe(true);
    expect(canTransitionValue('manual_review', 'reversed')).toBe(true);
  });

  it('treats reversed as terminal', () => {
    expect(VALUE_TXN_TRANSITIONS.reversed).toHaveLength(0);
    expect(canTransitionValue('reversed', 'confirmed')).toBe(false);
  });

  it('never re-enters pending from anywhere', () => {
    const states = Object.keys(VALUE_TXN_TRANSITIONS) as ValueTxnStatus[];
    for (const from of states) expect(canTransitionValue(from, 'pending')).toBe(false);
  });

  it('counts only confirmed toward a spendable balance (spec §20)', () => {
    // The whole point of the enum: an unconfirmed reward is not spendable and
    // must not be shown to a customer as final.
    expect(SETTLED_VALUE_STATUSES).toEqual(['confirmed']);
    for (const s of ['pending', 'processing', 'failed', 'manual_review', 'reversed'] as ValueTxnStatus[]) {
      expect(SETTLED_VALUE_STATUSES).not.toContain(s);
    }
  });

  it('treats exactly the states that can still reach confirmed as in-flight', () => {
    for (const s of IN_FLIGHT_VALUE_STATUSES) {
      const reaches = canTransitionValue(s, 'confirmed') || VALUE_TXN_TRANSITIONS[s].some((n) => canTransitionValue(n, 'confirmed'));
      expect(reaches).toBe(true);
    }
    // Terminal-for-our-purposes states are excluded.
    expect(IN_FLIGHT_VALUE_STATUSES).not.toContain('confirmed');
    expect(IN_FLIGHT_VALUE_STATUSES).not.toContain('reversed');
  });
});
