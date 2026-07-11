# PayKH Roadmap

This roadmap tracks the **Master AI Engineering Blueprint** — 100 modules across
20 domains. Legend: ✅ shipped · 🟡 partial · ⬜ planned. We build one module at a
time, commit + deploy + review after each (see [CONTRIBUTING](CONTRIBUTING.md)).

## 1. Platform Foundation
✅ Monorepo · ✅ Architecture & standards · ✅ Railway deploy · ✅ CI/CD · ✅ Env mgmt

## 2. Identity & Security
✅ Authentication · ✅ RBAC · ✅ Tenant isolation · ✅ Secrets mgmt · ✅ MFA

## 3. Merchant Onboarding
✅ Organization · ✅ Stores · ✅ Branches · ✅ Team invitation · ✅ Merchant verification

## 4. Payment Platform
✅ Payment APIs · ✅ KHQR abstraction · ✅ Settlement · ✅ Refunds · ✅ Reconciliation

## 5. Customer Platform
✅ Customer 360 · ✅ CRM · ✅ Segmentation · ✅ Preferences · ✅ Consent

## 6. Loyalty
✅ Points · ✅ Tiers · ✅ Rewards · ✅ Redemption · ✅ Liability

## 7. Campaign Engine
✅ Promotion builder · 🟡 Budget · 🟡 Scheduling · ✅ Approval · ✅ Simulation

## 8. Referral & Affiliate
✅ Referral links · ✅ QR · ✅ Commission · ✅ Fraud checks · ✅ Reports

## 9. Promotional Games
✅ Scratch cards · ✅ Spin wheel · ✅ Lucky draw · ✅ Prize engine · ✅ Inventory

## 10. Notification Hub
🟡 Email (Resend) · ✅ Telegram · ✅ WhatsApp · ✅ Signal · ✅ SMS

## 11. AI Services
⬜ Merchant assistant · ⬜ Campaign generator · ⬜ Fraud insights · ⬜ Marketing copy · ⬜ Analytics summary

## 12. Operations
✅ Support console (admin) · ✅ Queue monitor · ✅ Webhook retry · 🟡 Incident mgmt (runbooks) · ✅ Audit

## 13. Finance
✅ Billing · ✅ Subscriptions · ✅ Revenue share · ✅ Invoices · ✅ Accounting ledger

## 14. Risk & Compliance
✅ Risk scoring · ✅ Case mgmt · ⬜ Retention · 🟡 Compliance review · ⬜ Export controls

## 15. Analytics
✅ Dashboards · ✅ KPIs · ✅ Forecasting · ✅ Exports (CSV) · ✅ Executive reports

## 16. Mobile & Mini Apps
⬜ Telegram Mini App · ⬜ Merchant app · ⬜ Customer app · ⬜ Offline · ⬜ Push

## 17. Marketplace
⬜ Plugin framework · ⬜ Partner APIs · ⬜ App marketplace · ⬜ Connectors · ✅ SDKs

## 18. DevSecOps
✅ Threat model · ⬜ Pen testing · 🟡 Monitoring · ✅ Disaster recovery · ✅ Production readiness

## 19. AI Governance
⬜ Model registry · ⬜ Prompt governance · ⬜ Guardrails · ⬜ Evaluation · ⬜ Cost mgmt

## 20. Ecosystem Vision
⬜ Learn PayKH · ⬜ Merchant PayKH · ⬜ Gold PayKH · ⬜ Fortune PayKH · ⬜ Shared platform services

---

### Suggested next modules
1. **Refunds** (Domain 4) — refund state on payments + provider hook + webhook `payment.refunded`.
2. **Reconciliation / Settlement** (Domain 4) — settlement batches + provider reconcile job.
3. **Merchant verification** (Domain 3) — KYC/verification gating live mode.
4. **Notification Hub: Telegram** (Domain 10) — the spec's Telegram Mini App audience.
5. **Customer 360 / CRM** (Domain 5) — foundation for loyalty & campaigns.
