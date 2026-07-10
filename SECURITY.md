# Security Policy

## Reporting a vulnerability

If you believe you've found a security vulnerability in PayKH, please report it
**privately**. Do not open a public issue.

- Email: **security@cambobia.com** (PGP available on request)
- Include: a description, reproduction steps, affected endpoint/version, and
  impact. A proof-of-concept helps.
- We aim to acknowledge within **2 business days** and provide a remediation
  timeline within **7 days**. Please allow us reasonable time to fix before any
  public disclosure (coordinated disclosure).

We will not pursue legal action for good-faith research that: stays within test
accounts, avoids privacy violations and service degradation, and does not exfil
or destroy data.

## Supported versions

The `main` branch (latest deploy) receives security fixes. Tagged releases are
patched on a best-effort basis for the latest minor.

## Handling of secrets

Never include real secrets in reports, issues, or PRs. If a secret is exposed
(API key, `ENCRYPTION_KEY`, `JWT_SECRET`, provider token), follow the
[key-compromise runbook](docs/runbooks/key-compromise.md).

## Security controls (summary)

See [docs/security.md](docs/security.md) and the
[threat model](docs/threat-model.md). Highlights: hashed API keys, AES-256-GCM
encrypted provider credentials, signed webhooks (HMAC-SHA256), RBAC least
privilege, tenant isolation, Redis rate limiting, MFA (TOTP), append-only audit
logs, and CI security scanning (npm audit, gitleaks, CodeQL).
