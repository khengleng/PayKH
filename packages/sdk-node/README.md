# @paykh/sdk-node

Official Node.js SDK for the [PayKH](https://paykh.cambobia.com) Bakong KHQR
payment gateway.

```bash
npm install @paykh/sdk-node
```

## Usage

```ts
import { PayKH } from '@paykh/sdk-node';

const paykh = new PayKH(process.env.PAYKH_API_KEY!); // bk_live_… / bk_test_…

// Create a payment
const payment = await paykh.payments.create(
  { amount: '1.50', currency: 'USD', reference_id: 'order_1024' },
  { idempotencyKey: 'order_1024' },
);
console.log(payment.checkout_url, payment.qr_string);

// Retrieve / list / cancel
await paykh.payments.retrieve(payment.id);
await paykh.payments.list({ status: 'paid', limit: 20 });
await paykh.payments.cancel(payment.id);
```

By default the SDK targets `https://api.paykh.cambobia.com`. Override with
`new PayKH(key, { baseUrl: 'http://localhost:4000' })`.

## Verifying webhooks

```ts
import { verifyWebhook, constructEvent } from '@paykh/sdk-node';

// In your webhook handler (rawBody must be the exact received bytes):
const sig = req.header('X-Payment-Signature')!;
const result = verifyWebhook(rawBody, sig, endpointSigningSecret);
if (!result.valid) return res.status(400).end();

// Or verify + parse in one step (throws on invalid signature):
const event = constructEvent(rawBody, sig, endpointSigningSecret);
```

## Errors

Failed requests throw a `PayKHError` with `code`, `status`, `message`, and
`requestId` (see [docs/api.md](../../docs/api.md#errors)).
