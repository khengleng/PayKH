# Runbook: Key / Secret Compromise

## Merchant API key leaked (bk_live_ / bk_test_)
1. Dashboard → API Keys → **Revoke** the key (or `POST /api-keys/:id/revoke`).
   Revocation is immediate — subsequent requests return `unauthorized`.
2. **Rotate** to issue a replacement; update the merchant's integration.
3. Review that key's recent payments in the dashboard for abuse.

## Webhook signing secret leaked
1. Dashboard → Webhooks → **Rotate signing secret** (old secret valid 24h grace).
2. Update the receiver to the new secret before the grace window ends.

## Platform secret compromised (JWT_SECRET / ENCRYPTION_KEY / BAKONG token)
- **JWT_SECRET:** set a new value on api + worker and redeploy. All existing
  dashboard sessions are invalidated (users re-login). Low blast radius.
- **BAKONG_API_TOKEN / platform account:** rotate with NBC, update the api +
  worker variables, redeploy.
- **ENCRYPTION_KEY — CRITICAL, do NOT rotate naively.** It decrypts every
  `ProviderCredential.secretCiphertext` and `User.mfaSecret`. To rotate:
  1. Add the new key alongside the old (dual-key), decrypt-with-old +
     re-encrypt-with-new every ciphertext in a migration script.
  2. Only then remove the old key.
  Rotating without re-encrypt makes provider credentials + MFA unrecoverable.

## Always
- Record the incident + actions in the audit log context; write a postmortem.
- If customer data was exposed, follow breach-notification obligations
  (see docs/legal/privacy.md).
