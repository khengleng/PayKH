# Quickstart

Accept a Bakong KHQR payment in 5 minutes.

## 1. Get an API key
Log in at https://paykh.cambobia.com → **API Keys** → create a `bk_test_` key
(shown once). Or use the seeded demo: `owner@demo.paykh.dev` / `Password123!`.

## 2. Create a payment
```bash
curl -X POST https://api.paykh.cambobia.com/v1/payments \
  -H "Authorization: Bearer bk_test_xxx" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order_1024" \
  -d '{"amount":"1.50","currency":"USD","reference_id":"order_1024"}'
```
Response has `qr_string` (render it) and `checkout_url` (redirect the customer).

## 3. Show the QR / hosted checkout
Redirect to `checkout_url`, or render `qr_string` yourself. The hosted page
updates live (SSE) as the payment progresses.

## 4. Simulate payment (test mode)
```bash
curl -X POST https://api.paykh.cambobia.com/v1/payments/pay_xxx/simulate \
  -H "Authorization: Bearer bk_test_xxx" -H "Content-Type: application/json" \
  -d '{"status":"paid"}'
```

## 5. Receive webhooks
Dashboard → **Webhooks** → add an HTTPS endpoint. Verify the signature:

```ts
import { verifyWebhook } from '@paykh/sdk-node';
if (!verifyWebhook(rawBody, req.header('X-Payment-Signature'), signingSecret).valid) {
  return res.status(400).end();
}
```

## SDKs
- Node: `npm i @paykh/sdk-node` — see [packages/sdk-node](../packages/sdk-node)
- Python: `pip install paykh`
- PHP: `composer require paykh/sdk-php`

Full reference: [api.md](api.md) · [webhooks.md](webhooks.md) · interactive at `/docs`.
