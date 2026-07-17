import { createHash } from 'crypto';

/**
 * Minimal EMVCo / Bakong KHQR payload builder for the MOCK provider.
 *
 * This produces a *syntactically valid* KHQR-like string (EMVCo TLV encoding
 * with a CRC16-CCITT checksum) so front-ends can render a scannable-looking QR
 * during development. It is NOT a real, bank-routable KHQR — the real Bakong
 * provider (Phase 2) generates production payloads via the NBC SDK.
 */

/** Encode a single Tag-Length-Value field. Length is zero-padded to 2 digits. */
function tlv(tag: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${tag}${len}${value}`;
}

/** CRC16-CCITT (0xFFFF init, 0x1021 poly) — the EMVCo QR checksum. */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface KhqrParams {
  merchantName: string;
  merchantCity: string;
  amount: string;
  currency: 'USD' | 'KHR';
  billNumber?: string;
  storeLabel?: string;
}

const CURRENCY_CODE: Record<'USD' | 'KHR', string> = {
  USD: '840',
  KHR: '116',
};

export interface BakongKhqrParams {
  /** Bakong account id, e.g. "shop_name@bank". */
  bakongAccountId: string;
  merchantName: string;
  merchantCity: string;
  /**
   * Omit for a STATIC qr — the payer enters the amount, which is what a bank's
   * own "receive" QR is. Supplying one makes it dynamic and fixes the amount.
   */
  amount?: string;
  currency: 'USD' | 'KHR';
  /**
   * The payee's own account or phone number (tag 29 sub-tag 01) — what banking
   * apps show as the "receiver account". Individual accounts only; merchants
   * use merchantId in the same slot.
   */
  accountInformation?: string;
  /** Optional merchant id / acquiring bank for the merchant-present tag. */
  merchantId?: string;
  acquiringBank?: string;
  billNumber?: string;
  mobileNumber?: string;
  storeLabel?: string;
  /** true → merchant (tag 30) with merchantId; false → individual (tag 29). */
  isMerchant?: boolean;
}

/**
 * Build a Bakong KHQR payload per the NBC KHQR spec. Used by the real
 * BakongKhqrProvider. Individual accounts use tag 29; merchant accounts use
 * tag 30 (which also carries the merchant id + acquiring bank).
 */
export function buildBakongKhqr(p: BakongKhqrParams): { qrString: string; md5: string } {
  const isMerchant = p.isMerchant ?? false;
  const accountTag = isMerchant ? '30' : '29';
  // Sub-tag 01 is the payee's own account/phone number — what banking apps
  // surface as the "receiver account". NBC lists it optional, but real issuers
  // include it and at least one bank refuses a QR without it, so carry it
  // whenever we have it. For a merchant (tag 30) the same sub-tag holds the
  // merchant id instead.
  const accountInfo =
    tlv('00', p.bakongAccountId) +
    (isMerchant
      ? p.merchantId ? tlv('01', p.merchantId) : ''
      : p.accountInformation ? tlv('01', p.accountInformation) : '') +
    (p.acquiringBank ? tlv('02', p.acquiringBank) : '');

  let payload = '';
  payload += tlv('00', '01');
  // No amount => static QR: the payer types the amount, exactly like a bank's
  // own receive QR. An amount makes it dynamic and fixes the figure.
  payload += tlv('01', p.amount === undefined ? '11' : '12');
  payload += tlv(accountTag, accountInfo);
  payload += tlv('52', '5999');
  payload += tlv('53', CURRENCY_CODE[p.currency]);
  if (p.amount !== undefined) payload += tlv('54', p.amount);
  payload += tlv('58', 'KH');
  payload += tlv('59', p.merchantName.slice(0, 25));
  payload += tlv('60', p.merchantCity.slice(0, 15));

  const additional =
    (p.billNumber ? tlv('01', p.billNumber.slice(0, 25)) : '') +
    (p.mobileNumber ? tlv('02', p.mobileNumber.slice(0, 25)) : '') +
    (p.storeLabel ? tlv('03', p.storeLabel.slice(0, 25)) : '');
  if (additional) payload += tlv('62', additional);

  payload += '6304';
  const qrString = payload + crc16(payload);
  const md5 = createHash('md5').update(qrString).digest('hex');
  return { qrString, md5 };
}

// ---------------------------------------------------------------- decoding

export interface ParsedKhqr {
  /** true when the QR carries no amount (a bank's "receive" QR). */
  isStatic: boolean;
  /** Tag 30 (merchant) rather than tag 29 (individual). */
  isMerchant: boolean;
  /** Tag 29/30 sub-tag 00 — the account that gets paid. */
  bakongAccountId: string;
  /** Sub-tag 01: account or phone number. */
  accountInformation?: string;
  /** Merchant-only sub-tags. */
  merchantId?: string;
  acquiringBank?: string;
  merchantName?: string;
  merchantCity?: string;
  currency?: 'USD' | 'KHR';
  amount?: string;
}

/** Split an EMVCo TLV string into [tag, value] pairs. Rejects malformed input. */
function parseTlv(s: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < s.length) {
    if (i + 4 > s.length) throw new Error('Truncated TLV: a tag/length header is incomplete');
    const tag = s.slice(i, i + 2);
    const lenRaw = s.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(lenRaw)) throw new Error(`Invalid length "${lenRaw}" for tag ${tag}`);
    const len = parseInt(lenRaw, 10);
    const value = s.slice(i + 4, i + 4 + len);
    if (value.length !== len) throw new Error(`Tag ${tag} claims ${len} chars but only ${value.length} remain`);
    out.set(tag, value);
    i += 4 + len;
  }
  return out;
}

const CODE_TO_CURRENCY: Record<string, 'USD' | 'KHR'> = { '840': 'USD', '116': 'KHR' };

/**
 * Parse and validate a KHQR payload — e.g. one a merchant exported from their
 * own banking app so PayKH can reissue it with an amount.
 *
 * Everything here is attacker-supplied, so nothing is trusted without proof:
 * the CRC is recomputed before any field is believed, and a payload that is not
 * recognisably KHQR is rejected rather than half-read. Getting this wrong sends
 * a customer's money to whatever account the string happened to name, so it
 * fails loudly instead of guessing.
 */
export function parseKhqr(qrString: string): ParsedKhqr {
  const qr = qrString.trim();
  if (qr.length < 12) throw new Error('Not a KHQR payload: too short');

  // CRC first. Tag 63 is always last and covers everything up to and including
  // its own "6304" header.
  const crcIdx = qr.lastIndexOf('6304');
  if (crcIdx === -1 || crcIdx !== qr.length - 8) {
    throw new Error('Not a KHQR payload: missing the trailing CRC (tag 63)');
  }
  const expected = crc16(qr.slice(0, crcIdx + 4));
  const actual = qr.slice(-4).toUpperCase();
  if (expected !== actual) {
    throw new Error(`KHQR checksum mismatch (expected ${expected}, got ${actual}) — the code is corrupt or was retyped`);
  }

  const top = parseTlv(qr.slice(0, crcIdx));
  if (top.get('00') !== '01') throw new Error('Not a KHQR payload: unexpected payload format indicator');

  const initiation = top.get('01');
  if (initiation !== '11' && initiation !== '12') {
    throw new Error(`Not a KHQR payload: unexpected point-of-initiation "${initiation}"`);
  }

  const isMerchant = top.has('30');
  const accountBlock = top.get('30') ?? top.get('29');
  if (!accountBlock) {
    throw new Error('Not a Bakong KHQR: no individual (29) or merchant (30) account block');
  }
  const acct = parseTlv(accountBlock);
  const bakongAccountId = acct.get('00');
  if (!bakongAccountId) throw new Error('KHQR is missing the Bakong account id');
  // Bakong ids are "name@bank". Anything else would not route.
  if (!/^[^@\s]+@[^@\s]+$/.test(bakongAccountId)) {
    throw new Error(`"${bakongAccountId}" is not a Bakong account id (expected name@bank)`);
  }

  const country = top.get('58');
  if (country && country.toUpperCase() !== 'KH') {
    throw new Error(`KHQR is for country ${country}, not KH`);
  }

  const currencyCode = top.get('53');
  return {
    isStatic: initiation === '11',
    isMerchant,
    bakongAccountId,
    accountInformation: acct.get('01'),
    merchantId: isMerchant ? acct.get('01') : undefined,
    acquiringBank: acct.get('02'),
    merchantName: top.get('59'),
    merchantCity: top.get('60'),
    currency: currencyCode ? CODE_TO_CURRENCY[currencyCode] : undefined,
    amount: top.get('54'),
  };
}

export function buildMockKhqr(params: KhqrParams): { qrString: string; md5: string } {
  const merchantAccount = tlv('00', 'mock@paykh') + tlv('01', 'PayKH Mock Acquirer');

  let payload = '';
  payload += tlv('00', '01'); // payload format indicator
  payload += tlv('01', '12'); // dynamic QR (point of initiation)
  payload += tlv('29', merchantAccount); // merchant account information (Bakong = 29)
  payload += tlv('52', '5999'); // merchant category code (misc)
  payload += tlv('53', CURRENCY_CODE[params.currency]);
  payload += tlv('54', params.amount);
  payload += tlv('58', 'KH'); // country
  payload += tlv('59', params.merchantName.slice(0, 25));
  payload += tlv('60', params.merchantCity.slice(0, 15));

  // Additional data field (62): bill number / store label.
  const additional =
    (params.billNumber ? tlv('01', params.billNumber.slice(0, 25)) : '') +
    (params.storeLabel ? tlv('03', params.storeLabel.slice(0, 25)) : '');
  if (additional) {
    payload += tlv('62', additional);
  }

  // CRC: tag 63, length 04, computed over everything including "6304".
  payload += '6304';
  const checksum = crc16(payload);
  const qrString = payload + checksum;

  const md5 = createHash('md5').update(qrString).digest('hex');
  return { qrString, md5 };
}
