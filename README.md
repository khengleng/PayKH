# PayKH — Bakong KHQR Payment Gateway

A developer-first SaaS platform for Cambodian merchants to accept **Bakong KHQR**
payments through a simple REST API, hosted checkout pages, and real-time webhooks.

> **Status: Phases 1–4 built and deployed.** The code for all four phases is
> implemented and running on Railway. **Caveat — built and deployed does not
> mean proven against live upstreams:** the deployed payment provider defaults to
> **mock**, PayChain and the promo modules are **feature-flag-off**, disbursement
> is a no-op until bank credentials are set, and the real-money / on-chain paths
> have not completed end-to-end against a live external system. See
> [`docs/architecture.md`](docs/architecture.md) for the roadmap and
> [`ASSUMPTIONS.md`](ASSUMPTIONS.md) for scope decisions.

## What's implemented

Phase 1:
- Monorepo (npm workspaces)
- Merchant sign up / login (JWT session auth), organizations & stores
- API keys (hashed at rest, `bk_test_` / `bk_live_` prefixes, shown once)
- Payments API: create / retrieve / list / cancel with state machine
- **Mock** KHQR provider behind a `PaymentProvider` abstraction
- Hosted checkout page with live status (SSE + polling fallback)
- Merchant dashboard (overview, payments, API keys, stores)
- OpenAPI docs, health/readiness endpoints, structured errors

Phase 2:
- **Real `BakongKhqrProvider`** (NBC Open API): KHQR generation + status polling,
  behind the provider abstraction with timeout/retry/circuit-breaker.
  _Deployed default is `mock`; unit-tested against a mocked client, never run
  live. In the per-store "routing" mode the QR is real but incoming-payment
  detection is not yet wired (the `simulate` endpoint drives the paid state)._
- **Webhooks**: signed (HMAC-SHA256) delivery via a BullMQ worker, exponential
  backoff + max retries, delivery logs, resend, send-test, secret rotation,
  auto-disable on repeated failure; dashboard Webhooks module
- **Payment status monitoring** + **expiry sweep** (worker maintenance jobs)
- **Hardened idempotency** (atomic key reservation) + expired-record cleanup
- Redis + BullMQ; a dedicated `worker` service (runs the API image)

Phase 3:
- **Plans & quotas** — monthly successful-payment quota with HTTP 402
  enforcement and 70/90/100% warnings
- **Billing** — plan change, subscription/plan history, usage ledger, invoices
- **Team RBAC** — invitations (auto-join on register), role assignment, removal
- **Audit-log views** and **reporting** (date-range metrics + CSV export)

Phase 4:
- **SDKs** — Node ([`@paykh/sdk-node`](packages/sdk-node)), PHP, Python
- **Sandbox** (test mode + simulator), **Redis-backed rate limiting** (429)
- **MFA** (TOTP), **`/metrics`** observability endpoint
- Docs: [security](docs/security.md), [load testing](docs/load-testing.md) (k6),
  [disaster recovery](docs/disaster-recovery.md),
  [production readiness](docs/production-readiness.md),
  [sandbox](docs/sandbox.md); Postman collection

## Repository layout

```
apps/
  api/         NestJS REST API (+ Prisma, OpenAPI, providers). The background
               worker runs this same image via src/worker/ (BullMQ processors) —
               there is no separate apps/worker.
  checkout/    Next.js hosted checkout page (public)
  dashboard/   Next.js merchant dashboard
  docs/        Next.js developer docs site (deployed)
packages/
  shared-types/  Shared TS types & error codes
  security/      Hashing, HMAC signing, Ed25519, AES-GCM encryption, id generation
  sdk-node/      Node SDK (real, tested)
  sdk-php/       PHP SDK (real)
  sdk-python/    Python SDK (real)
  ui/            Shared UI (placeholder — README only)
docs/          Architecture, API, webhooks, security, deployment, onboarding
```

## Quick start (local)

Prerequisites: Node 18.18+, Docker (for Postgres), npm 10+.

```bash
# 1. Install deps
npm install

# 2. Copy env and generate secrets
cp .env.example .env
#   Fill JWT_SECRET and ENCRYPTION_KEY (see comments in .env.example)

# 3. Start Postgres (and Redis) locally
docker compose up -d

# 4. Generate Prisma client + run migrations + seed
npm run prisma:generate
npm run prisma:migrate
npm run db:seed

# 5. Run the services (separate terminals)
npm run dev:api        # http://localhost:4000  (docs at /docs)
npm run dev:dashboard  # http://localhost:3000
npm run dev:checkout   # http://localhost:3001
```

Seed creates a demo merchant:

- **Email:** `owner@demo.paykh.dev`
- **Password:** `Password123!`
- A demo store with a `bk_test_` API key is printed by the seed script.

## Testing

```bash
npm test                 # all workspaces
npm test --workspace @paykh/api
npm test --workspace @paykh/security
```

## Documentation

| Doc | Description |
|-----|-------------|
| [architecture.md](docs/architecture.md) | System design & delivery phases |
| [api.md](docs/api.md) | REST API reference & cURL examples |
| [webhooks.md](docs/webhooks.md) | Webhook events & signature verification |
| [security.md](docs/security.md) | Security model & controls |
| [deployment.md](docs/deployment.md) | Railway deployment guide |
| [merchant-onboarding.md](docs/merchant-onboarding.md) | Onboarding flow |
| [trustee-integration.md](docs/trustee-integration.md) | Trustee readiness, signing keys, and regulator demo flow |

## License

Apache-2.0
