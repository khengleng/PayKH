# Sandbox

PayKH's sandbox is **test mode** — a fully isolated environment that shares no
data or funds with live mode.

## How it works

- Use a **`bk_test_`** API key. Test and live keys, payments, credentials, and
  webhooks are stored and counted separately.
- Test-mode payments use the **mock KHQR provider**: a real, scannable-looking
  EMVCo/KHQR payload is generated, but nothing is routed to a bank.
- You drive payment outcomes with the **test payment simulator**:

  ```bash
  # Create
  curl -X POST $BASE/v1/payments -H "Authorization: Bearer bk_test_xxx" \
    -H "Content-Type: application/json" -d '{"amount":"1.50","currency":"USD"}'

  # Advance status (test keys only): scanned | paid | failed | expired
  curl -X POST $BASE/v1/payments/pay_xxx/simulate \
    -H "Authorization: Bearer bk_test_xxx" \
    -H "Content-Type: application/json" -d '{"status":"paid"}'
  ```

  `simulate` is rejected with `403` for `bk_live_` keys.

- Webhooks fire in test mode exactly as in live mode (with real signatures), so
  you can build and verify your integration end to end before going live.

## Seeded sandbox credentials

`npm run db:seed` provisions a demo merchant with a `bk_test_` key and prints it.
Log in to the dashboard as `owner@demo.paykh.dev` / `Password123!` to manage it.

## Going live

Configure Bakong provider credentials, switch the store to live mode, and issue
`bk_live_` keys. See [merchant-onboarding.md](merchant-onboarding.md) and the
go-live steps in [production-readiness.md](production-readiness.md).
