import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * SSRF protection for outbound webhook delivery. Rejects URLs whose host (or
 * any resolved IP) is loopback, private, link-local, or a cloud metadata
 * endpoint. Private ranges are permitted only when allowPrivate is true (dev),
 * so local testing works while production is protected.
 */

function isBlockedIp(ip: string): boolean {
  const v = ip.replace(/^::ffff:/i, ''); // unwrap IPv4-mapped IPv6
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 0) return true;
    return false;
  }
  // IPv6
  const lower = v.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('fe80')) return true; // link-local
  return false;
}

export interface SsrfCheck {
  ok: boolean;
  reason?: string;
}

export async function assertSafeUrl(rawUrl: string, allowPrivate: boolean): Promise<SsrfCheck> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'only http/https allowed' };
  }
  if (allowPrivate) return { ok: true };

  // Production: require HTTPS for webhook endpoints.
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'https is required' };
  }

  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, reason: 'internal hostname blocked' };
  }
  if (isIP(host) && isBlockedIp(host)) {
    return { ok: false, reason: 'private/loopback IP blocked' };
  }
  // Resolve DNS and reject if any address is private (defense against rebinding).
  try {
    const addrs = await lookup(host, { all: true });
    for (const a of addrs) {
      if (isBlockedIp(a.address)) return { ok: false, reason: 'resolves to a private IP' };
    }
  } catch {
    return { ok: false, reason: 'DNS resolution failed' };
  }
  return { ok: true };
}
