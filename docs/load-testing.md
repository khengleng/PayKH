# Load Testing

A [k6](https://k6.io) script lives at [`scripts/loadtest.js`](../scripts/loadtest.js).
It drives the hot path — create payment → retrieve — with a **test** key, so no
live funds move.

## Run

```bash
brew install k6   # or see k6.io/docs/get-started/installation

BASE_URL=https://api.paykh.cambobia.com \
API_KEY=bk_test_xxx \
k6 run scripts/loadtest.js
```

The script ramps 0 → 50 VUs and asserts thresholds:

- `http_req_failed` < 1%
- `http_req_duration` p95 < 800 ms

## What to watch while it runs

- `GET /metrics` — `queues.webhook` / `queues.maintenance` depth, payment
  success rate.
- Railway service metrics (CPU/memory) for `api`, `worker`, Postgres, Redis.
- Rate limiting: the public API is capped at 100 req / 10s **per API key**. To
  load-test above that, use multiple keys or raise the limit in
  `apps/api/src/payments/payments.controller.ts`.

## Scaling levers

- API and worker are stateless — scale horizontally on Railway (replicas).
- `WEBHOOK_WORKER_CONCURRENCY` controls worker delivery parallelism.
- Postgres connection pool: tune Prisma `connection_limit` in `DATABASE_URL`.
- Redis is used for BullMQ + rate limiting; a single instance handles high
  throughput, but monitor memory.
