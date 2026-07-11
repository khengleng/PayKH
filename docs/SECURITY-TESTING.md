# Security Testing & Penetration Testing

PayKH combines an automated in-app **security-posture self-assessment**
(`GET /admin/security/posture`, platform admin) with periodic **external
penetration testing**. This document defines the pentest scope and the standing
checklist.

## Automated posture check

The posture endpoint scores runtime controls on every check:

- HTTPS/HSTS enforcement in production
- AES-256-GCM encryption-key strength
- JWT secret length
- `/metrics` bearer protection
- Redis-backed rate limiting
- Webhook HMAC-SHA256 signing
- SSRF protection (private/metadata ranges, redirect rejection)
- API keys hashed at rest (SHA-256)
- MFA availability

`GET /admin/security/monitoring` reports dependency health (DB latency, queue
backlog) and 1-hour throughput for synthetic monitoring / alerting.

## Penetration test scope

**In scope:** `api.paykh.cambobia.com`, `paykh.cambobia.com`,
`checkout.paykh.cambobia.com`.

1. **AuthN/AuthZ** — JWT & API-key handling, RBAC boundaries, tenant isolation,
   invitation flows, platform-admin separation.
2. **Payment integrity** — idempotency, state-machine transitions, refund
   over-refund guards, replay.
3. **Injection** — SQLi (Prisma-parameterised), XSS on hosted pages, SSRF via
   webhooks/connectors.
4. **Secrets** — provider-credential encryption, API-key hashing, no secrets in
   logs/responses (output scrubbing on AI).
5. **Rate limiting / DoS** — per-key & per-IP limits, quota enforcement (402).
6. **Business logic** — referral fraud screening, loyalty/point abuse, game
   inventory over-award, revenue-share tampering.

**Out of scope:** third-party providers (Bakong, Twilio, Anthropic, Resend),
DoS/volumetric attacks against shared infra, social engineering.

## Reporting

Follow the responsible-disclosure process in `SECURITY.md`. Findings are
triaged by severity (CVSS) with remediation SLAs: Critical 24h, High 7d,
Medium 30d.
