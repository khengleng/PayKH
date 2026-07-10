/** First instant of the current UTC month — the billing/usage period key. */
export function currentPeriodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** First instant of the next UTC month (exclusive period end). */
export function nextPeriodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/** Warning threshold reached for a usage ratio, or null below 70%. */
export function warningLevel(used: number, quota: number): 70 | 90 | 100 | null {
  if (quota < 0) return null; // unlimited
  const pct = quota === 0 ? 100 : (used / quota) * 100;
  if (pct >= 100) return 100;
  if (pct >= 90) return 90;
  if (pct >= 70) return 70;
  return null;
}
