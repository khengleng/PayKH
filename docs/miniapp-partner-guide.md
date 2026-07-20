# PayKH Loyalty Mini-App — Bank Partner Integration Guide

Embed PayKH loyalty inside your banking app. Your customers see and redeem their
loyalty across every PayKH merchant they shop at — in your app, alongside the
Bakong KHQR payment they already make. No separate PayKH app to download.

- **You bring the customer** (already authenticated in your app).
- **PayKH brings the loyalty** (points, rewards, redemption across merchants).
- Trust model: **you sign, PayKH verifies.** No shared password.

---

## Architecture

```
  Your app (webview)                         PayKH
  ──────────────────                         ─────
  openMiniApp(token) ───/m?partner&token──▶  verify signature ─▶ session ─▶ loyalty UI
        ▲                                       (against your registered public key)
  mintHandoffToken()   ← your backend, holds your Ed25519 private key
```

The handoff token is an **EdDSA (Ed25519) JWT** your backend mints for the signed-in
user. PayKH verifies it against the **public** key you registered. It carries the
user's stable id + phone and is short-lived (≤5 min).

---

## Step 1 — Register as a partner (one-time)

1. Generate an Ed25519 keypair (keep the private key on your backend):

   ```ts
   import { generatePartnerKeyPair } from '@paykh/miniapp-sdk';
   const { publicKeyPem, privateKeyPem } = generatePartnerKeyPair();
   ```

2. Send PayKH your **public** key + a `key_id`. PayKH registers you and returns a
   `partner_id`:

   ```
   POST /admin/partners            (PayKH platform-admin performs this)
   { "name": "Your Bank", "public_key_pem": "<publicKeyPem>", "key_id": "bank-key-1" }
   → { "id": "<partner_id>", "name": "...", "key_id": "bank-key-1", "active": true }
   ```

Store `partner_id`, `key_id`, and `privateKeyPem` (secret) on your backend.

## Step 2 — Mint a handoff token (backend, per session)

When a signed-in user opens the loyalty section:

```ts
import { mintHandoffToken } from '@paykh/miniapp-sdk';

const token = mintHandoffToken({
  partnerId:     PARTNER_ID,
  keyId:         'bank-key-1',
  privateKeyPem: process.env.PAYKH_PRIVATE_KEY!,   // never leaves your backend
  userId:        user.id,        // your stable, opaque user id
  phone:         user.phone,     // links them to their merchant loyalty
  name:          user.fullName,
  ttlSeconds:    300,
});
```

Return `token` to your app for this user only.

## Step 3 — Open the mini-app (app / webview)

```ts
import { openMiniApp } from '@paykh/miniapp-sdk';

openMiniApp({
  miniAppBaseUrl: 'https://mobile.paykh.cambobia.com',
  partnerId:      PARTNER_ID,
  token,                         // from your backend
  // container: el,              // optional: embed as an <iframe> instead of navigating
});
```

The mini-app handles everything else: session exchange, points across merchants,
**member QR**, rewards & redeem, and history.

---

## What the customer can do in the mini-app

- See total points and per-merchant balances.
- **Show a member QR** the merchant's PayKH POS scans to attach them to a sale
  (so the purchase earns loyalty) or to redeem.
- Redeem points for rewards → get a voucher code.
- View their paid history across merchants.

## API surface (mini-app session token)

| Endpoint | Purpose |
|---|---|
| `POST /miniapp/session` | exchange your handoff token → a 1h session token |
| `GET /miniapp/me` | loyalty across all merchants |
| `GET /miniapp/merchants/:customerId` | one merchant's rewards & vouchers |
| `POST /miniapp/redeem` | redeem points → voucher |
| `GET /miniapp/member-qr` | short-lived member QR for the POS |
| `GET /miniapp/history` | paid history across merchants |

## Security notes

- The handoff token is **Ed25519-signed by you**; PayKH verifies against your
  registered key and rejects unknown `kid`, bad signatures, and expired tokens.
- Keep `ttlSeconds` short (default 300) — it's exchanged immediately.
- Your **private key never leaves your backend**; the app only ever sees the
  already-minted token.
- The mini-app session token is separate from PayKH merchant tokens (`typ:miniapp`)
  and expires in 1 hour.

## Transparency

Loyalty backed by a real, trustee-held reserve shows **"Backed by &lt;Trustee
Bank&gt;"**. Ordinary loyalty shows **"Loyalty points"** — the backing badge is
**never** shown unless the reserve backing is genuine.

---

See [`@paykh/miniapp-sdk`](../packages/miniapp-sdk/README.md) for the SDK reference.
