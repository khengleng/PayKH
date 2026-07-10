# Settlement & Reconciliation

## Settlement

Merchant customer payments settle to the merchant's own Bakong account
(account-to-account); PayKH produces the **settlement statement** that batches
paid payments into daily payouts and tracks fees.

- A `Settlement` batch groups a store's `paid`/`refunded` payments by **currency**
  and **UTC payout date**. It records `gross`, `refunds`, `fee`, `net`, and
  `payment_count`.
- **Fee** = `gross × Store.feeBps / 10000` (basis points; default `0`).
  **Net** = `gross − refunds − fee`.
- The worker's hourly **settlement-sweep** batches payments from *completed* days
  (paid before the start of today UTC). Merchants can also **Settle now**
  (dashboard → Settlements) to batch everything currently paid, including today.

Endpoints (JWT; `payment:read`, run needs `store:write`):

| Method | Path | |
|--------|------|--|
| GET | `/dashboard/stores/:storeId/settlements` | list batches |
| GET | `/dashboard/settlements/:id` | batch detail + payments |
| POST | `/dashboard/stores/:storeId/settle` | settle now |

> **Limitation (MVP):** a payment is assigned to a settlement once; refunds
> issued *after* settlement adjust the payment but not the historical batch. Net
> settlement adjustments for post-settlement refunds are a follow-up.

## Reconciliation

Reconciliation cross-checks the ledger for integrity and (for the real Bakong
provider) against provider status, producing a stored, auditable report.

Checks per payment:
- `refundedAmount ≤ amount` (no over-refund)
- `sum(succeeded refunds) == refundedAmount`
- `paid`/`refunded` payments have a `paidAt` (+ provider `md5` for `paid`)
- **Bakong only:** provider still reports the transaction as paid

Endpoints (JWT; `payment:read`):

| Method | Path | |
|--------|------|--|
| POST | `/dashboard/stores/:storeId/reconcile?from=&to=` | run + store a report |
| GET | `/dashboard/stores/:storeId/reconciliations` | list reports |

A report returns `checked`, `matched`, `mismatched`, and a `discrepancies` list
(`{ payment_id, type, detail }`). Types: `over_refunded`, `refund_sum_mismatch`,
`missing_paid_at`, `missing_provider_ref`, `provider_status_mismatch`.
