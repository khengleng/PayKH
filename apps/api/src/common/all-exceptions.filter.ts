import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiErrorBody, ApiErrorCode } from '@paykh/shared-types';
import { getRequestId } from './request-context';
import { captureException } from '../observability/sentry';
import { emitAlert } from '../observability/alert-sink';

/**
 * Converts every thrown error into the platform's structured error envelope:
 *   { error, message, request_id }
 * Never leaks stack traces or internal details to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = getRequestId(req);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ApiErrorCode = 'internal_error';
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'object' && response !== null && 'error' in response) {
        // ApiError shape
        const body = response as { error: ApiErrorCode; message: string };
        code = body.error;
        message = body.message;
      } else if (typeof response === 'object' && response !== null && 'message' in response) {
        // NestJS validation / built-in errors
        const body = response as { message: string | string[] };
        message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
        code = mapStatusToCode(status);
      } else {
        message = typeof response === 'string' ? response : exception.message;
        code = mapStatusToCode(status);
      }
    }

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} -> ${status} [${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      captureException(exception, { requestId, method: req.method, url: req.url });
      emitAlert({
        title: `API ${status} on ${req.method} ${req.url}`,
        detail: exception instanceof Error ? exception.message : String(exception),
        context: { requestId, method: req.method, url: req.url },
      });
    } else {
      this.logger.warn(`${req.method} ${req.url} -> ${status} ${code} [${requestId}]`);
    }

    const payload: ApiErrorBody = { error: code, message, request_id: requestId };
    res.status(status).json(payload);
  }
}

function mapStatusToCode(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return 'invalid_request';
    case 401:
      return 'unauthorized';
    case 402:
      return 'quota_exceeded';
    case 403:
      return 'forbidden';
    case 404:
      return 'payment_not_found';
    case 409:
      return 'idempotency_conflict';
    case 429:
      return 'rate_limit_exceeded';
    default:
      return 'internal_error';
  }
}
