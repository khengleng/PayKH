/**
 * PayKH loyalty mini-app SDK for banking apps.
 *
 * Two halves:
 *  - **Server** (your backend, where your private key lives): mint a signed
 *    handoff token for an already-authenticated user with `mintHandoffToken`.
 *  - **Client** (your app's webview): open the mini-app for that user with
 *    `buildMiniAppUrl` / `openMiniApp`.
 *
 * The handoff is an EdDSA (Ed25519) JWT — PayKH verifies it against the public
 * key you registered as a partner. No shared password; your signature is the
 * trust.
 */

// ---------------------------------------------------------------- server side

export interface MintHandoffOptions {
  /** Your partner id (from PayKH partner registration). */
  partnerId: string;
  /** The key id you registered — becomes the token's `kid`. */
  keyId: string;
  /** Your Ed25519 private key (PEM). Keep this server-side only. */
  privateKeyPem: string;
  /** Your stable, opaque id for this user. */
  userId: string;
  /** The user's phone — links them to their merchant loyalty. Recommended. */
  phone?: string;
  /** Optional display name. */
  name?: string;
  /** Token lifetime in seconds (default 300). Keep it short. */
  ttlSeconds?: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Mint a signed handoff token (server-side). Requires Node's `crypto`.
 * The token format matches PayKH's verifier exactly:
 *   base64url(header).base64url(payload).base64url(ed25519_sig over `${header}.${payload}`)
 */
export function mintHandoffToken(opts: MintHandoffOptions): string {
  // Lazy-require so this module can also be bundled for the browser (where only
  // the client helpers below are used).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { sign, createPrivateKey } = require('crypto') as typeof import('crypto');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'EdDSA', kid: opts.keyId }));
  const payload = b64url(
    JSON.stringify({
      iss: opts.partnerId,
      sub: opts.userId,
      ...(opts.phone ? { phone: opts.phone } : {}),
      ...(opts.name ? { name: opts.name } : {}),
      iat: now,
      exp: now + (opts.ttlSeconds ?? 300),
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = sign(null, Buffer.from(signingInput), createPrivateKey(opts.privateKeyPem)).toString('base64url');
  return `${signingInput}.${signature}`;
}

/** Generate a fresh Ed25519 keypair (register the public key with PayKH; keep the private key). */
export function generatePartnerKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { generateKeyPairSync } = require('crypto') as typeof import('crypto');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  };
}

// ---------------------------------------------------------------- client side

export interface LaunchOptions {
  /** The PayKH mini-app base URL, e.g. https://mobile.paykh.cambobia.com */
  miniAppBaseUrl: string;
  partnerId: string;
  /** The signed handoff token from your backend (mintHandoffToken). */
  token: string;
}

/** Build the mini-app URL to open in your webview. */
export function buildMiniAppUrl(opts: LaunchOptions): string {
  const q = `partner=${encodeURIComponent(opts.partnerId)}&token=${encodeURIComponent(opts.token)}`;
  return `${opts.miniAppBaseUrl.replace(/\/$/, '')}/m?${q}`;
}

/**
 * Open the mini-app. In a browser/webview: navigates the current view by
 * default, or embeds an iframe into `container` if provided.
 */
export function openMiniApp(opts: LaunchOptions & { container?: HTMLElement }): HTMLIFrameElement | void {
  const url = buildMiniAppUrl(opts);
  if (opts.container && typeof document !== 'undefined') {
    const frame = document.createElement('iframe');
    frame.src = url;
    frame.style.cssText = 'width:100%;height:100%;border:0';
    frame.allow = 'clipboard-write';
    opts.container.appendChild(frame);
    return frame;
  }
  if (typeof window !== 'undefined') window.location.href = url;
}
