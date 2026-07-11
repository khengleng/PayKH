# Changelog

All notable changes to PayKH are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses
[Semantic Versioning](https://semver.org/). Releases are cut by tagging `vX.Y.Z`
(see `.github/workflows/release.yml`).

## [Unreleased]

### Added
- **Referral & Affiliate → Reports** (Domain 8): a referral analytics report
  (`GET /dashboard/stores/:id/referrals/report`) — the funnel (pending →
  rewarded), **conversion rate**, fraud-flagged count, **commission totals by
  status/currency** (accrued/held/paid/void), and a **top-referrers**
  leaderboard (successful referrals + commission earned). Surfaced as a stats
  strip on the dashboard. **Domain 8 complete.**
- **Referral & Affiliate → QR** (Domain 8): server-side referral QR codes —
  `GET /v1/customers/:id/referral-qr` (API key) and a dashboard variant return
  the share URL plus a **PNG data URL** and inline **SVG** for the customer's
  referral link (lazily allocating the code). Rendered + downloadable in
  Customer 360.
- **Referral & Affiliate → Fraud checks** (Domain 8): referrals are screened at
  link time for **shared contact** (same email/phone as the referrer → likely a
  self-referral via a second account) and **velocity** (a referrer creating >10
  referrals in 24h). Flagged referrals **withhold the points reward** and accrue
  commissions as **HELD** (excluded from payout). A dashboard review panel lets
  the merchant **clear** (release held commissions) or **void** (cancel them).
- **Referral & Affiliate → Commission** (Domain 8): affiliate commission — the
  referrer earns a configurable **% (basis points) of every paid payment** their
  referees make (not just the one-time points bonus), optionally limited to a
  **duration window** after the referral. Each accrual is an idempotent ledger
  entry (`ReferralCommission`, one per payment); the dashboard shows **owed vs.
  paid per referrer** and supports a **payout** (all or one referrer) that marks
  entries paid with an optional external reference.
- **Notification Hub → Telegram** (Domain 10): per-store Telegram notifications
  for payment events (mirrors the webhook fan-out — completed/refunded/failed/
  expired/cancelled, with event selection). Pluggable `TelegramService` (Bot API
  + log fallback when `TELEGRAM_BOT_TOKEN` is unset). Dashboard config + test
  send.
- **Referral & Affiliate → Referral links** (Domain 8): a per-store referral
  program (referrer + referee point rewards). Customers get a referral code +
  share URL (`POST /v1/customers/:id/referral-code`); a new customer created
  with `referral_code` is linked; **both parties are rewarded loyalty points on
  the referee's first paid payment** (idempotent). Dashboard referral config +
  list.
- **Campaign Engine → Approval & Simulation** (Domain 7): promotions now require
  **owner approval** before activation (separation of duties — build vs.
  approve). A **dry-run simulation** estimates a promo's **reach** (target
  customers) and **bonus-point cost** by replaying the last 30 days of the
  targets' paid payments, flagging whether it fits the budget.
- **Campaign Engine → Promotion builder** (Domain 7): promotions that award
  bonus loyalty points on paid payments — `POINTS_MULTIPLIER` (×N of base earn)
  or flat `BONUS_POINTS`, optionally gated by min payment amount, **targeted to a
  segment**, with a **points budget** cap (auto-ends when exhausted) and an
  optional **schedule** window. Draft → activate/pause/end lifecycle. Applied
  automatically in the loyalty earn path. Dashboard Campaigns page.
- **Segmentation** (Domain 5): rule-based customer segments (min lifetime
  points, min points balance, tier, has-email, min paid count/volume, last
  payment within N days). Live **preview size**, saved segments with an
  **Evaluate** count + sample. Dashboard Segments page; feeds the Campaign
  Engine. (Safe structured rules — no free-form SQL.)
- **Loyalty → Tiers** (Domain 6): per-store tiers with a lifetime-points
  threshold and an **earn multiplier**. Customers are auto-assigned the highest
  tier they qualify for as they earn; the multiplier boosts future earnings
  (`floor(base × multiplier)`). Tier + lifetime points surface in Customer 360.
- **Loyalty → Rewards & Redemption** (Domain 6): a per-store rewards catalog
  (points cost, optional stock). Customers redeem points for a reward via
  `POST /v1/loyalty/redemptions` → a voucher code, deducting points + stock
  atomically. Merchants **fulfill** or **cancel** (refunds points + restores
  stock) from the dashboard. Insufficient balance / out-of-stock rejected.
- **Loyalty → Points** (Domain 6): a per-store loyalty program (active +
  points-per-unit). Customers **earn points automatically on paid payments**
  (when a `customer_id` is attached), tracked in a points ledger with a
  denormalized balance. Redeem via `POST /v1/loyalty/redeem` (API key) and
  manual `+/-` adjust from the dashboard; balance shown in Customer 360.
- **Customer 360 / CRM** (Domain 5): customer records (name/email/phone/
  external_id/metadata) with `POST/GET /v1/customers`; attach a `customer_id` to
  payments; a dashboard **Customers** page with a **Customer 360** view (lifetime
  value, paid volume, refunds, recent payments). Foundation for Loyalty &
  Campaigns.
- **Branches** (Domain 3): sub-locations under a store (name/code/address,
  active flag). Manage from the dashboard (Stores → Branches); attribute a
  payment to a branch via `branch_id` on `POST /v1/payments`. **Domain 3
  complete.**
- **Merchant verification / KYC** (Domain 3): merchants submit business details;
  platform admins approve/reject (admin console). **Live-mode activation is now
  gated** on an approved verification. Owners are emailed the decision. Audited.
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
