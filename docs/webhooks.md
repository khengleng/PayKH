# Webhooks

> **Status: implemented (Phase 2).** Signed delivery, exponential-backoff
> retries, per-attempt delivery logs, resend, send-test, secret rotation, and
> auto-disable-on-repeated-failure are live. Deliveries run in the BullMQ worker.

## Events

| Event | Fires when |
|-------|-----------|
| `payment.created` | A payment is created |
| `payment.scanned` | The QR is scanned |
| `payment.completed` | Payment succeeds (`paid`) |
| `payment.expired` | Payment expires |
| `payment.failed` | Payment fails |
| `payment.cancelled` | Payment is cancelled |
| `payment.refunded` | Payment is fully or partially refunded |

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

## Delivery semantics

- At-least-once delivery; endpoints must be **idempotent** on `event.id`.
- Exponential backoff (`30s → 1m → 2m → …`, up to 6 attempts); each attempt is
  logged on the `WebhookDelivery` row (status, attempt, HTTP code, error).
- Endpoints are auto-disabled after 20 consecutive permanent failures; the
  merchant is notified via a `SecurityEvent` + audit-log entry surfaced in the
  dashboard (email notification is a Phase 4 item).
- Dashboard → **Webhooks**: add/enable/disable endpoints, select events, view
  the signing secret, **rotate** it (old secret valid 24h), view **deliveries**,
  **resend** a delivery, and **send a test** event.
- The `X-Payment-Event` header carries the event type; `X-Payment-Id` carries
  the event id for idempotent processing.

## Data model

`WebhookEndpoint` → `WebhookSecret` (rotatable) · `WebhookEvent` →
`WebhookDelivery` (per-attempt log). See
[`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).
