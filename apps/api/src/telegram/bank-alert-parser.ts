/**
 * Extract an amount + currency from a bank's payment-alert text.
 *
 * Banks phrase these differently ("You have received 5,000 KHR from…",
 * "Received USD 12.50", "៛5000 paid to you"), so this is deliberately lenient
 * about wording but strict about the number: it pairs a currency token with an
 * adjacent amount and returns nothing when it cannot, rather than guessing.
 *
 * Getting the amount wrong only ever produces a candidate the cashier will not
 * confirm (assist mode never auto-confirms), so a miss is safe — but a confident
 * wrong parse is noise, so ambiguity returns null.
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
const AMOUNT = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;

/**
 * Only treat a message as a *received* payment. A merchant chat may also carry
 * balance updates, outgoing transfers, OTPs, etc. — none of which are an
 * incoming payment to confirm.
 */
const RECEIVE_HINT = /(received|payment|paid|credited|top ?up|deposit|បង់|ទទួល)/i;

export function parseBankAlert(text: string): ParsedAlert | null {
  if (!text || !RECEIVE_HINT.test(text)) return null;

  let currency: 'USD' | 'KHR' | null = null;
  for (const t of CURRENCY_TOKENS) {
    if (t.re.test(text)) {
      // A message naming BOTH currencies is ambiguous — refuse it.
      if (currency) return null;
      currency = t.currency;
    }
  }
  if (!currency) return null;

  const nums = text.match(AMOUNT);
  if (!nums) return null;

  // Normalise and drop zero/invalid. Keep the distinct non-zero values; if the
  // message contains several different amounts (e.g. amount + running balance),
  // we cannot tell which is the payment, so refuse rather than pick wrong.
  const values = Array.from(
    new Set(
      nums
        .map((n) => n.replace(/,/g, ''))
        .filter((n) => Number(n) > 0)
        .map((n) => canonical(n)),
    ),
  );
  if (values.length !== 1) return null;

  return { amount: values[0], currency };
}

/** Trim trailing zeros so "5000.00" and "5000" compare equal downstream. */
function canonical(n: string): string {
  if (!n.includes('.')) return n;
  return n.replace(/\.?0+$/, '');
}
