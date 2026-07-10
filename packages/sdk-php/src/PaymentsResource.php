<?php

declare(strict_types=1);

namespace PayKH;

/**
 * Payments API resource (`/v1/payments`).
 *
 * Each method returns the decoded JSON response as an associative array.
 */
class PaymentsResource
{
    private Client $client;

    public function __construct(Client $client)
    {
        $this->client = $client;
    }

    /**
     * Create a payment.
     *
     * @param array<string, mixed> $params         e.g. `['amount' => '1.50', 'currency' => 'USD']`.
     * @param string|null          $idempotencyKey Optional `Idempotency-Key` header value.
     *
     * @return array<string, mixed> The created payment.
     *
     * @throws PayKHException
     */
    public function create(array $params, ?string $idempotencyKey = null): array
    {
        return $this->client->request('POST', '/v1/payments', $params, $idempotencyKey) ?? [];
    }

    /**
     * Retrieve a payment by id.
     *
     * @return array<string, mixed>
     *
     * @throws PayKHException
     */
    public function retrieve(string $id): array
    {
        return $this->client->request('GET', '/v1/payments/' . rawurlencode($id)) ?? [];
    }

    /**
     * List payments.
     *
     * @param array<string, mixed> $params Optional filters: status, reference_id,
     *                                      created_from, created_to, limit, cursor.
     *
     * @return array<string, mixed> Paginated list envelope.
     *
     * @throws PayKHException
     */
    public function list(array $params = []): array
    {
        return $this->client->request('GET', '/v1/payments' . self::toQuery($params)) ?? [];
    }

    /**
     * Cancel a payment.
     *
     * @return array<string, mixed>
     *
     * @throws PayKHException
     */
    public function cancel(string $id): array
    {
        return $this->client->request('POST', '/v1/payments/' . rawurlencode($id) . '/cancel') ?? [];
    }

    /**
     * Build a query string from params, skipping null values.
     *
     * @param array<string, mixed> $params
     */
    private static function toQuery(array $params): string
    {
        $pairs = [];
        foreach ($params as $key => $value) {
            if ($value === null) {
                continue;
            }
            if (is_bool($value)) {
                $value = $value ? 'true' : 'false';
            }
            $pairs[$key] = (string) $value;
        }
        if ($pairs === []) {
            return '';
        }

        return '?' . http_build_query($pairs, '', '&', PHP_QUERY_RFC3986);
    }
}
