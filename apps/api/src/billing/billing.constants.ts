/**
 * Sentinel store id for PLATFORM subscription payments. These are kept on a
 * SEPARATE ledger (the Invoice table) from merchant customer payments (the
 * Payment table) — the two never mix, per the billing spec.
 */
export const PLATFORM_STORE_ID = '__platform__';

/** Days a subscription invoice stays open before dunning. */
export const INVOICE_DUE_DAYS = 7;
/** Grace days after the due date before the org is suspended. */
export const GRACE_DAYS = 3;
