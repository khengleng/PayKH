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
  amount: string;
  currency: 'USD' | 'KHR';
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
  const accountInfo =
    tlv('00', p.bakongAccountId) +
    (isMerchant && p.merchantId ? tlv('01', p.merchantId) : '') +
    (isMerchant && p.acquiringBank ? tlv('02', p.acquiringBank) : '');

  let payload = '';
  payload += tlv('00', '01');
  payload += tlv('01', '12'); // dynamic
  payload += tlv(accountTag, accountInfo);
  payload += tlv('52', '5999');
  payload += tlv('53', CURRENCY_CODE[p.currency]);
  payload += tlv('54', p.amount);
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
