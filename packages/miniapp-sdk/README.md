# @paykh/miniapp-sdk

Embed the **PayKH loyalty mini-app** in your banking app. Your customers see and
redeem their loyalty across every PayKH merchant they shop at — inside your app,
no separate PayKH app to download.

## How it works

1. You register as a **partner** with PayKH and register an **Ed25519 public key**.
2. Your **backend** mints a short-lived **signed handoff token** for the
   already-authenticated user (signed with your private key).
3. Your **app** opens the mini-app webview with that token.
4. PayKH verifies the signature against your registered public key and shows the
   user's loyalty. No shared password — your signature is the trust.

```
   your app (webview)                 PayKH
   ─────────────────                  ─────
   openMiniApp(token) ──/m?token──▶  verify sig ▶ session ▶ loyalty UI
        ▲
   mintHandoffToken()  (your backend, holds the private key)
```

## 1. One-time setup

Generate a keypair (keep the private key on your backend), then have PayKH
register the **public** key:

```ts
import { generatePartnerKeyPair } from '@paykh/miniapp-sdk';
const { publicKeyPem, privateKeyPem } = generatePartnerKeyPair();
// → send publicKeyPem + a keyId to PayKH; they return your partnerId.
// Admin side: POST /admin/partners { name, public_key_pem, key_id }
```

## 2. Backend — mint a handoff token per session

```ts
import { mintHandoffToken } from '@paykh/miniapp-sdk';

const token = mintHandoffToken({
  partnerId: 'cmr…',            // from PayKH
  keyId: 'bank-key-1',
  privateKeyPem: process.env.PAYKH_PRIVATE_KEY!,
  userId: user.id,              // your stable, opaque user id
  phone: user.phone,            // links to their merchant loyalty
  name: user.fullName,
  ttlSeconds: 300,
});
// return `token` to your app for this user.
```

## 3. App — open the mini-app

```ts
import { openMiniApp } from '@paykh/miniapp-sdk';

openMiniApp({
  miniAppBaseUrl: 'https://mobile.paykh.cambobia.com',
  partnerId: 'cmr…',
  token,                        // from your backend
  // container: someElement,    // optional: embed as an <iframe> instead of navigating
});
```

That's it. The mini-app handles the session exchange, shows points across
merchants, member QR, rewards/redeem, and history.

## Transparency

Loyalty backed by a real, trustee-held reserve shows **"Backed by &lt;Trustee
Bank&gt;"** to the customer. Ordinary loyalty shows **"Loyalty points"** — the
backing badge is never shown unless the reserve backing is genuine.

## API surface

| Export | Where | Purpose |
|---|---|---|
| `generatePartnerKeyPair()` | server | make your Ed25519 keypair |
| `mintHandoffToken(opts)` | server | sign a per-user handoff token |
| `buildMiniAppUrl(opts)` | anywhere | the mini-app URL for a token |
| `openMiniApp(opts)` | app/webview | navigate or embed the mini-app |
