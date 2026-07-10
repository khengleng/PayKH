# Architecture

PayKH is a developer-first Bakong KHQR payment gateway delivered as a monorepo of
independently deployable services.

## System overview

```
                 ┌─────────────┐          ┌──────────────┐
   Merchant  ──▶ │  dashboard  │          │   checkout   │ ◀── Customer
   (browser)     │  (Next.js)  │          │  (Next.js)   │     (browser)
                 └──────┬──────┘          └──────┬───────┘
                        │ JWT                     │ public (no secrets)
                        ▼                         ▼
                 ┌───────────────────────────────────────┐
                 │              api (NestJS)              │
                 │  /auth  /stores  /api-keys  /dashboard │
                 │  /v1/payments   /checkout  /health     │
                 │                                        │
                 │  PaymentProvider (mock | bakong)       │
                 └───────┬───────────────────┬───────────┘
                         │                   │ (Phase 2)
                         ▼                   ▼
                  ┌────────────┐      ┌─────────────┐
                  │ PostgreSQL │      │    Redis    │◀── worker (BullMQ)
                  │  (Prisma)  │      │  pub/sub +  │    webhooks, expiry
                  └────────────┘      │   queues    │
                                      └─────────────┘
```

## Services

| Service | Stack | Port | Purpose |
|---------|-------|------|---------|
| `api` | NestJS + Prisma | 4000 | REST API, auth, payments, provider integration, OpenAPI |
| `dashboard` | Next.js | 3000 | Merchant control plane (JWT auth) |
| `checkout` | Next.js | 3001 | Public hosted checkout page (SSE live status) |
| `worker` | Node | — | Background jobs (Phase 2: webhook delivery, expiry sweeps) |

## Packages

| Package | Purpose |
|---------|---------|
| `@paykh/shared-types` | Shared enums, the payment state machine, error codes, webhook contracts |
| `@paykh/security` | API-key hashing, HMAC webhook signing, AES-256-GCM encryption, id generation, password hashing |
| `sdk-node` / `sdk-php` / `sdk-python` | Client SDKs (Phase 4 placeholders) |
| `ui` | Shared component library (Phase 3/4 placeholder) |

## Key design decisions

- **Provider abstraction.** All Bakong interaction goes through the
  `PaymentProvider` interface (`createKhqr`, `checkPaymentStatus`,
  `verifyPayment`, `cancelPayment`, `getProviderHealth`). Controllers never call
  a provider SDK directly. The active implementation is chosen by
  `PAYMENT_PROVIDER` (`mock` in Phase 1, `bakong` in Phase 2). Calls are wrapped
  with timeout + retry + circuit-breaker (`providers/resilience.ts`).
- **Single-writer state machine.** Every payment status change flows through
  `PaymentsService.transition()`, which enforces the allowed transitions from
  `@paykh/shared-types`, appends a `PaymentStatusHistory` row, and publishes a
  live event. `paid` is terminal for the MVP.
- **Two authentication planes.** Public `/v1` endpoints use API keys
  (`ApiKeyGuard`, looked up by SHA-256 hash). Dashboard endpoints use a
  short-lived JWT (`JwtAuthGuard`) plus a role-based permission matrix
  (`auth/rbac.ts`).
- **Secret hygiene.** API keys are stored only as SHA-256 hashes; provider
  credentials are stored AES-256-GCM-encrypted; the checkout view is a
  deliberately secret-free projection.
- **Live checkout.** Status updates stream over Server-Sent Events with an
  automatic polling fallback in the browser. Phase 1 uses an in-process event
  bus; Phase 2 swaps in Redis pub/sub for multi-instance fan-out.

## Delivery phases

- **Phase 1 (this repo):** monorepo, merchant auth, stores, API keys,
  create/retrieve/list/cancel payments, mock KHQR provider, hosted checkout,
  basic dashboard, OpenAPI, health.
- **Phase 2:** real Bakong integration, status monitoring worker, webhooks +
  signed delivery with retries, idempotency hardening, branding polish.
- **Phase 3:** plans, quotas, billing, team RBAC UI, audit-log views, reporting.
- **Phase 4:** SDKs, sandbox, security hardening, load testing, DR, production
  readiness.

See [`../ASSUMPTIONS.md`](../ASSUMPTIONS.md) for Phase 1 scope decisions.
```
