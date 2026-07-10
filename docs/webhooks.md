# Webhooks

> **Status:** The webhook *contract, signing scheme, and data model* are defined
> in Phase 1. The delivery worker (retries, delivery logs, resend, test-send) is
> implemented in **Phase 2**. This document is the target contract.

## Events

| Event | Fires when |
|-------|-----------|
| `payment.created` | A payment is created |
| `payment.scanned` | The QR is scanned |
| `payment.completed` | Payment succeeds (`paid`) |
| `payment.expired` | Payment expires |
| `payment.failed` | Payment fails |
| `payment.cancelled` | Payment is cancelled |

## Payload

```json
{
  "id": "evt_xxx",
  "type": "payment.completed",
  "created": "2026-07-10T11:34:15.000Z",
  "data": {
    "payment": {
      "id": "pay_xxx",
      "status": "paid",
      "amount": "1.50",
      "currency": "USD",
      "reference_id": "order_1024",
      "metadata": {},
      "approved_at": "2026-07-10T11:34:15.000Z"
    }
  }
}
```

## Headers

```
X-Payment-Event: payment.completed
X-Payment-Signature: t=1783683255,v1=6f1c...e2
```

## Signature scheme

`v1` is `HMAC-SHA256(signing_secret, "{timestamp}.{rawRequestBody}")` in hex.

Verification requirements (all enforced by `@paykh/security`):

- **Constant-time** comparison of the hex digests.
- **5-minute** timestamp tolerance (replay protection).
- Verify over the **raw request body** — do not re-serialize the JSON.

### Node.js verification

```ts
import { verifySignature } from '@paykh/security';

// rawBody: the exact bytes received; header: the X-Payment-Signature value
const result = verifySignature(signingSecret, rawBody, header);
if (!result.valid) {
  // result.reason: 'malformed' | 'timestamp_out_of_tolerance' | 'signature_mismatch'
  return res.status(400).end();
}
```

### Manual verification (any language)

```
parts      = header.split(",")            # ["t=...","v1=..."]
timestamp  = parts["t"]
expected   = hex(hmac_sha256(secret, timestamp + "." + rawBody))
valid      = constant_time_equals(expected, parts["v1"])
           and abs(now - timestamp) <= 300
```

## Delivery semantics (Phase 2)

- At-least-once delivery; endpoints must be **idempotent** on `event.id`.
- Exponential backoff with a maximum retry count; each attempt is logged
  (`WebhookDelivery`).
- Endpoints are auto-disabled only after repeated **permanent** failures, and
  only **with merchant notification**.
- Dashboard: view deliveries, **resend** an event, **send a test** event,
  **rotate** the signing secret.

## Data model

`WebhookEndpoint` → `WebhookSecret` (rotatable) · `WebhookEvent` →
`WebhookDelivery` (per-attempt log). See
[`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).
