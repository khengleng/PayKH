# paykh

Official Python SDK for the [PayKH](https://paykh.cambobia.com) Bakong KHQR
payment gateway. Pure standard library — no runtime dependencies.

```bash
pip install paykh
```

Requires Python 3.8+.

## Usage

```python
import os
import paykh

client = paykh.PayKH(os.environ["PAYKH_API_KEY"])  # bk_live_… / bk_test_…

# Create a payment
payment = client.payments.create(
    amount="1.50",
    currency="USD",
    reference_id="order_1024",
    idempotency_key="order_1024",
)
print(payment["checkout_url"], payment["qr_string"])

# Retrieve / list / cancel
client.payments.retrieve(payment["id"])
client.payments.list(status="paid", limit=20)
client.payments.cancel(payment["id"])
```

By default the SDK targets `https://api.paykh.cambobia.com`. Override with
`paykh.PayKH(key, base_url="http://localhost:4000")`.

Payment fields are passed as keyword arguments to `create()`; pass
`idempotency_key=...` to send the `Idempotency-Key` header. Methods return
parsed `dict`s matching the API JSON.

## Verifying webhooks

```python
from paykh import verify_webhook, construct_event

# In your webhook handler (raw_body must be the exact received bytes/string):
signature = request.headers["X-Payment-Signature"]

result = verify_webhook(raw_body, signature, endpoint_signing_secret)
if not result.valid:
    # result.reason: "malformed" | "timestamp_out_of_tolerance" | "signature_mismatch"
    return "", 400

# Or verify + parse in one step (raises PayKHError on invalid signature):
event = construct_event(raw_body, signature, endpoint_signing_secret)
print(event["type"], event["data"]["payment"]["id"])
```

The signature scheme is `t=<timestamp>,v1=<hex hmac>`, where `v1` is
`HMAC-SHA256(signing_secret, "{timestamp}.{raw_body}")`. Verification uses a
constant-time comparison and enforces a 5-minute timestamp tolerance
(configurable via `tolerance_seconds`). Always verify over the **raw request
body** — do not re-serialize the JSON.

## Errors

Failed requests raise a `paykh.PayKHError` with `code`, `status`, `message`,
and `request_id` (see [docs/api.md](../../docs/api.md#errors)).

```python
try:
    client.payments.retrieve("pay_missing")
except paykh.PayKHError as err:
    print(err.code, err.status, err.message, err.request_id)
```

## Development

```bash
python3 -m pytest        # or: python3 -m unittest discover tests
```
