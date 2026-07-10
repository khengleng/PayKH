# Merchant Onboarding

The Phase 1 onboarding path, end to end.

## Flow

1. **Sign up** — `POST /auth/register` (email + password; Google OAuth in Phase 2).
   Creates the user, an organization, and an `OWNER` membership.
2. **Organization** — created automatically at sign-up (rename in Phase 3 UI).
3. **Create a store** — `POST /stores` (dashboard → Stores → *Create store*).
4. **Configure provider credentials** — dashboard → Stores → *Bakong provider
   credentials*. Stored AES-256-GCM-encrypted. (Phase 1 uses the mock provider
   regardless; this wires up for Phase 2.)
5. **Create your first API key** — dashboard → API Keys → *Create key*
   (`bk_test_…`). The full secret is shown **once** — store it now.
6. **Customize checkout branding** — dashboard → Stores → *Checkout branding*
   (display name, primary color, logo, support email, redirect URLs, message).
7. **Create a webhook endpoint** — Phase 2.
8. **Run a test payment** — see below.
9. **Activate production** — dashboard → Stores → *Activate live mode*, then
   create `bk_live_…` keys.

## Sandbox vs live

- **Test mode** (`bk_test_`): mock provider, status simulation enabled.
- **Live mode** (`bk_live_`): real provider (Phase 2); simulation disabled.

Test and live keys, payments, and credentials are kept separate throughout.

## Run a test payment

```bash
# 1. Create a payment with your test key
curl -X POST http://localhost:4000/v1/payments \
  -H "Authorization: Bearer bk_test_xxx" \
  -H "Content-Type: application/json" \
  -d '{"amount":"1.50","currency":"USD","reference_id":"order_1024"}'
# → note the "id" and open the "checkout_url" in a browser

# 2. Simulate the customer paying (test keys only)
curl -X POST http://localhost:4000/v1/payments/pay_xxx/simulate \
  -H "Authorization: Bearer bk_test_xxx" \
  -H "Content-Type: application/json" \
  -d '{"status":"scanned"}'

curl -X POST http://localhost:4000/v1/payments/pay_xxx/simulate \
  -H "Authorization: Bearer bk_test_xxx" \
  -H "Content-Type: application/json" \
  -d '{"status":"paid"}'
```

The open checkout page updates live (SSE) from *pending → scanned → paid* and
shows the success screen.

## Seeded demo account

`npm run db:seed` prints a ready-to-use demo merchant (email
`owner@demo.paykh.dev`, password `Password123!`) with a store and a test API key.
