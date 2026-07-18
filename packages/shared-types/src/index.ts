// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

export type PaymentStatus =
  | 'pending'
  | 'scanned'
  | 'paid'
  | 'expired'
  | 'failed'
  | 'cancelled'
  | 'refunded';

/**
 * Allowed state transitions. `paid` is terminal for the MVP (no refunds yet).
 * The API rejects any transition not listed here.
 */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ['scanned', 'paid', 'expired', 'failed', 'cancelled'],
  scanned: ['paid', 'expired', 'failed', 'cancelled'],
  paid: ['refunded'], // fully refunded
  // A "late payment": the QR's expiry window lapsed, but the money genuinely
  // arrived and a trusted source says so — a cashier confirming a matched bank
  // alert (Telegram assist mode), or a provider webhook/poll landing after the
  // sweep. Reviving to paid is correct; the internal 5-min timer is not the
  // source of truth for a real-world bank transfer. No other outbound edge:
  // expired stays terminal for everything except a confirmed receipt.
  expired: ['paid'],
  failed: [],
  cancelled: [],
  refunded: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Digital value transactions
// ---------------------------------------------------------------------------

/**
 * Lifecycle of anything that moves value (loyalty points today; cashback,
 * gift-card and merchant-credit balances later).
 *
 * The distinction that matters: a value transaction is only *final* at
 * `confirmed`. Everything before that is a claim we have submitted but the
 * value provider has not acknowledged, so it must never be presented to a
 * customer as a settled reward.
 *
 * Legacy, purely-internal value never leaves this process, so it is written
 * straight to `confirmed`. Once PayChain is issuing, an entry sits at
 * `pending`/`processing` until a webhook or a status poll confirms it.
 */
export type ValueTxnStatus =
  | 'pending' // recorded locally, not yet submitted to the provider
  | 'processing' // submitted, provider has not confirmed
  | 'confirmed' // provider confirmed — final, and the only status a customer may be shown as settled
  | 'failed' // provider rejected it
  | 'manual_review' // ambiguous (timeout after submit, reconciliation mismatch) — a human decides
  | 'reversed'; // compensated after confirmation

/**
 * Allowed transitions.
 *
 * `pending → confirmed` is permitted so internal-only value (and the mock
 * provider) need not fake a round-trip through `processing`.
 *
 * `failed → manual_review` exists because a provider "failure" can still have
 * moved value on their side — a timeout after submission is reported as a
 * failure but may well have succeeded, so an operator must be able to pull it
 * back for investigation rather than trusting the failure at face value.
 *
 * `confirmed → reversed` is the only exit from `confirmed`: value that has been
 * confirmed is never deleted, only compensated by an opposing entry.
 */
export const VALUE_TXN_TRANSITIONS: Record<ValueTxnStatus, ValueTxnStatus[]> = {
  pending: ['processing', 'confirmed', 'failed', 'manual_review'],
  processing: ['confirmed', 'failed', 'manual_review'],
  confirmed: ['reversed'],
  failed: ['manual_review'],
  manual_review: ['confirmed', 'failed', 'reversed'],
  reversed: [],
};

export function canTransitionValue(from: ValueTxnStatus, to: ValueTxnStatus): boolean {
  return VALUE_TXN_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses that count toward a spendable balance. */
export const SETTLED_VALUE_STATUSES: ValueTxnStatus[] = ['confirmed'];

/** Statuses that can still become `confirmed`, i.e. worth polling/awaiting. */
export const IN_FLIGHT_VALUE_STATUSES: ValueTxnStatus[] = ['pending', 'processing', 'manual_review'];

export type KeyMode = 'test' | 'live';
export type Currency = 'USD' | 'KHR';

export interface PaymentResource {
  id: string;
  status: PaymentStatus;
  amount: string; // decimal string, e.g. "1.50"
  currency: Currency;
  reference_id: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  qr_string: string;
  checkout_url: string;
  created_at: string; // ISO 8601
  expires_at: string; // ISO 8601
  paid_at?: string | null;
  refunded_amount?: string; // cumulative refunded, decimal string
  branch_id?: string | null;
  customer_id?: string | null;
}

export interface RefundResource {
  id: string;
  payment_id: string;
  amount: string;
  currency: Currency;
  reason: string | null;
  status: 'succeeded' | 'pending' | 'failed';
  created_at: string;
}

export interface CreatePaymentRequest {
  amount: string;
  currency: Currency;
  reference_id?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  expires_in_seconds?: number;
  branch_id?: string;
  customer_id?: string;
}

export interface ListPaymentsQuery {
  status?: PaymentStatus;
  reference_id?: string;
  created_from?: string;
  created_to?: string;
  limit?: number;
  cursor?: string;
}

export interface PaginatedList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

// ---------------------------------------------------------------------------
// Webhooks (contract defined in Phase 1; delivery worker lands in Phase 2)
// ---------------------------------------------------------------------------

export type WebhookEventType =
  | 'payment.created'
  | 'payment.scanned'
  | 'payment.completed'
  | 'payment.expired'
  | 'payment.failed'
  | 'payment.cancelled'
  | 'payment.refunded';

export interface WebhookEventPayload {
  id: string;
  type: WebhookEventType;
  created: string;
  data: {
    payment: {
      id: string;
      status: PaymentStatus;
      amount: string;
      currency: Currency;
      reference_id: string | null;
      metadata: Record<string, unknown>;
      approved_at?: string | null;
      amount_refunded?: string;
    };
  };
}

/** Maps a terminal/interesting payment status to its webhook event type. */
export const STATUS_TO_EVENT: Partial<Record<PaymentStatus, WebhookEventType>> = {
  scanned: 'payment.scanned',
  paid: 'payment.completed',
  expired: 'payment.expired',
  failed: 'payment.failed',
  cancelled: 'payment.cancelled',
  refunded: 'payment.refunded',
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'invalid_request'
  | 'amount_too_low'
  | 'amount_too_high'
  | 'payment_not_found'
  | 'payment_expired'
  | 'payment_provider_error'
  | 'quota_exceeded'
  | 'rate_limit_exceeded'
  | 'idempotency_conflict'
  | 'internal_error';

export interface ApiErrorBody {
  error: ApiErrorCode;
  message: string;
  request_id: string;
}

/** Default HTTP status for each error code. */
export const ERROR_HTTP_STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  invalid_request: 400,
  amount_too_low: 400,
  amount_too_high: 400,
  payment_not_found: 404,
  payment_expired: 409,
  payment_provider_error: 502,
  quota_exceeded: 402,
  rate_limit_exceeded: 429,
  idempotency_conflict: 409,
  internal_error: 500,
};

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

export type MemberRole =
  | 'owner'
  | 'developer'
  | 'analyst'
  | 'platform_admin';
