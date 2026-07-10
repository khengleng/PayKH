# Service Level Objectives (SLOs)

Measured monthly. Error budget = 100% − target.

| SLO | Target | Signal |
|-----|--------|--------|
| API availability | 99.9% | `GET /health` 200 (external uptime monitor) |
| Create-payment success | ≥ 99.5% | non-5xx on `POST /v1/payments` |
| Create-payment latency | p95 < 800 ms | request duration |
| Webhook delivery | ≥ 99% within 5 min | `WebhookDelivery` succeeded ≤ 5 min |
| Payment-confirmation lag (live) | p95 < 60 s | paid_at − scanned_at (status poll every 20s) |

## Alerting (recommended)
- Uptime monitor on `https://api.paykh.cambobia.com/health` (1-min interval) →
  page on 2 consecutive failures.
- Sentry alert on new/critical exception or error-rate spike.
- Metric alert on `queues.webhook.failed` growth or `provider.healthy=false`.

## Error budget policy
If a monthly SLO is missed, freeze non-critical feature work and prioritize
reliability until the budget recovers.
