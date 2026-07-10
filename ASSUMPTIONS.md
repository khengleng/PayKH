# Phase 1 Assumptions & Scope Decisions

This document records the judgment calls made while implementing **Phase 1**.
The full spec describes the entire platform; per the delivery plan, only Phase 1
is implemented here. Everything below is either done, deliberately deferred, or a
concrete decision.

## Implemented in Phase 1

- Monorepo (npm workspaces) with `api`, `dashboard`, `checkout`, `worker` and
  `shared-types`, `security` packages.
- Merchant sign-up / login (email + password, JWT sessions).
- Organizations, stores, store branding.
- API keys: `bk_test_` / `bk_live_`, SHA-256-hashed at rest, secret shown once,
  create / list / revoke / rotate.
- Payments: create / retrieve / list (cursor pagination) / cancel, with a
  strict state machine (`paid` terminal) and lazy expiry.
- **Mock** KHQR provider behind the `PaymentProvider` interface, generating a
  CRC-valid EMVCo/KHQR-style payload. Timeout + retry + circuit-breaker wrapper.
- Idempotency on payment creation (replay + conflict).
- Hosted checkout page with live status (SSE + polling fallback), countdown,
  branding, and success/failure/expired/cancelled screens.
- Basic dashboard: overview metrics, payments list + detail/timeline, API keys,
  stores/branding/credentials/live-mode.
- Encrypted provider credentials (AES-256-GCM).
- Structured errors, request ids, `/health`, `/ready`, OpenAPI at `/docs`.
- Audit logging for auth, key, store, branding, and credential actions.
- Dockerfiles, Railway config, initial migration, seed script.
- Unit tests for crypto, KHQR/CRC, amount validation, and the state machine;
  end-to-end runtime verification of the full flow.

## Phases 2–4 (delivered after initial review)

- **Phase 2:** real `BakongKhqrProvider`, signed webhooks + BullMQ retry worker,
  payment status monitoring + expiry sweep, hardened idempotency.
- **Phase 3:** plans & quota enforcement (HTTP 402 + 70/90/100% warnings),
  billing (plan change, subscription/plan history, usage ledger, invoices),
  team RBAC with invitations (auto-join on register), audit-log views,
  reporting (date-range metrics + CSV).
- **Phase 4:** Node/PHP/Python SDKs, sandbox (test mode + simulator), Redis
  rate limiting (429), MFA (TOTP), `/metrics`, and the security / load-testing /
  disaster-recovery / production-readiness / sandbox docs + Postman collection.

### Phase 2–4 decisions
- **Billing has no real charge collection.** Plan changes are manual/self-serve
  (MVP), issuing an invoice record but not collecting payment. Bakong-based
  subscription billing is a later refinement — merchant customer payments and
  platform subscription payments already use separate ledgers/references.
- **Bakong provider is implemented but deployed on `mock`.** Real NBC
  credentials/token are required to activate (`PAYMENT_PROVIDER=bakong`); its
  network mapping is unit-tested with a mocked HTTP client.
- **The worker runs the API image** (`apps/api/Dockerfile.worker`) rather than a
  separate package, so all business logic (transitions, webhooks, quota) is
  shared with zero duplication. The Phase 1 `apps/worker` stub was removed.
- **Rate limiting is fixed-window and fails open** on Redis errors.
- **Email delivery** (invitations, quota warnings, endpoint auto-disable
  notices) is surfaced in-app (tokens/audit/security events); SMTP delivery is a
  remaining Phase 4+ item.
- **Reporting time-series** uses a parameterized `date_trunc` raw query.

## Deliberately deferred (roadmap beyond this build)

- **Real Bakong integration** (Phase 2): `BakongKhqrProvider` is a placeholder
  that throws unless implemented; `PAYMENT_PROVIDER=mock` is the default.
- **Webhooks** (Phase 2): the event contract, signing (`@paykh/security` HMAC),
  and data model exist; the **delivery worker** (retries, logs, resend,
  test-send, auto-disable) is not built. The worker app is a keep-alive stub.
- **Plans, quotas, billing** (Phase 3): `Plan`, `Subscription`, `UsageRecord`,
  `Invoice` are in the schema and seeded, but quota enforcement (HTTP 402),
  warning thresholds, and billing flows are **not** enforced yet.
- **Team RBAC UI, audit-log views, reporting exports** (Phase 3): the RBAC
  permission matrix and audit records exist server-side; the management UI does
  not. (Payments CSV export is included in the dashboard as a small convenience.)
- **SDKs, sandbox, security hardening, load/DR** (Phase 4): SDK packages are
  README placeholders.

## Concrete decisions

1. **RBAC via role enum, not Role/Permission tables.** The spec lists `Role` and
   `Permission` models. Phase 1 implements least-privilege authorization with a
   `MemberRole` enum on `OrganizationMember` plus a code-defined permission
   matrix (`auth/rbac.ts`). Standalone Role/Permission tables (custom roles) are
   a Phase 3 refinement. This is simpler and sufficient for the four fixed roles.

2. **Forward-compatible schema.** Webhook/Plan/Billing models are defined now
   (not exercised) so Phase 2/3 don't require a disruptive migration.

3. **Payment status is DB-authoritative in Phase 1.** The mock provider does not
   drive state; transitions happen via the test-only `simulate` endpoint (which
   backs the "run a test payment" onboarding step) and lazy expiry. In Phase 2
   the Bakong provider's `checkPaymentStatus` + a polling worker become the
   source of truth.

4. **Live status uses an in-process event bus.** Fine for a single API instance.
   Phase 2 swaps in Redis pub/sub for horizontal scaling; the browser already
   falls back to polling if SSE drops.

5. **Rate limiting** is enforced at the edge (Railway) / documented as a control;
   a Redis-backed distributed limiter is a Phase 4 item. The error code
   (`rate_limit_exceeded`) and 429 mapping exist.

6. **Ids.** Resources use prefixed random base58 ids (`pay_`, `key_`, `store_`,
   `org_`); users/branding/etc. use cuid. Ordering is by `createdAt`.

7. **KHR amounts** allow 2 decimal places in storage though KHR is practically
   integer; bounds are enforced per currency.

8. **`next@14.2.5`** is pinned for reproducibility; bump to the latest 14.2.x
   patch before production (a published advisory exists). Tracked as a Phase 4
   dependency-hardening task.

## Verification performed

- `npm test` — 28 passing tests (security: 14, api: 14).
- Full type-check/build of all workspaces.
- Live end-to-end run against Postgres: register/login → create store → create
  API key → create payment (+ idempotency replay & conflict) → simulate
  scanned→paid → illegal-transition rejection → public checkout view (verified
  secret-free) → SSE stream → auth rejection & amount validation.
