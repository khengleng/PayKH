# Runbook: Incident Response

## Severity levels

| Sev | Definition | Response |
|-----|------------|----------|
| SEV1 | Payments down / data loss / active breach | Page on-call immediately; all hands |
| SEV2 | Degraded (elevated errors, webhook backlog, checkout slow) | On-call within 15 min |
| SEV3 | Minor / single-merchant issue | Next business day |

## First 15 minutes

1. **Acknowledge** and declare severity in the incident channel.
2. **Assess blast radius:** `GET /health`, `GET /ready`, `GET /metrics` on the
   api; Railway service status for api/worker/Postgres/Redis.
3. **Stabilize, don't debug:** if a bad deploy, **roll back first**
   ([rollback.md](rollback.md)), investigate after.
4. **Communicate:** post status + ETA; update every 30 min.

## Triage by signal

- **5xx spike** → check Sentry (`SENTRY_DSN`) for the top exception + `request_id`;
  check recent deploy; check DB/Redis health via `/ready`.
- **Webhook backlog** → `GET /metrics` `queues.webhook`; verify the `worker`
  service is up; check for a failing merchant endpoint auto-disable loop.
- **Payments not confirming** (live) → provider health in `/ready`; Bakong API
  status; circuit breaker open? (logs: "circuit open").
- **DB errors** → connection limits, disk, or a long migration; Railway Postgres
  metrics.
- **Auth failures spike** → possible credential stuffing; confirm rate limiting
  is active (Redis up); consider tightening limits.

## Contain

- Rotate a leaked key → [key-compromise.md](key-compromise.md).
- Suspend an abusive merchant → admin console (`POST /admin/orgs/:id/suspend`).
- Redis down → rate limiting fails open (documented); prioritize Redis recovery
  to restore webhook retries.

## After resolution

- Write a **blameless postmortem** within 3 business days: timeline, root cause,
  contributing factors, action items with owners.
- File action items as issues; link to the incident.
