# Deployment (Railway)

PayKH deploys as four services plus managed Postgres and Redis.

| Railway service | Root | Build | Start |
|-----------------|------|-------|-------|
| `api` | repo root | `apps/api/Dockerfile` | `prisma migrate deploy && node dist/main.js` |
| `dashboard` | repo root | `apps/dashboard/Dockerfile` | `npm run start` (port 3000) |
| `checkout` | repo root | `apps/checkout/Dockerfile` | `npm run start` (port 3001) |
| `worker` | repo root | `apps/worker/Dockerfile` | `node dist/main.js` |
| PostgreSQL | — | Railway plugin | — |
| Redis | — | Railway plugin | — |

Each service has a `railway.json` in its app directory pointing at its
Dockerfile. Point the service's root directory at the repo root so the Docker
build can access workspace packages.

## Environment variables

Set on the **api** (and worker, where relevant) service:

```
NODE_ENV=production
DATABASE_URL=            # from Railway Postgres plugin
REDIS_URL=               # from Railway Redis plugin (Phase 2)
APP_BASE_URL=https://api.yourdomain.com
CHECKOUT_BASE_URL=https://pay.yourdomain.com
DASHBOARD_BASE_URL=https://dashboard.yourdomain.com
JWT_SECRET=              # openssl rand -hex 32
ENCRYPTION_KEY=          # openssl rand -hex 32  (must be 64 hex chars)
PAYMENT_PROVIDER=mock    # switch to `bakong` in Phase 2
BAKONG_API_BASE_URL=https://api-bakong.nbc.gov.kh
BAKONG_API_TOKEN=        # Phase 2
WEBHOOK_WORKER_CONCURRENCY=5
```

Set on **dashboard** and **checkout** (build-time, inlined by Next):

```
NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com
```

## Database migrations

Migrations live in `apps/api/prisma/migrations`. The `api` container runs
`prisma migrate deploy` on start. To run manually:

```bash
DATABASE_URL=... npm run prisma:migrate --workspace @paykh/api   # deploy
DATABASE_URL=... npm run db:seed                                  # optional seed
```

## Health checks

- `api`: `GET /health` (liveness), `GET /ready` (readiness — DB + provider).
- `dashboard` / `checkout`: Next.js serves `/` (200).

Configure Railway's healthcheck path to `/health` for the `api` service.

## Local deployment (Docker Compose)

`docker-compose.yml` starts Postgres + Redis for local development. Build the
service images individually with the per-app Dockerfiles, e.g.:

```bash
docker build -f apps/api/Dockerfile -t paykh-api .
```

## Rollback

Railway keeps prior deploys; roll back from the dashboard. Migrations are
forward-only — write reversible migrations and prefer additive changes.
