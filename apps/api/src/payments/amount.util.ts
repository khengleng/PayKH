import { Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error';

/**
 * Per-currency amount bounds. Amounts are handled as decimal strings end-to-end
 * to avoid floating-point rounding; the DB column is Decimal(20,4).
 */
const BOUNDS: Record<'USD' | 'KHR', { min: string; max: string; decimals: number }> = {
  USD: { min: '0.01', max: '100000.00', decimals: 2 },
  // KHR has no minor unit — amounts are whole riel (KHQR tag 54 must be integer).
  KHR: { min: '100', max: '400000000', decimals: 0 },
};

const AMOUNT_RE = /^\d{1,15}(\.\d{1,4})?$/;

export function validateAmount(amount: string, currency: 'USD' | 'KHR'): Prisma.Decimal {
  if (typeof amount !== 'string' || !AMOUNT_RE.test(amount)) {
    throw ApiError.invalidRequest('Amount must be a decimal string, e.g. "1.50"');
  }
  const value = new Prisma.Decimal(amount);
  const bounds = BOUNDS[currency];
  // Reject precision finer than the currency's minor unit — otherwise the stored
  // amount (Decimal(20,4)) would differ from the rounded amount charged/embedded
  // in the QR, and refund math would drift by sub-unit dust.
  if (value.decimalPlaces() > bounds.decimals) {
    throw ApiError.invalidRequest(
      bounds.decimals === 0
        ? `${currency} amounts must be whole numbers (no decimals)`
        : `Amount must not have more than ${bounds.decimals} decimal places`,
    );
  }
  if (value.lessThan(bounds.min)) {
    throw ApiError.amountTooLow(`Amount must be at least ${bounds.min} ${currency}`);
  }
  if (value.greaterThan(bounds.max)) {
    throw ApiError.amountTooHigh(`Amount must not exceed ${bounds.max} ${currency}`);
  }
  return value;
}

/** Format a Decimal as a fixed-decimals string for API output. */
export function formatAmount(value: Prisma.Decimal, currency: 'USD' | 'KHR'): string {
  return value.toFixed(BOUNDS[currency].decimals);
}
