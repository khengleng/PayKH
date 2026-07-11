import { Prisma } from '@prisma/client';
import { matchesAggregates, needsPaymentAggregates } from './segment-rules';

const now = new Date('2026-07-11T00:00:00Z');
const agg = (count: number, volume: string, lastPaidAt: Date | null) => ({ count, volume: new Prisma.Decimal(volume), lastPaidAt });

describe('segment aggregate matching', () => {
  it('needsPaymentAggregates detects payment-derived rules', () => {
    expect(needsPaymentAggregates({ min_lifetime_points: 10 })).toBe(false);
    expect(needsPaymentAggregates({ min_paid_count: 2 })).toBe(true);
    expect(needsPaymentAggregates({ min_paid_volume: 5 })).toBe(true);
    expect(needsPaymentAggregates({ last_payment_within_days: 30 })).toBe(true);
  });

  it('min_paid_count', () => {
    expect(matchesAggregates(agg(3, '30', now), { min_paid_count: 2 }, now)).toBe(true);
    expect(matchesAggregates(agg(1, '30', now), { min_paid_count: 2 }, now)).toBe(false);
    expect(matchesAggregates(undefined, { min_paid_count: 1 }, now)).toBe(false);
  });

  it('min_paid_volume', () => {
    expect(matchesAggregates(agg(1, '100.00', now), { min_paid_volume: 50 }, now)).toBe(true);
    expect(matchesAggregates(agg(1, '49.99', now), { min_paid_volume: 50 }, now)).toBe(false);
  });

  it('last_payment_within_days (recency)', () => {
    const recent = new Date(now.getTime() - 5 * 24 * 3600 * 1000);
    const old = new Date(now.getTime() - 40 * 24 * 3600 * 1000);
    expect(matchesAggregates(agg(1, '10', recent), { last_payment_within_days: 30 }, now)).toBe(true);
    expect(matchesAggregates(agg(1, '10', old), { last_payment_within_days: 30 }, now)).toBe(false);
    expect(matchesAggregates(agg(1, '10', null), { last_payment_within_days: 30 }, now)).toBe(false);
  });

  it('combined rules AND together', () => {
    const recent = new Date(now.getTime() - 5 * 24 * 3600 * 1000);
    expect(matchesAggregates(agg(3, '100', recent), { min_paid_count: 2, min_paid_volume: 50, last_payment_within_days: 30 }, now)).toBe(true);
    expect(matchesAggregates(agg(3, '20', recent), { min_paid_count: 2, min_paid_volume: 50 }, now)).toBe(false);
  });
});
