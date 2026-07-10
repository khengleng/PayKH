# @paykh/sdk-node — Node.js SDK (Phase 4)

Placeholder. The official Node.js SDK ships in **Phase 4**.

Planned surface:

```ts
import { PayKH } from '@paykh/sdk-node';

const paykh = new PayKH('bk_live_xxx');

const payment = await paykh.payments.create({
  amount: '1.50',
  currency: 'USD',
  reference_id: 'order_1024',
});

// Webhook verification helper
paykh.webhooks.verify(rawBody, signatureHeader, signingSecret);
```

Until then, use the REST API directly — see [`docs/api.md`](../../docs/api.md).
