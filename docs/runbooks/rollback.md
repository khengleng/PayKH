# Runbook: Rollback

## Fastest path (Railway)
1. Railway → the affected service (usually `api`) → Deployments.
2. Select the last known-good deployment → **Redeploy / Rollback**.
3. Verify `GET /ready` and `GET /metrics`.

## Rollback with a DB migration involved
Migrations are **forward-only**. If a deploy shipped a migration:
- Prefer **rolling forward** with a fix — additive/backward-compatible changes
  make this safe (we require backward compatibility, see PR template).
- If you must revert code that expects a new column/table, the old code should
  still run against the newer schema (additive migrations are compatible). Only
  destructive migrations (drop/rename) block rollback — avoid them; do
  expand/contract in two releases instead.

## Verify after rollback
- `GET /health`, `GET /ready` (DB + provider ok)
- Create + simulate a test payment end-to-end
- Webhook delivery succeeds (`/metrics` queues draining)

## Comms
Update the incident channel with the rollback action and current status.
