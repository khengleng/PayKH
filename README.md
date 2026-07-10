# PayKH — Bakong KHQR Payment Gateway

A developer-first SaaS platform for Cambodian merchants to accept **Bakong KHQR**
payments through a simple REST API, hosted checkout pages, and real-time webhooks.

> **Status: Phase 2 complete** — This repository implements Phases 1 and 2 of
> the delivery plan. See [`docs/architecture.md`](docs/architecture.md) for the
> full roadmap and [`ASSUMPTIONS.md`](ASSUMPTIONS.md) for scope decisions.

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
  behind the provider abstraction with timeout/retry/circuit-breaker
- **Webhooks**: signed (HMAC-SHA256) delivery via a BullMQ worker, exponential
  backoff + max retries, delivery logs, resend, send-test, secret rotation,
  auto-disable on repeated failure; dashboard Webhooks module
- **Payment status monitoring** + **expiry sweep** (worker maintenance jobs)
- **Hardened idempotency** (atomic key reservation) + expired-record cleanup
- Redis + BullMQ; a dedicated `worker` service (runs the API image)

## Repository layout

```
apps/
  api/         NestJS REST API (+ Prisma, OpenAPI, mock provider)
  checkout/    Next.js hosted checkout page (public)
  dashboard/   Next.js merchant dashboard
  worker/      Background worker (Phase 1 stub; webhooks land in Phase 2)
packages/
  shared-types/  Shared TS types & error codes
  security/      Hashing, HMAC signing, AES-GCM encryption, id generation
  sdk-node/      Node SDK (Phase 4 — placeholder)
  sdk-php/       PHP SDK (Phase 4 — placeholder)
  sdk-python/    Python SDK (Phase 4 — placeholder)
  ui/            Shared UI (Phase 3/4 — placeholder)
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

## License

Apache-2.0
