export const QUEUE_WEBHOOK = 'webhook-delivery';
export const QUEUE_MAINTENANCE = 'maintenance';

export const JOB_DELIVER_WEBHOOK = 'deliver';
export const JOB_EXPIRY_SWEEP = 'expiry-sweep';
export const JOB_STATUS_POLL = 'status-poll';
export const JOB_IDEMPOTENCY_CLEANUP = 'idempotency-cleanup';
export const JOB_BILLING_SWEEP = 'billing-sweep';

/** Webhook delivery retry policy. */
export const WEBHOOK_MAX_ATTEMPTS = 6;
/** Base backoff (ms); BullMQ applies exponential growth: 30s, 1m, 2m, 4m, 8m… */
export const WEBHOOK_BACKOFF_MS = 30_000;
/** Consecutive permanent failures after which an endpoint is auto-disabled. */
export const ENDPOINT_FAILURE_DISABLE_THRESHOLD = 20;

export interface DeliverWebhookJob {
  deliveryId: string;
}
