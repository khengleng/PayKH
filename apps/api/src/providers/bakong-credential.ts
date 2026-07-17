/**
 * The decrypted per-store Bakong credential blob.
 *
 * A store can hold one payee account per currency — Wing (and others) issue a
 * separate KHR and USD account, so a USD payment must go to the USD account,
 * not a USD-denominated QR pointed at a KHR account. Accounts are keyed by
 * currency for exactly that reason.
 */

export interface BakongAccount {
  bakongAccountId: string;
  /** Payee account/phone (tag 29 sub-tag 01) — the "receiver account". */
  accountInformation?: string;
  merchantName?: string;
  merchantCity?: string;
  merchantId?: string;
  acquiringBank?: string;
  isMerchant?: boolean;
  /** Per-store Bakong API token (falls back to BAKONG_API_TOKEN). */
  apiToken?: string;
}

export type Currency = 'USD' | 'KHR';

/** Current shape: one account per currency. */
export interface BakongCredentialBlob {
  accounts: Partial<Record<Currency, BakongAccount>>;
}

/**
 * Legacy shape written before multi-currency: a single account at the top level
 * with a `currency` field. Kept readable so existing stores keep working until
 * their next import upgrades them.
 */
interface LegacyBlob extends BakongAccount {
  currency?: Currency;
}

/**
 * Read either shape into a currency→account map. A legacy blob maps to its
 * stored currency (defaulting to KHR, which is what production held), so an old
 * credential never silently routes a payment to the wrong currency.
 */
export function readAccounts(raw: unknown): Partial<Record<Currency, BakongAccount>> {
  const blob = raw as BakongCredentialBlob & LegacyBlob;
  if (blob && typeof blob === 'object' && blob.accounts) return blob.accounts;
  if (blob && typeof blob === 'object' && blob.bakongAccountId) {
    const { currency, ...account } = blob;
    return { [currency ?? 'KHR']: account } as Partial<Record<Currency, BakongAccount>>;
  }
  return {};
}

/** Add/replace one currency's account, preserving the others. */
export function withAccount(
  existing: unknown,
  currency: Currency,
  account: BakongAccount,
): BakongCredentialBlob {
  return { accounts: { ...readAccounts(existing), [currency]: account } };
}

export function currenciesOf(raw: unknown): Currency[] {
  return Object.keys(readAccounts(raw)) as Currency[];
}
