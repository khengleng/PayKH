import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Webhook signing per the spec:
 *   header: X-Payment-Signature: t=<timestamp>,v1=<hex-hmac>
 *   hmac  : HMAC-SHA256( secret, `${timestamp}.${rawBody}` )
 */

const DEFAULT_TOLERANCE_SECONDS = 5 * 60; // 5-minute tolerance

/** Generate a new webhook signing secret (whsec_ prefix). */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/** Compute the raw hex HMAC over `${timestamp}.${rawBody}`. */
export function computeSignature(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/** Build the full `t=...,v1=...` signature header value. */
export function buildSignatureHeader(secret: string, rawBody: string, timestamp: number): string {
  const v1 = computeSignature(secret, timestamp, rawBody);
  return `t=${timestamp},v1=${v1}`;
}

/**
 * Build a header signed with several secrets at once (`t=..,v1=..,v1=..`),
 * Stripe-style. Used during secret rotation so a consumer that has updated to
 * EITHER the old or the new secret can still verify — verifySignature accepts a
 * match against any `v1`.
 */
export function buildSignatureHeaderMulti(secrets: string[], rawBody: string, timestamp: number): string {
  const v1s = secrets.map((s) => `v1=${computeSignature(s, timestamp, rawBody)}`);
  return [`t=${timestamp}`, ...v1s].join(',');
}

interface ParsedSignature {
  timestamp: number;
  /** First v1 (back-compat). */
  v1: string;
  /** All v1 candidates present in the header. */
  v1s: string[];
}

export function parseSignatureHeader(header: string): ParsedSignature | null {
  const parts = header.split(',').map((p) => p.trim());
  let timestamp: number | undefined;
  const v1s: string[] = [];
  for (const part of parts) {
    const [k, v] = part.split('=', 2);
    if (k === 't') timestamp = Number(v);
    if (k === 'v1' && v) v1s.push(v);
  }
  if (timestamp === undefined || Number.isNaN(timestamp) || v1s.length === 0) return null;
  return { timestamp, v1: v1s[0], v1s };
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface VerifyOptions {
  toleranceSeconds?: number;
  /** Injectable clock for tests (seconds since epoch). */
  nowSeconds?: number;
}

export interface VerifyResult {
  valid: boolean;
  reason?: 'malformed' | 'timestamp_out_of_tolerance' | 'signature_mismatch';
}

/**
 * Verify a webhook signature. Uses constant-time comparison and enforces a
 * timestamp tolerance to prevent replay attacks.
 */
export function verifySignature(
  secret: string,
  rawBody: string,
  header: string,
  options: VerifyOptions = {},
): VerifyResult {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { valid: false, reason: 'malformed' };

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { valid: false, reason: 'timestamp_out_of_tolerance' };
  }

  const expected = computeSignature(secret, parsed.timestamp, rawBody);
  // Accept a match against any presented v1 (a rotation window may carry the
  // signatures of several valid secrets). Compare all candidates in constant
  // time and OR the results so timing doesn't reveal which one matched.
  let matched = false;
  for (const candidate of parsed.v1s) {
    if (safeEqualHex(expected, candidate)) matched = true;
  }
  if (!matched) {
    return { valid: false, reason: 'signature_mismatch' };
  }
  return { valid: true };
}
