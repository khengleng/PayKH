<?php

declare(strict_types=1);

namespace PayKH;

/**
 * Webhook signature verification.
 *
 * The `X-Payment-Signature` header has the form `t=<ts>,v1=<hexhmac>` where
 * `v1` is `HMAC-SHA256(secret, "{ts}.{rawBody}")` in hex. Verification enforces
 * a timestamp tolerance (replay protection) and compares digests in constant
 * time via {@see hash_equals()}.
 */
final class Webhook
{
    /** @var string malformed / missing signature header. */
    public const REASON_MALFORMED = 'malformed';

    /** @var string timestamp outside the allowed tolerance window. */
    public const REASON_TIMESTAMP = 'timestamp_out_of_tolerance';

    /** @var string signature does not match the expected HMAC. */
    public const REASON_SIGNATURE = 'signature_mismatch';

    private function __construct()
    {
    }

    /**
     * Verify an inbound webhook signature.
     *
     * @param string $rawBody          The exact request body bytes received (do not re-serialize).
     * @param string $signatureHeader  Value of the `X-Payment-Signature` header.
     * @param string $secret           The endpoint signing secret (`whsec_…`).
     * @param int    $toleranceSeconds Max allowed clock skew, in seconds.
     */
    public static function verify(
        string $rawBody,
        string $signatureHeader,
        string $secret,
        int $toleranceSeconds = 300
    ): bool {
        return self::check($rawBody, $signatureHeader, $secret, $toleranceSeconds) === null;
    }

    /**
     * Verify a signature and return the parsed JSON event on success.
     *
     * @return array<string, mixed> The decoded event payload.
     *
     * @throws PayKHException When the signature is invalid or the body is not JSON.
     */
    public static function constructEvent(
        string $rawBody,
        string $signatureHeader,
        string $secret,
        int $toleranceSeconds = 300
    ): array {
        $reason = self::check($rawBody, $signatureHeader, $secret, $toleranceSeconds);
        if ($reason !== null) {
            throw new PayKHException(
                'invalid_signature',
                "Webhook signature verification failed: {$reason}",
                400
            );
        }

        $event = json_decode($rawBody, true);
        if (json_last_error() !== JSON_ERROR_NONE || !is_array($event)) {
            throw new PayKHException(
                'invalid_payload',
                'Webhook body is not valid JSON: ' . json_last_error_msg(),
                400
            );
        }

        return $event;
    }

    /**
     * Run the verification checks.
     *
     * @return string|null Null when valid, otherwise one of the REASON_* constants.
     */
    private static function check(
        string $rawBody,
        string $signatureHeader,
        string $secret,
        int $toleranceSeconds,
        ?int $nowSeconds = null
    ): ?string {
        $timestamp = null;
        $v1 = null;
        foreach (explode(',', $signatureHeader) as $part) {
            $part = trim($part);
            if ($part === '') {
                continue;
            }
            $kv = explode('=', $part, 2);
            if (count($kv) !== 2) {
                continue;
            }
            [$key, $value] = $kv;
            if ($key === 't') {
                $timestamp = $value;
            } elseif ($key === 'v1') {
                $v1 = $value;
            }
        }

        if ($timestamp === null || $v1 === null || $v1 === '' || !ctype_digit($timestamp)) {
            return self::REASON_MALFORMED;
        }

        $now = $nowSeconds ?? time();
        if (abs($now - (int) $timestamp) > $toleranceSeconds) {
            return self::REASON_TIMESTAMP;
        }

        $expected = hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
        if (!hash_equals($expected, $v1)) {
            return self::REASON_SIGNATURE;
        }

        return null;
    }
}
