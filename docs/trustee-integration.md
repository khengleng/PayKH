# Trustee Integration

This document covers the PayKH-side preparation for integrating with the
Cambobia Trustee Banking Platform and for demonstrating trustee readiness to a
regulator.

## Goals

- Publish verifier keys PayKH uses for trustee-facing signatures.
- Surface whether PayKH's books and loyalty balances are internally clean before
  a trustee authorizes real-money production.
- Generate signed, append-only artifacts a trustee or regulator can review.

## Platform settings

Configure these in the platform admin console under `Admin -> Settings -> Trustee`
or via environment variables:

- `trustee_base_url`
- `trustee_request_signing_private_key`
- `trustee_request_signing_key_id`
- `trustee_artifact_signing_private_key`
- `trustee_artifact_signing_key_id`

All DB-backed values are AES-256-GCM encrypted at rest. A saved setting in the
admin console overrides the env var.

## Endpoints

### Public

- `GET /.well-known/paykh-trustee-keys`

Returns the public keys PayKH exposes for trustee verification. These are
derived from the configured private keys and intended for verifier key
discovery.

- `POST /api/v1/trustee/events`

Inbound receiver for events the trustee delivers to PayKH. Each delivery is
signed with the PayKH webhook scheme
(`X-Payment-Signature: t=<ts>,v1=<hmac>`, HMAC-SHA256 over `${ts}.${rawBody}`);
the receiver verifies the raw body against the configured signing secret, then
stores the event idempotently on its id (`X-Payment-Id` / payload `id`) and acks
`200`. It is public but signature-authenticated — a stored event is, by
construction, one that verified.

Responses: `200` (`{ok, id, type, duplicate}`), `400` (missing signature / bad
body / missing id+type), `401` (signature mismatch or stale timestamp), `503`
(no signing secret configured — deliveries stay queued rather than being marked
delivered).

Configure the shared secret as the `TRUSTEE_EVENTS_WEBHOOK_SECRET` env var on the
api service, or as the encrypted `trustee_events_webhook_secret` system setting.
Set it to the signing secret (`whsec_…`) of the webhook endpoint that delivers to
this receiver. See [`webhook-receiver-example.md`](./webhook-receiver-example.md)
for the verification contract.

### Platform admin

- `GET /admin/trustee/status`
- `GET /admin/trustee/artifacts`
- `POST /admin/trustee/artifacts`

`/admin/trustee/status` reports:

- trustee base URL configured or missing
- request-signing key configured or missing
- artifact-signing key configured or missing
- PayChain organization and webhook counts
- platform trial-balance state
- ledger reconciliation state
- points drift state
- latest generated trustee artifacts

`POST /admin/trustee/artifacts` accepts one of:

- `TRUSTEE_READINESS`
- `RESERVE_SNAPSHOT`
- `MINT_POLICY`

Each artifact is:

- derived from real platform state
- signed with Ed25519
- stored append-only in `TrusteeArtifact`

## Artifact meanings

### `TRUSTEE_READINESS`

Operational readiness summary for trustee onboarding:

- trustee settings present
- PayChain tenant counts
- books in balance
- points drift clear

### `RESERVE_SNAPSHOT`

Current financial/liability view for review:

- paid volume by currency
- gift card liability by currency
- points liability
- trial balance totals
- reconciliation and drift state

### `MINT_POLICY`

Control-plane statement of mint prerequisites:

- local ledger remains authoritative
- PayChain shadow mode supported
- trustee approval required for real-money production
- local merchant and webhook prerequisites

## Regulator walkthrough

For a regulator demo:

1. Open `Admin -> Trustee`.
2. Show overall readiness and individual failed/passed gates.
3. Show the public verifier key discovery path:
   `/.well-known/paykh-trustee-keys`
4. Generate:
   - readiness packet
   - reserve snapshot
   - mint policy
5. Export or copy the signed artifact JSON for review.

## Current boundary

This repository prepares PayKH for trustee integration and now accepts inbound
trustee deliveries at `POST /api/v1/trustee/events` (signature-verified,
stored idempotently). It does **not** yet act on those events — persisting is
deliberately separate from business processing. Outbound live request/response
flows against the trustee service (asserting reserves, requesting mint
authorization, etc.) remain out of scope pending the trustee-side API contract,
auth rules, and business decision endpoints.
