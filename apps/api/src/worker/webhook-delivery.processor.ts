import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { buildSignatureHeaderMulti } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { endpointDisabledEmail } from '../email/templates';
import { assertSafeUrl } from '../common/ssrf';
import {
  DeliverWebhookJob,
  ENDPOINT_FAILURE_DISABLE_THRESHOLD,
  JOB_DELIVER_WEBHOOK,
  QUEUE_WEBHOOK,
  WEBHOOK_BACKOFF_MS,
  WEBHOOK_MAX_ATTEMPTS,
} from '../queue/queue.constants';

const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Performs the signed HTTP delivery of a webhook event. Retries are driven by
 * BullMQ (exponential backoff, WEBHOOK_MAX_ATTEMPTS). On permanent failure the
 * delivery is marked FAILED; an endpoint with too many consecutive permanent
 * failures is auto-disabled and the merchant is notified (audit + security
 * event).
 */
@Processor(QUEUE_WEBHOOK)
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger('WebhookDelivery');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {
    super();
  }

  async process(job: Job<DeliverWebhookJob>): Promise<void> {
    if (job.name !== JOB_DELIVER_WEBHOOK) return;
    const { deliveryId } = job.data;

    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true, event: true },
    });
    if (!delivery) {
      this.logger.warn(`delivery ${deliveryId} not found; dropping job`);
      return;
    }
    if (delivery.status === 'SUCCEEDED') return; // already delivered (e.g. resend race)

    const endpoint = delivery.endpoint;
    if (endpoint.disabled) {
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: { status: 'FAILED', error: 'endpoint disabled' },
      });
      return; // don't retry
    }

    // Sign with EVERY currently-valid secret: the active one plus any rotated-out
    // secret still within its grace window (expiresAt > now). During a rotation
    // this dual-signs so a consumer that has updated to either secret verifies.
    const now = new Date();
    const validSecrets = await this.prisma.webhookSecret.findMany({
      where: {
        endpointId: endpoint.id,
        OR: [{ active: true }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (validSecrets.length === 0) {
      await this.markPermanentFailure(deliveryId, endpoint.id, job, null, 'no active signing secret');
      return;
    }

    // SSRF guard: never deliver to internal/metadata targets in production.
    const allowPrivate = process.env.NODE_ENV !== 'production';
    const safe = await assertSafeUrl(endpoint.url, allowPrivate);
    if (!safe.ok) {
      await this.markPermanentFailure(deliveryId, endpoint.id, job, null, `blocked target: ${safe.reason}`);
      return;
    }

    const attempt = job.attemptsMade + 1;
    const rawBody = JSON.stringify(delivery.event.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = buildSignatureHeaderMulti(
      validSecrets.map((s) => s.secret),
      rawBody,
      timestamp,
    );

    let responseStatus: number | null = null;
    let errorText: string | null = null;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
      try {
        const res = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'PayKH-Webhooks/1.0',
            'X-Payment-Event': delivery.event.type,
            'X-Payment-Id': delivery.eventId,
            'X-Payment-Signature': signature,
          },
          body: rawBody,
          signal: controller.signal,
          // Block redirects so a public URL can't 302 into an internal target
          // (defeats DNS-rebinding / redirect-based SSRF).
          redirect: 'error',
        });
        responseStatus = res.status;
        if (!res.ok) {
          errorText = `HTTP ${res.status}`;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      errorText = err instanceof Error ? err.message : String(err);
    }

    if (responseStatus && responseStatus >= 200 && responseStatus < 300) {
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: { status: 'SUCCEEDED', attempt, responseStatus, error: null, nextAttemptAt: null },
      });
      this.logger.log(`delivered ${deliveryId} -> ${endpoint.url} (${responseStatus}) attempt=${attempt}`);
      return;
    }

    // Failed this attempt.
    const isFinal = attempt >= WEBHOOK_MAX_ATTEMPTS;
    if (isFinal) {
      await this.markPermanentFailure(deliveryId, endpoint.id, job, responseStatus, errorText);
      return;
    }

    const nextAttemptAt = new Date(Date.now() + WEBHOOK_BACKOFF_MS * Math.pow(2, job.attemptsMade));
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'PENDING', attempt, responseStatus, error: errorText, nextAttemptAt },
    });
    this.logger.warn(`delivery ${deliveryId} failed attempt=${attempt} (${errorText}); retrying`);
    // Throw so BullMQ schedules the next attempt with backoff.
    throw new Error(`webhook delivery failed: ${errorText}`);
  }

  private async markPermanentFailure(
    deliveryId: string,
    endpointId: string,
    job: Job,
    responseStatus: number | null,
    errorText: string | null,
  ): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'FAILED',
        attempt: job.attemptsMade + 1,
        responseStatus,
        error: errorText,
        nextAttemptAt: null,
      },
    });
    this.logger.error(`delivery ${deliveryId} permanently failed (${errorText})`);
    await this.maybeDisableEndpoint(endpointId);
  }

  /** Disable an endpoint after N consecutive permanent failures + notify. */
  private async maybeDisableEndpoint(endpointId: string): Promise<void> {
    // Count FAILED deliveries in an unbroken run from the newest — stopping at
    // the first SUCCEEDED. This measures "N failures with no success since",
    // not merely "the last N rows are all FAILED" (which could disable an
    // endpoint on a single fresh failure sitting behind a stale failure burst).
    // PENDING rows (in-flight retries) are skipped, not counted as failures.
    const recent = await this.prisma.webhookDelivery.findMany({
      where: { endpointId },
      orderBy: { createdAt: 'desc' },
      take: ENDPOINT_FAILURE_DISABLE_THRESHOLD * 3,
      select: { status: true },
    });
    let consecutiveFailures = 0;
    for (const d of recent) {
      if (d.status === 'SUCCEEDED') break;
      if (d.status === 'FAILED') consecutiveFailures++;
    }
    if (consecutiveFailures >= ENDPOINT_FAILURE_DISABLE_THRESHOLD) {
      const endpoint = await this.prisma.webhookEndpoint.findUnique({ where: { id: endpointId } });
      if (!endpoint || endpoint.disabled) return;
      await this.prisma.webhookEndpoint.update({
        where: { id: endpointId },
        data: { disabled: true },
      });
      await this.prisma.securityEvent.create({
        data: {
          type: 'webhook.endpoint.auto_disabled',
          storeId: endpoint.storeId,
          detail: {
            endpointId,
            url: endpoint.url,
            reason: `>=${ENDPOINT_FAILURE_DISABLE_THRESHOLD} consecutive permanent failures`,
          },
        },
      });
      await this.audit.record({
        storeId: endpoint.storeId,
        action: 'webhook.endpoint.auto_disabled',
        entity: `webhook:${endpointId}`,
        afterValue: { disabled: true, url: endpoint.url },
      });
      // Notify the org owners by email (best-effort).
      const owners = await this.prisma.organizationMember.findMany({
        where: { organization: { stores: { some: { id: endpoint.storeId } } }, role: 'OWNER' },
        include: { user: true },
      });
      for (const owner of owners) {
        await this.email.send(endpointDisabledEmail(owner.user.email, endpoint.url));
      }
      this.logger.error(`endpoint ${endpointId} auto-disabled after repeated failures`);
    }
  }
}
