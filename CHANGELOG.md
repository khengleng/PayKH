# Changelog

All notable changes to PayKH are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses
[Semantic Versioning](https://semver.org/). Releases are cut by tagging `vX.Y.Z`
(see `.github/workflows/release.yml`).

## [Unreleased]

### Added
- **Payment Links & Invoicing** (GTM — no-code get-paid): merchants create a
  shareable **payment link** (fixed or customer-entered amount, single-use or
  reusable) or an **invoice** (addressed customer, line items) with no code.
  Opening the hosted link (`checkout/l/:id`) mints a Payment for the store — the
  link id is the authorization, no API key — and hands off to KHQR checkout.
  Dashboard builder with copyable URLs; public `GET /links/:id` + `POST
  /links/:id/pay`.
- **ABAC policy layer** (Domain 2, on top of RBAC): attribute-based access control
  — decisions from subject/resource/environment attributes. Policies: high-value
  refunds (≥ $500) require **owner**; analysts can't write to **live** stores;
  live API keys require **owner**; high-value refunds on a live store require
  **MFA**. Enforced at dashboard refund + API-key creation. New `access` module
  exposes the **RBAC role×permission matrix**, the ABAC policy catalogue, and a
  decision-**simulator** (`/dashboard/orgs/:id/access/check`). Dashboard **Access
  Control** page with the matrix + a live policy simulator. 8 unit tests.
- **Portal visual polish v2**: replaced emoji nav with a bespoke **SVG line-icon
  set**, and added dependency-free **charts** (gradient area chart with forecast
  overlay) to Overview (30-day revenue) and Analytics.
- **Automated E2E test suite + load harness** (go-live readiness): a booted-app
  integration suite (`npm run test:e2e`) covering the money paths — payment
  lifecycle, idempotency, illegal-transition guards, **balanced double-entry
  journal on capture**, refund + over-refund block, and **ledger reconciliation**
  — now wired into CI (Postgres + Redis services + seed). A dependency-free
  **load harness** (`npm run loadtest`) reports throughput + p50/p95/p99 latency
  and separates graceful 429 throttling from real errors (verified: 0 real errors
  under an 800-request burst, p99 ~57ms).
- **Right-to-erasure / data retention** (Domain 14): `DELETE /dashboard/customers/
  :id/pii` irreversibly anonymizes a customer's PII (name/email/phone/external
  id/metadata) and drops preferences + consent trail, **while preserving the
  immutable financial record** (payments + ledger keep only the pseudonymous id).
  Customer 360 "Erase PII" action.
- **Persisted double-entry ledger & reconciliation** (Domain 13 — financial
  assurance): an **append-only** journal (`LedgerAccount`/`JournalEntry`/
  `LedgerEntry`) where every journal's debits equal its credits. Money events post
  balanced journals automatically — **payment captured** (Dr clearing / Cr
  merchant-payable + fee-revenue), **refunds** (proportional reversal), and
  **affiliate commission** accrual/payout — each idempotent per event+reference.
  A **reconciliation engine** runs five checks (journal integrity, trial-balance
  zero-sum per currency, paid-payment coverage, fee-revenue tie-out, merchant-
  payable tie-out) and reports breaks; an idempotent **backfill** posts historical
  records. Dashboard **Ledger** page (trial balance, recon status, journals) +
  admin platform-wide recon. This replaces the earlier *derived* ledger view for
  audit-grade balances.
- **Ecosystem products & Shared services** (Domain 20): an ecosystem registry
  (`GET /ecosystem/products`) mapping the suffixed product lines — **Merchant
  PayKH** (dashboard PWA, live), **Fortune PayKH** (games, live), **Customer
  PayKH** (wallet, live), Gold PayKH (planned), Learn PayKH (docs/SDKs) — onto
  the 10 shared platform services they build on. Brand identity finalized (brand
  blue `#1E5BD6` default, app icon/PWA).
- **Security → Posture & Monitoring** (Domain 18): an automated **security-posture
  self-assessment** (`/admin/security/posture` — transport, key strength, metrics
  protection, rate limiting, webhook signing, SSRF, key hashing, MFA → a score),
  a **synthetic monitoring** endpoint (`/admin/security/monitoring` — DB latency,
  queue backlog, 1h throughput), and a penetration-testing scope/checklist
  (`docs/SECURITY-TESTING.md`).
- **Mobile & Apps → Customer wallet + Merchant PWA** (Domain 16): a public
  customer **loyalty wallet** pass (`/wallet/:customerId` on checkout — points,
  tier, referral QR, unrevealed scratch cards), and the dashboard is now an
  installable **PWA** ("Merchant PayKH") with a web manifest, brand icon, and an
  offline-first service worker (app shell + network-first navigations).
- **Ecosystem → Connectors & App Marketplace** (Domain 17): install third-party
  **connectors** (Slack, Zapier, custom webhook) that receive payment events
  (fire-and-forget, per-event selection, 5s timeout, secret-masked URLs) plus a
  **marketplace** catalog and a dashboard to install/test/remove them. Wired into
  the event fan-out alongside messaging channels.
- **AI Governance** (Domain 19): every Copilot call now runs through governance —
  **guardrails** (prompt-injection detection, input caps, output secret-scrubbing),
  **usage & cost logging** (`AiUsageLog` with per-model token pricing), a
  **model registry** (admin), and **spend dashboards** per-store and
  platform-wide. Calls are tagged `ai`/`fallback`/`blocked`. **Domain 19
  substantially complete.**
- **AI Copilot** (Domain 11): a merchant AI suite — **marketing copy** generator,
  **campaign suggestion**, plain-English **analytics summary**, **fraud insights**
  (narrated from open risk cases), and a **merchant assistant** grounded in the
  store's own 30-day data. Backed by Claude (Anthropic Messages API) when
  `ANTHROPIC_API_KEY` is set, with a **grounded computed fallback** otherwise
  (responses are tagged `ai` vs `computed`). New dashboard **Copilot** page.
  **Domain 11 complete.**
- **Risk & Compliance → Scoring & Case management** (Domain 14): a heuristic
  fraud/risk score (0-100) on every paid payment (transaction size, customer
  velocity, account age, anonymity, repeated-amount card-testing) that
  auto-opens a **RiskCase** past a threshold (idempotent per payment). A
  dashboard **Risk** page to triage cases (open → investigating → escalated →
  resolved, with resolution notes) and a status summary.
- **Ops → Support console & Queue monitor** (Domain 12): a platform-admin
  **universal support lookup** (`/admin/support/search`) across payments,
  customers, stores, and orgs by id/reference/email/phone/name, and a **queue
  monitor** (`/admin/queues`) exposing live BullMQ depths (waiting/active/
  completed/failed/delayed) for the webhook + maintenance queues. Both on the
  admin console. **Domain 12 complete.**
- **Monetization → Revenue share & Accounting ledger** (Domain 13): partner
  **revenue-share agreements** (a partner earns N bps of a store's processing
  fees) with CRUD, and a **derived accounting ledger** — a read-only P&L over a
  window (gross revenue, refunds, processing fees, affiliate commissions, partner
  revenue share → net earnings) computed from source tables so it can't drift.
  Surfaced on the Analytics page. **Domain 13 complete.**
- **Analytics → Dashboards, Forecasting & Executive reports** (Domain 15): a daily
  revenue/count **time-series**, a **7-day revenue forecast** (OLS linear trend
  blended with a 7-day moving average over a dense 30-day vector), and an
  **org-level executive summary** (30-day revenue + growth-vs-prior, success rate,
  customers, points liability, referral commissions, game plays, top stores). New
  dashboard **Analytics** page with an inline chart. **Domain 15 complete.**
- **Promotional Games → Hosted play (Spin wheel / Lucky draw / Scratch)** (Domain
  9): a customer-facing hosted play experience on the checkout app — a spin-wheel
  / lucky-draw page (`/play/game/:id`) and a scratch-card reveal page
  (`/play/:playId`) with animations. Backed by public (no-API-key, IP
  rate-limited) endpoints where the game/play id is the bearer token, mirroring
  the payment checkout page. **Domain 9 complete.**
- **Loyalty → Liability** (Domain 6): an outstanding-points liability report
  (`GET /dashboard/stores/:id/loyalty/liability?point_value=`) — Σ balances ×
  point value, plus holders, lifetime earned/redeemed, redemption rate, and the
  largest holders. Surfaced on the loyalty card. **Domain 6 complete.**
- **Customer Preferences & Consent** (Domain 5): per-customer communication
  preferences (email/sms/whatsapp/telegram/push/marketing) via
  `GET/PUT /v1/customers/:id/preferences` (API key) and a Customer 360 toggle,
  with an **immutable consent audit log** (channel, opt-in state, source, time).
  A `hasConsent()` gate is exposed for customer-facing messaging/campaigns.
  **Domain 5 complete.**
- **Notification Hub → WhatsApp / SMS / Signal** (Domain 10): per-store messaging
  channels that mirror payment events (with per-channel event selection). WhatsApp
  & SMS send via Twilio; Signal via a signal-cli REST bridge; each falls back to a
  **log transport** when its credentials are unset. Dashboard config + test send
  per channel. **Domain 10 channels complete.**
- **Promotional Games → Scratch Cards** (Domain 9): a play-issuance layer on the
  prize engine. A game can **auto-issue a scratch card on each qualifying paid
  payment** (optional min amount, idempotent per payment) or be granted manually.
  The customer holds an **ISSUED** card and later **reveals** it
  (`POST /v1/plays/:id/reveal`) — drawing the prize and crediting points
  (idempotent). `GET /v1/customers/:id/plays` lists a customer's cards by status.
- **Promotional Games → Prize Engine & Inventory** (Domain 9): a weighted-draw
  prize engine. Merchants create a **game** (scratch card / spin wheel / lucky
  draw) with **prizes** (points / reward / custom / no-win), each with a
  **weight** (probability) and **stock** (inventory, −1 = unlimited). A play
  (`POST /v1/games/:id/play`, API key) draws a prize honoring inventory with an
  **atomic stock claim** (no over-award under concurrency) and credits loyalty
  points for POINTS prizes. Dashboard game/prize builder with live odds, stock
  and win/award stats.
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
