import { HttpException } from '@nestjs/common';
import { ApiErrorCode, ERROR_HTTP_STATUS } from '@paykh/shared-types';

/**
 * Structured, machine-readable API error. Serialized by AllExceptionsFilter as:
 *   { "error": <code>, "message": <human>, "request_id": <req_xxx> }
 */
export class ApiError extends HttpException {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string, status?: number) {
    super({ error: code, message }, status ?? ERROR_HTTP_STATUS[code]);
    this.code = code;
  }

  static unauthorized(message = 'Missing or invalid credentials') {
    return new ApiError('unauthorized', message);
  }
  static forbidden(message = 'You do not have access to this resource') {
    return new ApiError('forbidden', message);
  }
  static invalidRequest(message: string) {
    return new ApiError('invalid_request', message);
  }
  static amountTooLow(message: string) {
    return new ApiError('amount_too_low', message);
  }
  static amountTooHigh(message: string) {
    return new ApiError('amount_too_high', message);
  }
  static paymentNotFound(message = 'Payment not found') {
    return new ApiError('payment_not_found', message);
  }
  static paymentExpired(message = 'Payment has expired') {
    return new ApiError('payment_expired', message);
  }
  static providerError(message = 'Payment provider error') {
    return new ApiError('payment_provider_error', message);
  }
  static quotaExceeded(message = 'Monthly quota exceeded') {
    return new ApiError('quota_exceeded', message);
  }
  static idempotencyConflict(message: string) {
    return new ApiError('idempotency_conflict', message);
  }
  static internal(message = 'Internal server error') {
    return new ApiError('internal_error', message);
  }
}
