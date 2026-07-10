import { randomBytes } from 'crypto';

/**
 * Base58 alphabet (Bitcoin) — avoids ambiguous characters (0/O, l/I).
 * Used for the random portion of prefixed resource ids.
 */
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Generate a random base58 string of the given length using CSPRNG. */
export function randomBase58(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += BASE58[bytes[i] % BASE58.length];
  }
  return out;
}

/**
 * Prefixed, sortable-ish resource identifier, e.g. `pay_3xK9...`.
 * Not a ULID — Phase 1 uses random ids; ordering is done via createdAt columns.
 */
export function prefixedId(prefix: string, length = 24): string {
  return `${prefix}_${randomBase58(length)}`;
}

export const ids = {
  payment: () => prefixedId('pay'),
  event: () => prefixedId('evt'),
  request: () => prefixedId('req', 20),
  webhookDelivery: () => prefixedId('whd'),
  organization: () => prefixedId('org'),
  store: () => prefixedId('store'),
  apiKey: () => prefixedId('key'),
};
