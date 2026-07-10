<?php

declare(strict_types=1);

namespace PayKH\Tests;

use PayKH\PayKHException;
use PayKH\Webhook;
use PHPUnit\Framework\TestCase;

final class WebhookTest extends TestCase
{
    private const SECRET = 'whsec_test_secret';

    private string $body = '{"id":"evt_123","type":"payment.completed","data":{"payment":{"id":"pay_1"}}}';

    /**
     * Build a valid `X-Payment-Signature` header for the given body/secret/timestamp.
     */
    private function sign(string $body, string $secret, ?int $ts = null): string
    {
        $ts ??= time();
        $v1 = hash_hmac('sha256', $ts . '.' . $body, $secret);

        return "t={$ts},v1={$v1}";
    }

    public function testValidSignaturePasses(): void
    {
        $header = $this->sign($this->body, self::SECRET);
        $this->assertTrue(Webhook::verify($this->body, $header, self::SECRET));
    }

    public function testTamperedBodyFails(): void
    {
        $header = $this->sign($this->body, self::SECRET);
        $tampered = str_replace('pay_1', 'pay_evil', $this->body);
        $this->assertFalse(Webhook::verify($tampered, $header, self::SECRET));
    }

    public function testWrongSecretFails(): void
    {
        $header = $this->sign($this->body, self::SECRET);
        $this->assertFalse(Webhook::verify($this->body, $header, 'whsec_wrong_secret'));
    }

    public function testOutOfToleranceTimestampFails(): void
    {
        // Signed 10 minutes ago; default tolerance is 5 minutes.
        $header = $this->sign($this->body, self::SECRET, time() - 600);
        $this->assertFalse(Webhook::verify($this->body, $header, self::SECRET));
    }

    public function testWithinToleranceOldTimestampPasses(): void
    {
        // Signed 4 minutes ago; still within the 5-minute default tolerance.
        $header = $this->sign($this->body, self::SECRET, time() - 240);
        $this->assertTrue(Webhook::verify($this->body, $header, self::SECRET));
    }

    /**
     * @dataProvider malformedHeaderProvider
     */
    public function testMalformedHeaderFails(string $header): void
    {
        $this->assertFalse(Webhook::verify($this->body, $header, self::SECRET));
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function malformedHeaderProvider(): array
    {
        $ts = time();
        $v1 = hash_hmac('sha256', $ts . '.x', 'whsec_test_secret');

        return [
            'empty string' => [''],
            'missing v1' => ["t={$ts}"],
            'missing t' => ["v1={$v1}"],
            'non-numeric t' => ["t=notanumber,v1={$v1}"],
            'garbage' => ['this is not a signature'],
            'empty v1' => ["t={$ts},v1="],
        ];
    }

    public function testConstructEventReturnsParsedPayload(): void
    {
        $header = $this->sign($this->body, self::SECRET);
        $event = Webhook::constructEvent($this->body, $header, self::SECRET);

        $this->assertSame('evt_123', $event['id']);
        $this->assertSame('payment.completed', $event['type']);
        $this->assertSame('pay_1', $event['data']['payment']['id']);
    }

    public function testConstructEventThrowsOnInvalidSignature(): void
    {
        $header = $this->sign($this->body, 'whsec_wrong_secret');

        $this->expectException(PayKHException::class);
        $this->expectExceptionMessageMatches('/signature_mismatch/');
        Webhook::constructEvent($this->body, $header, self::SECRET);
    }

    public function testConstructEventThrowsHasCodeAndStatus(): void
    {
        $header = 'malformed';
        try {
            Webhook::constructEvent($this->body, $header, self::SECRET);
            $this->fail('Expected PayKHException');
        } catch (PayKHException $e) {
            $this->assertSame('invalid_signature', $e->getErrorCode());
            $this->assertSame(400, $e->getHttpStatus());
        }
    }

    public function testCustomToleranceIsRespected(): void
    {
        $header = $this->sign($this->body, self::SECRET, time() - 600);
        // 10 minutes old but with a 1-hour tolerance -> valid.
        $this->assertTrue(Webhook::verify($this->body, $header, self::SECRET, 3600));
    }
}
