# paykh/sdk-php

Official PHP SDK for the [PayKH](https://paykh.cambobia.com) Bakong KHQR
payment gateway.

Requires PHP 8.0+ with the `curl` and `json` extensions. No heavy dependencies.

```bash
composer require paykh/sdk-php
```

## Usage

```php
use PayKH\Client;

$paykh = new Client(getenv('PAYKH_API_KEY')); // bk_live_… / bk_test_…

// Create a payment (pass an idempotency key as the 2nd argument)
$payment = $paykh->payments->create(
    [
        'amount' => '1.50',
        'currency' => 'USD',
        'reference_id' => 'order_1024',
    ],
    'order_1024', // Idempotency-Key (optional)
);

echo $payment['checkout_url'], PHP_EOL;
echo $payment['qr_string'], PHP_EOL;

// Retrieve / list / cancel
$paykh->payments->retrieve($payment['id']);
$paykh->payments->list(['status' => 'paid', 'limit' => 20]);
$paykh->payments->cancel($payment['id']);
```

By default the SDK targets `https://api.paykh.cambobia.com`. Override it (and the
request timeout) via the options array:

```php
$paykh = new Client($apiKey, [
    'base_url' => 'http://localhost:4000',
    'timeout_ms' => 15000,
]);
```

Each method returns the decoded JSON response as an associative array. See
[`docs/api.md`](../../docs/api.md) for the full field reference.

## Verifying webhooks

Verify the `X-Payment-Signature` header against the **raw** request body — never a
re-serialized copy of the JSON.

```php
use PayKH\Webhook;

$rawBody = file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_PAYMENT_SIGNATURE'] ?? '';
$secret = getenv('PAYKH_WEBHOOK_SECRET'); // whsec_…

// Boolean check:
if (!Webhook::verify($rawBody, $signature, $secret)) {
    http_response_code(400);
    exit;
}

// Or verify + parse in one step (throws PayKHException on an invalid signature):
$event = Webhook::constructEvent($rawBody, $signature, $secret);
// e.g. $event['type'] === 'payment.completed'
```

The signature scheme is `t=<timestamp>,v1=<hex>` where
`v1 = HMAC-SHA256(secret, "{timestamp}.{rawBody}")`. Verification uses a
constant-time digest comparison and enforces a 5-minute timestamp tolerance
(configurable via the 4th argument). See [`docs/webhooks.md`](../../docs/webhooks.md).

## Errors

Failed requests throw a `PayKH\PayKHException` exposing:

- `getErrorCode()` — the machine-readable API error code (e.g. `payment_not_found`)
- `getMessage()` — the human-readable message
- `getHttpStatus()` — the HTTP status code
- `getRequestId()` — the API `request_id`, when present

```php
use PayKH\PayKHException;

try {
    $paykh->payments->retrieve('pay_missing');
} catch (PayKHException $e) {
    error_log($e->getErrorCode() . ': ' . $e->getMessage() . ' (' . $e->getRequestId() . ')');
}
```

## Development

```bash
composer install
composer test        # runs PHPUnit
```

Licensed under Apache-2.0.
