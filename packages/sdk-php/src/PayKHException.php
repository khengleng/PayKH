<?php

declare(strict_types=1);

namespace PayKH;

/**
 * Exception thrown for PayKH API errors and webhook signature failures.
 *
 * Mirrors the structured error envelope returned by the API:
 * `{ "error": "...", "message": "...", "request_id": "..." }`.
 */
class PayKHException extends \Exception
{
    /** Machine-readable error code (the API `error` field), e.g. `payment_not_found`. */
    private string $errorCode;

    /** HTTP status code of the response (0 for transport/local errors). */
    private int $httpStatus;

    /** The `request_id` echoed by the API, if any. */
    private ?string $requestId;

    public function __construct(
        string $errorCode,
        string $message,
        int $httpStatus = 0,
        ?string $requestId = null,
        ?\Throwable $previous = null
    ) {
        parent::__construct($message, 0, $previous);
        $this->errorCode = $errorCode;
        $this->httpStatus = $httpStatus;
        $this->requestId = $requestId;
    }

    /** Machine-readable error code (API `error` field). */
    public function getErrorCode(): string
    {
        return $this->errorCode;
    }

    /** HTTP status code (0 when the failure occurred before/without a response). */
    public function getHttpStatus(): int
    {
        return $this->httpStatus;
    }

    /** The API `request_id`, when present. */
    public function getRequestId(): ?string
    {
        return $this->requestId;
    }
}
