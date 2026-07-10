import { Logger } from '@nestjs/common';

/**
 * Optional Sentry error tracking. No-ops entirely when SENTRY_DSN is unset, and
 * loads @sentry/node lazily so environments without a DSN pay nothing.
 */
let sentry: typeof import('@sentry/node') | null = null;
const logger = new Logger('Sentry');

export function initSentry(dsn: string | undefined, environment: string, service: string): void {
  if (!dsn) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sentry = require('@sentry/node');
    sentry!.init({ dsn, environment, tracesSampleRate: 0.1, initialScope: { tags: { service } } });
    logger.log(`Sentry initialized for ${service} (${environment})`);
  } catch (err) {
    logger.warn(`Sentry init failed: ${err}`);
    sentry = null;
  }
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!sentry) return;
  try {
    sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    /* never throw from telemetry */
  }
}
