# Disaster Recovery

## Objectives

| Metric | Target (MVP) |
|--------|--------------|
| RPO (max data loss) | ≤ 24h (daily backups) → ≤ 5 min with Railway PITR |
| RTO (time to restore) | ≤ 1h |

## What must be protected

1. **PostgreSQL** — the system of record (merchants, payments, webhooks, audit).
2. **ENCRYPTION_KEY / JWT_SECRET** — without `ENCRYPTION_KEY` the encrypted
   provider credentials are unrecoverable. Store both in a secrets manager
   (Railway variables + an offline backup). **Never rotate `ENCRYPTION_KEY`**
   without first re-encrypting `ProviderCredential.secretCiphertext` and
   `User.mfaSecret`.
3. **Redis** is a cache/queue — it is **not** a source of truth. Losing it drops
   in-flight webhook retries and rate-limit counters only; payments are safe in
   Postgres, and the maintenance sweep re-reconciles pending payments.

## Backups

- Enable **Railway PostgreSQL backups** (daily snapshots; point-in-time recovery
  on paid plans). Verify the schedule in the Postgres service settings.
- For an independent copy, schedule `pg_dump`:
  ```bash
  pg_dump "$DATABASE_PUBLIC_URL" --format=custom --file=paykh-$(date +%F).dump
  ```
  Store off-platform (e.g. object storage) with lifecycle retention.

## Restore runbook

1. Provision a new Postgres (Railway or elsewhere); set its `DATABASE_URL`.
2. Restore the latest backup:
   ```bash
   pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" paykh-YYYY-MM-DD.dump
   ```
   (Or use Railway's restore-to-timestamp.)
3. Point the `api` and `worker` services at the restored `DATABASE_URL`.
4. Set the **same** `ENCRYPTION_KEY` and `JWT_SECRET` as before.
5. Deploy `api` (runs `prisma migrate deploy`) and `worker`.
6. Verify: `GET /ready` (DB ok), `GET /metrics`, and a test payment + webhook.
7. Re-issue webhook deliveries if needed via the dashboard **Resend**.

## Failure drills (recommended quarterly)

- Restore the latest backup into a scratch project and run the smoke test.
- Kill the `worker` service and confirm the expiry sweep + webhook retries
  resume on restart with no lost payments.
- Revoke and re-issue a leaked API key; confirm old key returns `unauthorized`.
