# Security

## Secrets & credentials

| Secret | At rest | Notes |
|--------|---------|-------|
| API keys (`bk_*`) | **SHA-256 hash** only | 256-bit random token; full secret shown once at creation. Looked up by indexed hash, compared in constant time. |
| User passwords | **bcrypt** (cost 12) | Low-entropy → slow KDF. |
| Provider credentials | **AES-256-GCM** ciphertext | Key from `ENCRYPTION_KEY` (32 bytes hex). Never returned by any endpoint. |
| Webhook signing secret | stored, rotatable | Used for HMAC-SHA256 signing (Phase 2). |

**Never logged:** full API keys, provider secrets, banking credentials. The
`store credentials` audit entry records only the mode/label, never the secret.

## Authentication & authorization

- **Public API:** API-key bearer, resolved by `ApiKeyGuard`; revoked keys are
  rejected; `last_used_at` is tracked (throttled).
- **Dashboard:** short-lived JWT (12h) signed with `JWT_SECRET`; membership and
  role are re-read from the DB on every request so changes take effect
  immediately.
- **RBAC:** least-privilege permission matrix in
  [`apps/api/src/auth/rbac.ts`](../apps/api/src/auth/rbac.ts):

  | Role | Capabilities |
  |------|--------------|
  | Owner | Everything within the org |
  | Developer | Stores (read), API keys, payments, webhooks |
  | Analyst | Read payments only |
  | Platform admin | Cross-org management (Phase 3 UI) |

## Transport & headers

- HTTPS-only in production (terminated by Railway).
- `helmet` secure headers; CSP enabled in production.
- CORS restricted to the dashboard and checkout origins.
- Request body size limited to 256 KB.

## Input / output

- All request bodies validated by `class-validator` DTOs (whitelisting strips
  unknown fields).
- Prisma parameterizes all queries (SQL-injection safe).
- Amounts handled as decimal strings end-to-end (no float rounding).
- The checkout view is a hand-built, secret-free projection.

## Idempotency & replay protection

- `Idempotency-Key` on payment creation; conflicting bodies rejected.
- Webhook signatures carry a timestamp with a 5-minute tolerance and
  constant-time comparison.

## Auditing

Append-only `AuditLog` records actor, org, store, action, before/after,
IP, user agent, request id, timestamp. Audited actions include login, API-key
create/revoke/rotate, store/branding/credential changes, and live-mode changes.
Audit records are never editable from the dashboard.

## Observability

`GET /health` (liveness) and `GET /ready` (DB + provider readiness). Every
request carries an `x-request-id`; 5xx errors are logged with the request id and
never leak internals to the client.

## Rate limiting (implemented)

Redis-backed fixed-window limiter (`apps/api/src/ratelimit`):

- Public `/v1` API: **100 requests / 10s per API key**.
- `POST /auth/login` and `/auth/register`: **10 / 60s per IP** (brute-force
  defense).

Exceeding a limit returns `429 rate_limit_exceeded` with `RateLimit-*` and
`Retry-After` headers. The limiter **fails open** if Redis is unavailable so an
outage never takes down the API.

## MFA (implemented)

TOTP-based two-factor auth (`/auth/mfa/*`). The secret is AES-GCM-encrypted at
rest and only enforced after the user confirms a code (`enable`). When enabled,
login requires a valid `mfaCode`.

## Remaining hardening (roadmap)

Automated secret rotation, external error tracking/alerting, WAF/DDoS at the
edge, and penetration testing. See [`production-readiness.md`](production-readiness.md)
and [`disaster-recovery.md`](disaster-recovery.md).
