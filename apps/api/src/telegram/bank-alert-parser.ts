/**
 * Extract an amount + currency from a bank's payment-alert text.
 *
 * Banks phrase these differently ("You have received 5,000 KHR from…",
 * "Received USD 12.50", "៛5000 paid to you"), so this is deliberately lenient
 * about wording but strict about the number: it pairs a currency token with an
 * adjacent amount and returns nothing when it cannot, rather than guessing.
 *
 * The hard part is that a REAL alert almost always also states a running
 * balance — "Received 20,000 KHR from JOHN. Available balance: 1,234,567 KHR" —
 * and often a fee. Naively refusing any message with more than one number would
 * make the parser reject nearly every genuine alert, so it distinguishes the
 * received amount from balance/fee figures by the label that precedes each
 * number and refuses only when two figures are genuinely both plausible
 * payments.
 *
 * Getting the amount wrong only ever produces a candidate the cashier will not
 * confirm (assist mode never auto-confirms), so a miss is safe — but a confident
 * wrong parse is noise, so real ambiguity returns null.
 */

export interface ParsedAlert {
  amount: string; // canonical decimal string, e.g. "5000" or "12.50"
  currency: 'USD' | 'KHR';
}

const CURRENCY_TOKENS: { re: RegExp; currency: 'USD' | 'KHR' }[] = [
  { re: /\bKHR\b|៛|riel/i, currency: 'KHR' },
  { re: /\bUSD\b|\$|dollar/i, currency: 'USD' },
];

/** A number possibly with thousands separators and up to 2 decimals. */
const AMOUNT = /\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g;

/**
 * Only treat a message as a *received* payment. A merchant chat may also carry
 * balance updates, outgoing transfers, OTPs, etc. — none of which are an
 * incoming payment to confirm.
 */
const RECEIVE_HINT = /(received|payment|paid|credited|top ?up|deposit|បង់|ទទួល)/i;

/**
 * A number preceded by one of these labels is NOT the payment — it is the
 * account balance, a fee, or a reference/transaction figure. Real Wing/ABA/
 * ACLEDA alerts append the new balance (and sometimes a fee and a transaction
 * id) after the received amount, so these figures must be excluded before
 * deciding which number is the payment. The trailing `[^0-9]{0,15}$` lets a
 * currency symbol or punctuation ("balance: ៛", "balance is now $") sit between
 * the label word and its number, but no other digits — so the label must be the
 * one immediately before this figure.
 */
const NON_PAYMENT_LABEL =
  /\b(balance|available|remaining|avail|bal|fee|charge|charges|commission|ref|reference|trx|txn|transaction|invoice|inv|order|id)\b[^0-9]{0,15}$|no\.[^0-9]{0,15}$|(?:សមតុល្យ|កម្រៃ)[^0-9]{0,15}$/i;

export function parseBankAlert(text: string): ParsedAlert | null {
  if (!text || !RECEIVE_HINT.test(text)) return null;

  let currency: 'USD' | 'KHR' | null = null;
  for (const t of CURRENCY_TOKENS) {
    if (t.re.test(text)) {
      // A message naming BOTH currencies is ambiguous — refuse it. (A balance
      // stated in the other currency is rare enough that refusing is the safe
      // call.)
      if (currency) return null;
      currency = t.currency;
    }
  }
  if (!currency) return null;

  // Collect every number together with the text immediately before it, so a
  // "balance:"/"fee:" label can be recognised and that figure dropped.
  const candidates: string[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const value = m[0].replace(/,/g, '');
    if (!(Number(value) > 0)) continue; // skip 0 and non-numbers
    // A digit-run glued to a letter is part of an alphanumeric token — a
    // transaction id like "9f2c1", not a money amount. Skip it.
    const prevCh = m.index > 0 ? text[m.index - 1] : '';
    const nextCh = text[m.index + m[0].length] ?? '';
    if (/[A-Za-z]/.test(prevCh) || /[A-Za-z]/.test(nextCh)) continue;
    const before = text.slice(0, m.index);
    if (NON_PAYMENT_LABEL.test(before)) continue; // it's a balance/fee/ref, not the payment
    candidates.push(canonical(value));
  }

  const distinct = Array.from(new Set(candidates));
  // Exactly one plausible payment figure → take it. Zero (every number looked
  // like a balance/fee) or several genuinely-ambiguous figures → refuse rather
  // than pick wrong.
  if (distinct.length !== 1) return null;

  return { amount: distinct[0], currency };
}

/** Trim trailing zeros so "5000.00" and "5000" compare equal downstream. */
function canonical(n: string): string {
  if (!n.includes('.')) return n;
  return n.replace(/\.?0+$/, '');
}
