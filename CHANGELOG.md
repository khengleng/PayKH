# Changelog

All notable changes to PayKH are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses
[Semantic Versioning](https://semver.org/). Releases are cut by tagging `vX.Y.Z`
(see `.github/workflows/release.yml`).

## [Unreleased]

### Added
- **Settlement & Reconciliation** (Domain 4): daily settlement batches per
  store/currency (gross/refunds/fee/net, `Store.feeBps`), an hourly worker
  settlement-sweep plus a manual "settle now", and a reconciliation engine
  (internal invariants + Bakong provider cross-check) producing stored reports.
  Dashboard **Settlements** page.
- **Refunds** (Domain 4): full/partial refunds on paid payments with an
  optimistic-locked balance (no over-refund), idempotency, `payment.refunded`
  webhook, audit logging, and a dashboard refund action. Provider abstraction
  gains `refundPayment()` (mock succeeds; Bakong records a manual-settlement
  intent).
- **DevSecOps/Release:** hardened CI (lint + Prisma validate + Python SDK tests),
  a Security workflow (npm audit, gitleaks, CodeQL), Dependabot, CODEOWNERS,
  PR template, and a tag-driven release workflow.
- **Ops:** incident-response / on-call / key-compromise / rollback runbooks and
  SLOs.
- **Security:** `SECURITY.md` (responsible disclosure) and a threat model.
- **Product:** roadmap, quickstart, legal stubs (ToS/Privacy/DPA), and a
  platform-admin console (merchants, plans, metrics, suspend).

## [0.4.0] — Phase 4 + billing/email/observability

### Added
- Billing charge collection (subscription KHQR on a separate ledger), renewal +
  dunning + grace + suspension worker sweep.
- Transactional email via Resend (invites, quota warnings, endpoint auto-disable)
  with a log-transport fallback.
- Sentry error tracking (opt-in via `SENTRY_DSN`).
- Node/PHP/Python SDKs; sandbox; Redis rate limiting (429); MFA (TOTP);
  `/metrics`.
- Plans & quotas (HTTP 402 + warnings), billing, team RBAC + invitations,
  audit-log views, reporting.

## [0.2.0] — Phase 2

### Added
- Real Bakong provider; signed webhooks + BullMQ retry worker; payment status
  monitoring + expiry sweep; hardened (atomic) idempotency.

## [0.1.0] — Phase 1 (MVP)

### Added
- Monorepo; merchant auth; stores; API keys; payments create/retrieve/list/cancel
  with a state machine; mock KHQR provider; hosted checkout; dashboard; OpenAPI;
  health/readiness; audit logging; Railway deployment.
