import { Prisma } from '@prisma/client';

/** Structured, safe segment filter (no free-form SQL). All present rules AND. */
export interface SegmentRules {
  min_lifetime_points?: number;
  min_points_balance?: number;
  tier_id?: string;
  has_email?: boolean;
  min_paid_count?: number;
  min_paid_volume?: number; // decimal string or number
  last_payment_within_days?: number;
}

export function needsPaymentAggregates(rules: SegmentRules): boolean {
  return (
    rules.min_paid_count != null ||
    rules.min_paid_volume != null ||
    rules.last_payment_within_days != null
  );
}

export interface CustomerAgg {
  count: number;
  volume: Prisma.Decimal;
  lastPaidAt: Date | null;
}

/** Does a customer's payment aggregates satisfy the payment-based rules? */
export function matchesAggregates(agg: CustomerAgg | undefined, rules: SegmentRules, now: Date): boolean {
  const a = agg ?? { count: 0, volume: new Prisma.Decimal(0), lastPaidAt: null };
  if (rules.min_paid_count != null && a.count < rules.min_paid_count) return false;
  if (rules.min_paid_volume != null && a.volume.lessThan(rules.min_paid_volume)) return false;
  if (rules.last_payment_within_days != null) {
    if (!a.lastPaidAt) return false;
    const cutoff = new Date(now.getTime() - rules.last_payment_within_days * 24 * 3600 * 1000);
    if (a.lastPaidAt < cutoff) return false;
  }
  return true;
}
