import { createHmac, timingSafeEqual } from 'crypto';

export type PaymentStatus =
  | 'pending' | 'scanned' | 'paid' | 'expired' | 'failed' | 'cancelled' | 'refunded';

export interface Payment {
  id: string;
  status: PaymentStatus;
  amount: string;
  currency: 'USD' | 'KHR';
  reference_id: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  qr_string: string;
  checkout_url: string;
  created_at: string;
  expires_at: string;
  paid_at?: string | null;
}

export interface CreatePaymentParams {
  amount: string;
  currency: 'USD' | 'KHR';
  reference_id?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  expires_in_seconds?: number;
}

export interface ListParams {
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

export class PayKHError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'PayKHError';
  }
}

export interface PayKHOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * PayKH API client.
 *
 * ```ts
 * const paykh = new PayKH('bk_live_xxx');
 * const payment = await paykh.payments.create({ amount: '1.50', currency: 'USD' });
 * ```
 */
export class PayKH {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  readonly payments: {
    create: (params: CreatePaymentParams, opts?: { idempotencyKey?: string }) => Promise<Payment>;
    retrieve: (id: string) => Promise<Payment>;
    list: (params?: ListParams) => Promise<PaginatedList<Payment>>;
    cancel: (id: string) => Promise<Payment>;
  };

  readonly webhooks = { verify: verifyWebhook, constructEvent };

  constructor(private readonly apiKey: string, options: PayKHOptions = {}) {
    if (!apiKey) throw new Error('An API key is required');
    this.baseUrl = (options.baseUrl ?? 'https://api.paykh.cambobia.com').replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;

    this.payments = {
      create: (params, opts) =>
        this.request('POST', '/v1/payments', { body: params, idempotencyKey: opts?.idempotencyKey }),
      retrieve: (id) => this.request('GET', `/v1/payments/${encodeURIComponent(id)}`),
      list: (params) => this.request('GET', `/v1/payments${toQuery(params as Record<string, unknown> | undefined)}`),
      cancel: (id) => this.request('POST', `/v1/payments/${encodeURIComponent(id)}/cancel`),
    };
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      };
      if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const err = (data ?? {}) as { error?: string; message?: string; request_id?: string };
        throw new PayKHError(err.error ?? 'error', err.message ?? `HTTP ${res.status}`, res.status, err.request_id);
      }
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

function toQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

export interface VerifyResult {
  valid: boolean;
  reason?: 'malformed' | 'timestamp_out_of_tolerance' | 'signature_mismatch';
}

/**
 * Verify an inbound webhook signature.
 * @param rawBody the exact request body bytes/string received
 * @param signatureHeader value of the `X-Payment-Signature` header
 * @param secret the endpoint signing secret (whsec_...)
 */
export function verifyWebhook(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifyResult {
  const parts = (signatureHeader ?? '').split(',').map((p) => p.trim());
  let t: number | undefined;
  let v1: string | undefined;
  for (const part of parts) {
    const [k, val] = part.split('=', 2);
    if (k === 't') t = Number(val);
    if (k === 'v1') v1 = val;
  }
  if (t === undefined || Number.isNaN(t) || !v1) return { valid: false, reason: 'malformed' };
  if (Math.abs(nowSeconds - t) > toleranceSeconds) {
    return { valid: false, reason: 'timestamp_out_of_tolerance' };
  }
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: 'signature_mismatch' };
  }
  return { valid: true };
}

/** Verify + parse a webhook event; throws PayKHError on invalid signature. */
export function constructEvent(rawBody: string, signatureHeader: string, secret: string): unknown {
  const result = verifyWebhook(rawBody, signatureHeader, secret);
  if (!result.valid) {
    throw new PayKHError('invalid_signature', `Webhook signature verification failed: ${result.reason}`, 400);
  }
  return JSON.parse(rawBody);
}
