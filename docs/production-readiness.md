# Production Readiness Checklist

## Security
- [x] HTTPS only (Railway-terminated TLS on custom domains)
- [x] API keys hashed at rest (SHA-256); shown once
- [x] Provider credentials encrypted (AES-256-GCM)
- [x] Passwords hashed (bcrypt); **MFA (TOTP)** available
- [x] Signed webhooks (HMAC-SHA256, constant-time, 5-min tolerance)
- [x] Idempotency (atomic key reservation)
- [x] Rate limiting (Redis-backed, 429)
- [x] Secure headers (helmet) + CSP in production
- [x] CORS locked to dashboard + checkout origins
- [x] Input validation (class-validator) + request size limits
- [x] RBAC least-privilege; audit logging (append-only)
- [x] Dependency vulnerability scanning (Railway build gate; CI)
- [ ] Rotate `JWT_SECRET` on a schedule; automated secret rotation (roadmap)
- [ ] WAF / DDoS protection at the edge (provider-dependent)

## Reliability
- [x] Health `/health` + readiness `/ready` (DB + provider)
- [x] Provider timeout / retry / circuit-breaker
- [x] Background worker with retries + expiry reconciliation
- [x] Graceful shutdown (SIGTERM) on api + worker
- [ ] Multi-replica api/worker (scale on Railway as load grows)
- [ ] Postgres read replica (only if needed)

## Observability
- [x] Structured logs with request ids
- [x] `/metrics` (payments, webhook deliveries, queue depth, provider health)
- [ ] External error tracking (e.g. Sentry) + alerting
- [ ] Uptime monitor hitting `/health`

## Data
- [x] Migrations run on deploy (`prisma migrate deploy`)
- [x] Seed command
- [ ] Backups enabled + restore drill ([disaster-recovery.md](disaster-recovery.md))

## Operational
- [x] Separate test (`bk_test_`) and live (`bk_live_`) keys + sandbox
- [x] Per-service Dockerfiles + Railway config
- [x] CI (GitHub Actions): build + test + migrate
- [ ] Runbooks for on-call (incident, rollback, key compromise)

## Go-live steps for real Bakong
1. Obtain NBC/Bakong credentials + API token.
2. Set `PAYMENT_PROVIDER=bakong` and `BAKONG_API_TOKEN` on `api` + `worker`.
3. Store each store's Bakong account JSON via `PUT /stores/:id/credentials`.
4. Flip the store to live mode; issue `bk_live_` keys.
5. Run a small live transaction and confirm settlement + webhook.
