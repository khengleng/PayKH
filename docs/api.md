# API Reference

Base URL (local): `http://localhost:4000`
Interactive docs: `GET /docs` (Swagger UI) · OpenAPI JSON: `GET /docs-json`

There are two authentication planes:

| Plane | Endpoints | Auth |
|-------|-----------|------|
| Public developer API | `/v1/*` | `Authorization: Bearer bk_live_…` / `bk_test_…` |
| Dashboard / control plane | `/auth`, `/stores`, `/api-keys`, `/dashboard/*` | `Authorization: Bearer <JWT>` |
| Public checkout | `/checkout/:id`, `/checkout/:id/events` | none (secret-free) |

All responses are JSON. Errors follow the [structured error](#errors) shape and
echo a `request_id` (also returned in the `x-request-id` header).

---

## Payments (`/v1`)

### Create a payment

```
POST /v1/payments
Authorization: Bearer bk_test_xxx
Content-Type: application/json
Idempotency-Key: unique-value        # optional
```

```bash
curl -X POST http://localhost:4000/v1/payments \
  -H "Authorization: Bearer bk_test_xxx" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order_1024" \
  -d '{
    "amount": "1.50",
    "currency": "USD",
    "reference_id": "order_1024",
    "description": "Order payment",
    "metadata": { "customer_id": "cus_123" },
    "expires_in_seconds": 300
  }'
```

`201 Created`:

```json
{
  "id": "pay_nJAvGBFDMAK49VyGpWyZ1Vxa",
  "status": "pending",
  "amount": "1.50",
  "currency": "USD",
  "reference_id": "order_1024",
  "description": "Order payment",
  "metadata": { "customer_id": "cus_123" },
  "qr_string": "00020101021229370010mock@paykh...6304ABCD",
  "checkout_url": "http://localhost:3001/pay/pay_nJAvGBFDMAK49VyGpWyZ1Vxa",
  "created_at": "2026-07-10T11:34:15.000Z",
  "expires_at": "2026-07-10T11:39:15.000Z",
  "paid_at": null
}
```

Amount is a **decimal string**. Bounds: USD `0.01`–`100000.00`, KHR `100`–`400000000`.
`expires_in_seconds` is `30`–`86400` (default `300`).

Optional **`branch_id`** attributes the payment to a store branch (must belong to
the store and be active). Manage branches in the dashboard (Stores → Branches) or
via `POST/GET /stores/:storeId/branches`, `PATCH/DELETE /branches/:id`.

Optional **`customer_id`** links the payment to a customer (must belong to the
store). Manage customers via `POST/GET /v1/customers` (fields: `name`, `email`,
`phone`, `external_id`, `metadata`). The dashboard **Customers** page shows a
**Customer 360** view (lifetime value, paid volume, refunds, recent payments).

**Loyalty points.** Enable a loyalty program per store (dashboard → Stores →
Loyalty points): customers with a `customer_id` **earn points on paid payments**
(`floor(amount × points_per_unit)`). Redeem via `POST /v1/loyalty/redeem`
`{ customer_id, points, reason? }`. The balance appears in Customer 360.

### Retrieve a payment

```bash
curl http://localhost:4000/v1/payments/pay_xxx \
  -H "Authorization: Bearer bk_test_xxx"
```

A pending/scanned payment past its `expires_at` is lazily transitioned to
`expired` on read.

### List payments

```
GET /v1/payments?status=paid&reference_id=order_1024&created_from=...&created_to=...&limit=20&cursor=pay_xxx
```

```json
{ "object": "list", "data": [ /* payments */ ], "has_more": false, "next_cursor": null }
```

Cursor pagination: pass the previous response's `next_cursor` as `cursor`.

### Cancel a payment

```bash
curl -X POST http://localhost:4000/v1/payments/pay_xxx/cancel \
  -H "Authorization: Bearer bk_test_xxx"
```

Only allowed before completion; a `paid` payment cannot be cancelled.

### Refund a payment

```
POST /v1/payments/:id/refund
Authorization: Bearer bk_live_xxx
Idempotency-Key: unique-value        # optional
```

```bash
# Full refund (omit amount) or partial (specify amount ≤ refundable balance)
curl -X POST http://localhost:4000/v1/payments/pay_xxx/refund \
  -H "Authorization: Bearer bk_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "amount": "0.50", "reason": "customer request" }'
```

`201 Created`:

```json
{ "id": "rf_xxx", "payment_id": "pay_xxx", "amount": "0.50", "currency": "USD",
  "reason": "customer request", "status": "succeeded", "created_at": "..." }
```

Only **paid** payments can be refunded. Partial refunds keep the payment `paid`
(with a growing `refunded_amount`); once fully refunded the payment becomes
`refunded`. Over-refunding is rejected. Each refund fires a `payment.refunded`
webhook. List with `GET /v1/payments/:id/refunds`.

> **Bakong note:** Bakong has no programmatic refund API — refunds are recorded
> and audited by PayKH, but settlement back to the payer is completed
> out-of-band by the operator.

### Simulate a status change (test mode only)

Drives the mock provider so you can run an end-to-end test payment.

```bash
curl -X POST http://localhost:4000/v1/payments/pay_xxx/simulate \
  -H "Authorization: Bearer bk_test_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "status": "paid" }'      # scanned | paid | failed | expired
```

Rejected with `403 forbidden` for `bk_live_` keys.

---

## Payment statuses & transitions

`pending · scanned · paid · expired · failed · cancelled` (`refunded` reserved).

```
pending → scanned → paid          (paid is terminal)
pending → expired | failed | cancelled
scanned → paid | expired | failed | cancelled
```

Illegal transitions return `400 invalid_request`.

---

## Control plane (dashboard)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Create account + organization |
| POST | `/auth/login` | Get a JWT |
| GET | `/auth/me` | Current user + orgs |
| POST | `/stores` | Create a store |
| GET | `/stores` / `/stores/:id` | List / get stores |
| PUT | `/stores/:id/branding` | Update checkout branding |
| PUT | `/stores/:id/credentials` | Set encrypted provider credentials |
| PUT | `/stores/:id/live-mode` | Activate/deactivate live mode |
| POST | `/api-keys` | Create key (secret shown once) |
| GET | `/api-keys?store_id=…` | List keys |
| POST | `/api-keys/:id/revoke` | Revoke |
| POST | `/api-keys/:id/rotate` | Rotate (revoke old, issue new) |
| GET | `/dashboard/stores/:id/overview` | Overview metrics |
| GET | `/dashboard/stores/:id/payments` | Payments (dashboard view) |
| GET | `/dashboard/payments/:id` | Payment detail + timeline |

---

## Checkout (public)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/checkout/:id` | Secret-free payment view + merchant branding |
| GET | `/checkout/:id/events` | Server-Sent Events stream (`status`, `done`) |

---

## Errors

```json
{ "error": "amount_too_low", "message": "Amount must be at least 0.01 USD", "request_id": "req_xxx" }
```

| Code | HTTP |
|------|------|
| `unauthorized` | 401 |
| `forbidden` | 403 |
| `invalid_request` | 400 |
| `amount_too_low` / `amount_too_high` | 400 |
| `payment_not_found` | 404 |
| `payment_expired` | 409 |
| `payment_provider_error` | 502 |
| `quota_exceeded` | 402 |
| `rate_limit_exceeded` | 429 |
| `idempotency_conflict` | 409 |
| `internal_error` | 500 |

---

## Idempotency

Send `Idempotency-Key` on `POST /v1/payments`. Scope is
(merchant store, endpoint, key). Replaying the **same** key with the **same**
body returns the original response; reusing a key with a **different** body
returns `409 idempotency_conflict`. Records expire after 24h.
