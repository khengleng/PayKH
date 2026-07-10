# Runbook: On-Call

## Rotation
- Weekly rotation; primary + secondary. Handoff notes each Monday.
- Ack SLA: SEV1 immediate, SEV2 ≤15 min, SEV3 next business day.

## Access checklist (have before your shift)
- Railway project access (PayKH), GitHub repo, Sentry, and the incident channel.
- The runbooks in this folder; the [incident-response](incident-response.md) flow.

## Daily hygiene
- Glance at `GET /metrics` (success rate, queue depth) and Sentry unresolved.
- Check the Security workflow + Dependabot PRs for high-severity items.

## Common actions
- Roll back a bad deploy → [rollback.md](rollback.md)
- Rotate a leaked secret → [key-compromise.md](key-compromise.md)
- Suspend/reactivate a merchant → admin console
- Re-run a failed webhook → dashboard Webhooks → Resend
