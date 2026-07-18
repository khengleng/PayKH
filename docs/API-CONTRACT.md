# PayKH → Trustee Webhook API Contract

> The contract PayKH honors when delivering signed events to a client-registered
> receiver (e.g. the trustee's `POST /api/v1/trustee/events`). Pair this with
> [`webhook-receiver-example.md`](./webhook-receiver-example.md) for a runnable
> receiver.

## 1. Transport

- **Method:** `POST`
- **URL:** the endpoint URL you register in Dashboard → **Webhooks** (must be
  HTTPS and publicly resolvable; internal/metadata targets are refused by the
  SSRF guard). Redirects are **not** followed — register the final URL.
- **Content-Type:** `application/json`
- **User-Agent:** `PayKH-Webhooks/1.0`
- **Timeout:** PayKH waits up to **10s** for your response.

## 2. Headers

| Header | Example | Meaning |
|--------|---------|---------|
| `X-Payment-Event` | `payment.completed` | Event type |
| `X-Payment-Id` | `evt_abc123` | Event id — use as the **idempotency key** |
| `X-Payment-Signature` | `t=1783683255,v1=6f1c…e2` | HMAC signature (§4) |

During a signing-secret rotation the signature carries **multiple** `v1=`
values (`t=…,v1=<new>,v1=<old>`); a match against **any** one is valid.

## 3. Event catalog

| Event | Fires when |
|-------|-----------|
| `payment.created` | A payment is created |
| `payment.scanned` | The QR is scanned |
| `payment.completed` | Payment succeeds (`paid`) |
| `payment.expired` | Payment expires |
| `payment.failed` | Payment fails |
| `payment.cancelled` | Payment is cancelled |
| `payment.refunded` | Payment is fully or partially refunded |

An endpoint registered with **no** selected events receives **all** of them.

## 4. Payload

```json
{
  "id": "evt_abc123",
  "type": "payment.completed",
  "created": "2026-07-19T11:34:15.000Z",
  "data": {
    "payment": {
      "id": "pay_abc123",
      "status": "paid",
      "amount": "1.50",
      "currency": "USD",
      "reference_id": "order_1024",
      "metadata": {},
      "approved_at": "2026-07-19T11:34:15.000Z",
      "amount_refunded": "0.00"
    }
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Event id, matches `X-Payment-Id`. Stable across retries. |
| `type` | string | One of §3. Matches `X-Payment-Event`. |
| `created` | string (ISO 8601) | When the event was emitted. |
| `data.payment.id` | string | Payment id. |
| `data.payment.status` | string | `created` \| `scanned` \| `paid` \| `expired` \| `failed` \| `cancelled` \| `refunded`. |
| `data.payment.amount` | string | Decimal string in the payment currency. |
| `data.payment.currency` | string | ISO 4217. |
| `data.payment.reference_id` | string \| null | Your reference from payment creation. |
| `data.payment.metadata` | object | Whatever you attached at creation. |
| `data.payment.approved_at` | string \| null | ISO 8601 when paid, else `null`. |
| `data.payment.amount_refunded` | string | Decimal string; `"0.00"` if none. |

New fields may be **added** without notice — parse leniently and ignore unknown
keys. Existing fields will not change type.

## 5. Signature verification

`v1` = `HMAC-SHA256(signing_secret, "{timestamp}.{rawRequestBody}")`, hex-encoded.

To verify:

1. Parse `X-Payment-Signature` into `t` and one-or-more `v1` values.
2. Recompute `HMAC-SHA256(secret, t + "." + rawBody)` over the **raw** received
   bytes — do **not** re-serialize the JSON (key order / whitespace would differ).
3. **Constant-time**-compare your digest against each `v1`; accept on any match.
4. Reject if `abs(now - t) > 300` seconds (5-minute replay window).

The signing secret (`whsec_…`) is shown once on endpoint creation and can be
revealed/rotated in Dashboard → **Webhooks**. On rotation the previous secret
stays valid for **24h**.

## 6. Your response

- Return **`2xx`** as soon as you've **durably persisted or enqueued** the event.
  Do the real work asynchronously — don't hold the connection open.
- Any non-`2xx`, a timeout (>10s), or a connection error counts as a **failed
  attempt** and triggers retry (§7).
- Your response body (first 2 KB) is captured and shown in the PayKH delivery
  log — return a short diagnostic string on error to help debugging.

## 7. Retries, dead-letter & replay

- **At-least-once** delivery. The same event id **will** be re-delivered on
  retry and may (rarely) arrive more than once — dedupe on `X-Payment-Id`.
- Up to **6 attempts** with exponential backoff (`30s → 1m → 2m → 4m → …`).
- After 6 failed attempts the delivery is **dead-lettered** (`FAILED`) and no
  longer retried automatically.
- After **20** consecutive permanent failures an endpoint is **auto-disabled**
  and the store owner is notified.
- Once your receiver is healthy, the PayKH operator flushes the backlog with
  Dashboard → **Webhooks → Replay all dead-lettered**, which re-enables the
  endpoint and re-queues every dead-lettered delivery. Individual deliveries can
  also be resent from the per-endpoint delivery log.

## 8. Idempotency requirements (receiver MUST)

1. Key on `X-Payment-Id` (== payload `id`); ignore an id you've already applied.
2. Verify the signature **before** trusting any field (§5).
3. Treat delivery order as **best-effort** — reconcile on `data.payment.status`,
   not on arrival order.
4. Respond `2xx` fast; process asynchronously.
