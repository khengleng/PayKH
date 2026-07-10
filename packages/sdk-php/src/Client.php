<?php

declare(strict_types=1);

namespace PayKH;

/**
 * PayKH API client.
 *
 * ```php
 * $paykh = new \PayKH\Client('bk_live_xxx');
 * $payment = $paykh->payments->create(['amount' => '1.50', 'currency' => 'USD']);
 * ```
 */
class Client
{
    private const DEFAULT_BASE_URL = 'https://api.paykh.cambobia.com';

    private string $apiKey;
    private string $baseUrl;
    private int $timeoutMs;

    /** Payments resource. */
    public PaymentsResource $payments;

    /**
     * @param string               $apiKey  A PayKH API key (`bk_live_…` / `bk_test_…`).
     * @param array<string, mixed> $options Optional: `base_url` (string), `timeout_ms` (int).
     */
    public function __construct(string $apiKey, array $options = [])
    {
        if ($apiKey === '') {
            throw new \InvalidArgumentException('An API key is required');
        }

        $this->apiKey = $apiKey;
        $baseUrl = $options['base_url'] ?? self::DEFAULT_BASE_URL;
        $this->baseUrl = rtrim((string) $baseUrl, '/');
        $this->timeoutMs = (int) ($options['timeout_ms'] ?? 15000);

        $this->payments = new PaymentsResource($this);
    }

    /**
     * Perform an HTTP request against the API and decode the JSON response.
     *
     * @param string                    $method         HTTP method.
     * @param string                    $path           Request path beginning with `/`.
     * @param array<string, mixed>|null $body           JSON body to send, or null.
     * @param string|null               $idempotencyKey Value for the `Idempotency-Key` header.
     *
     * @return array<string, mixed>|null Decoded response body.
     *
     * @throws PayKHException On non-2xx responses or transport errors.
     */
    public function request(
        string $method,
        string $path,
        ?array $body = null,
        ?string $idempotencyKey = null
    ): ?array {
        $headers = [
            'Authorization: Bearer ' . $this->apiKey,
            'Accept: application/json',
        ];

        $payload = null;
        if ($body !== null) {
            $payload = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if ($payload === false) {
                throw new PayKHException('invalid_request', 'Failed to encode request body: ' . json_last_error_msg());
            }
            $headers[] = 'Content-Type: application/json';
        }
        if ($idempotencyKey !== null && $idempotencyKey !== '') {
            $headers[] = 'Idempotency-Key: ' . $idempotencyKey;
        }

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $this->baseUrl . $path,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT_MS => $this->timeoutMs,
            CURLOPT_CONNECTTIMEOUT_MS => $this->timeoutMs,
        ]);
        if ($payload !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        }

        $raw = curl_exec($ch);
        if ($raw === false) {
            $errno = curl_errno($ch);
            $error = curl_error($ch);
            curl_close($ch);
            throw new PayKHException('connection_error', "Request to PayKH failed: {$error} (errno {$errno})");
        }

        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        $data = null;
        if (is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);
            if (json_last_error() === JSON_ERROR_NONE) {
                $data = $decoded;
            } elseif ($status < 200 || $status >= 300) {
                throw new PayKHException('error', "HTTP {$status}", $status);
            }
        }

        if ($status < 200 || $status >= 300) {
            $envelope = is_array($data) ? $data : [];
            throw new PayKHException(
                is_string($envelope['error'] ?? null) ? $envelope['error'] : 'error',
                is_string($envelope['message'] ?? null) ? $envelope['message'] : "HTTP {$status}",
                $status,
                is_string($envelope['request_id'] ?? null) ? $envelope['request_id'] : null,
            );
        }

        return is_array($data) ? $data : null;
    }
}
