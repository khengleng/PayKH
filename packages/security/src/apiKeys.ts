import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export type ApiKeyMode = 'test' | 'live';

export interface GeneratedApiKey {
  /** The full secret, shown to the merchant exactly once. e.g. bk_live_xxx */
  token: string;
  /** SHA-256 hex digest of the token — this is what we store & index. */
  tokenHash: string;
  /** Human-friendly display prefix stored for the dashboard, e.g. bk_live_ab12 */
  displayPrefix: string;
  /** Last 4 characters for display, e.g. "cD9x" */
  last4: string;
  mode: ApiKeyMode;
}

const PREFIX: Record<ApiKeyMode, string> = {
  test: 'bk_test_',
  live: 'bk_live_',
};

/**
 * API keys are high-entropy (256-bit) random tokens, so a fast one-way hash
 * (SHA-256) is sufficient and enables O(1) indexed lookup. Unlike passwords,
 * they do not need a slow KDF because brute-forcing 256 bits is infeasible.
 */
export function hashApiKey(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Generate a new API key for the given mode. */
export function generateApiKey(mode: ApiKeyMode): GeneratedApiKey {
  const secret = randomBytes(32).toString('base64url'); // 43 chars, url-safe
  const token = `${PREFIX[mode]}${secret}`;
  const tokenHash = hashApiKey(token);
  return {
    token,
    tokenHash,
    displayPrefix: `${PREFIX[mode]}${secret.slice(0, 4)}`,
    last4: secret.slice(-4),
    mode,
  };
}

/** Parse the mode from a token prefix; returns null if unrecognized. */
export function apiKeyMode(token: string): ApiKeyMode | null {
  if (token.startsWith(PREFIX.live)) return 'live';
  if (token.startsWith(PREFIX.test)) return 'test';
  return null;
}

/**
 * Constant-time comparison of two hex hashes. Lookup is done by indexed hash,
 * but we still compare in constant time as defense-in-depth.
 */
export function verifyApiKey(token: string, storedHash: string): boolean {
  const computed = hashApiKey(token);
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
