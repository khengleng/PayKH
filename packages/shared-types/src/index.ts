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
  expired: [],
  failed: [],
  cancelled: [],
  refunded: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

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
