# Threat Model

Scope: the PayKH payment gateway (API, worker, dashboard, checkout) and its data
(merchants, payments, credentials, webhooks, billing). Methodology: STRIDE per
trust boundary. See [security.md](security.md) for control details.

## Trust boundaries & assets

```
[Customer browser] --public--> [checkout]  --public read--> [API /checkout]
[Merchant browser] --JWT-----> [dashboard] --JWT----------> [API control plane]
[Merchant server ] --API key-> [API /v1]
                                   |         [worker] --HMAC--> [Merchant webhook URL]
                                   v
                              [Postgres] [Redis]
```

Assets, by sensitivity: provider credentials (AES-GCM) > API keys (hashed) /
passwords (bcrypt) / MFA secrets (AES-GCM) > payment data > merchant PII.

## STRIDE analysis

| Threat | Vector | Control |
|--------|--------|---------|
| **Spoofing** | Forged API key / JWT | Keys hashed + looked up by digest; JWT signed (`JWT_SECRET`), re-checked per request; MFA (TOTP) |
| **Spoofing** | Forged webhook to merchant | HMAC-SHA256 signature, 5-min timestamp tolerance, constant-time compare |
| **Tampering** | Modify payment in flight | Single-writer state machine; DB constraints; TLS in transit |
| **Tampering** | Replay a request/webhook | Idempotency keys (atomic reservation); webhook timestamp tolerance |
| **Repudiation** | Deny an action | Append-only audit log (actor/IP/UA/request id); not editable from UI |
| **Info disclosure** | Cross-tenant data access (IDOR) | Every service scopes by org/store membership; RBAC permission matrix |
| **Info disclosure** | Secrets in logs/responses | Never log full keys/secrets; checkout view is secret-free; structured errors |
| **DoS** | Brute force / flooding | Redis rate limiting (`/v1` 100/10s per key, auth 10/60s per IP), body size limits, provider circuit breaker |
| **DoS** | Webhook SSRF to internal hosts | (see below) |
| **Elevation** | Analyst performing admin actions | RBAC checks in every mutating service; last-owner guard |
| **Elevation** | Activate paid plan without paying | Plan activates only on invoice payment confirmation |

## Key residual risks & mitigations

1. **Webhook SSRF.** Merchants configure delivery URLs; the worker POSTs to them.
   Risk: pointing at internal hosts / cloud metadata (`169.254.169.254`).
   Mitigation: block private/link-local/loopback ranges + metadata IPs at
   delivery time, and prefer an egress proxy/allowlist in production. *(Tracked;
   see the security-review follow-ups.)*
2. **`ENCRYPTION_KEY` compromise** decrypts all provider credentials + MFA
   secrets → strict secret storage + rotation runbook; never rotate without
   re-encrypt.
3. **Rate limiter fails open** on Redis outage (availability over strictness) →
   monitor Redis; edge WAF for defense in depth.
4. **Single-region** Postgres/Redis → backups + DR runbook; multi-region later.

## Assumptions

- TLS terminates at Railway; internal service traffic uses private networking.
- Bakong/NBC is a trusted upstream reached over TLS with a bearer token.
- Platform operators with `platform_admin` are trusted; their actions are audited.

## Review cadence

Re-run this model whenever a new trust boundary, external integration, or data
class is added (e.g. loyalty, notifications, marketplace domains from the
blueprint). Pair with the periodic security-review CI + an annual pen test
(see [runbooks](runbooks/)).
