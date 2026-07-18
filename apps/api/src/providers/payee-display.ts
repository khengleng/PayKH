/**
 * Turn a stored Bakong account into a payer-facing "who you're paying" block.
 *
 * A Bakong account id is `handle@bank` — the part after `@` is the member
 * institution's code (`aba`, `wing`, `acleda`, …). We map the common Cambodian
 * banks to a friendly name; anything unrecognised falls back to a title-cased
 * code so a new bank still shows something sensible rather than a raw token.
 *
 * The account owner's name is tag 59 (merchantName) from the QR they uploaded.
 * None of this is secret — it is printed on the merchant's own bank QR — so it
 * is safe to show an unauthenticated payer.
 */
import { BakongAccount } from './bakong-credential';

const BANK_NAMES: Record<string, string> = {
  aba: 'ABA Bank',
  wing: 'Wing Bank',
  acleda: 'ACLEDA Bank',
  acledabank: 'ACLEDA Bank',
  aclb: 'ACLEDA Bank',
  canadia: 'Canadia Bank',
  cadi: 'Canadia Bank',
  phillipbank: 'Phillip Bank',
  phillip: 'Phillip Bank',
  prince: 'Prince Bank',
  princebank: 'Prince Bank',
  sathapana: 'Sathapana Bank',
  spbank: 'Sathapana Bank',
  ftb: 'Foreign Trade Bank',
  cpbank: 'Campu Bank',
  campubank: 'Campu Bank',
  vattanac: 'Vattanac Bank',
  vtb: 'Vattanac Bank',
  maybank: 'Maybank',
  chipmong: 'Chip Mong Bank',
  cmcb: 'Chip Mong Bank',
  amk: 'AMK',
  amret: 'Amret',
  truemoney: 'TrueMoney',
  wooribank: 'Woori Bank',
  woori: 'Woori Bank',
  aeon: 'AEON',
  ababank: 'ABA Bank',
};

function titleCase(s: string): string {
  return s.replace(/(^|[\s_-])(\w)/g, (_, sep, ch) => sep + ch.toUpperCase());
}

export interface BankIdentity {
  /** Lower-case institution code from the account id (`aba`, `wing`, …). */
  code: string | null;
  /** Friendly name for display, or null if the id has no `@bank` part. */
  name: string | null;
}

/** Extract the bank from a `handle@bank` Bakong account id. */
export function bankFromAccountId(accountId: string): BankIdentity {
  const at = accountId.split('@')[1];
  if (!at) return { code: null, name: null };
  const code = at.trim().toLowerCase();
  return { code, name: BANK_NAMES[code] ?? titleCase(at.trim()) };
}

export interface Payee {
  /** Account owner / shop name (tag 59). */
  name: string | null;
  /** Full Bakong account id — where the money lands. Not a secret. */
  account_id: string;
  bank_code: string | null;
  bank_name: string | null;
  account_type: 'merchant' | 'individual';
}

/** Build the payer-facing payee block from a stored account. */
export function payeeFromAccount(account: BakongAccount): Payee {
  const bank = bankFromAccountId(account.bakongAccountId);
  return {
    name: account.merchantName ?? null,
    account_id: account.bakongAccountId,
    bank_code: bank.code,
    bank_name: bank.name,
    account_type: account.isMerchant ? 'merchant' : 'individual',
  };
}
