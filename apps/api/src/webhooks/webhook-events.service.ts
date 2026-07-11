import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Payment, Prisma } from '@prisma/client';
import { ids } from '@paykh/security';
import { STATUS_TO_EVENT, WebhookEventType, PaymentStatus } from '@paykh/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  DeliverWebhookJob,
  JOB_DELIVER_WEBHOOK,
  QUEUE_WEBHOOK,
  WEBHOOK_BACKOFF_MS,
  WEBHOOK_MAX_ATTEMPTS,
} from '../queue/queue.constants';
import { buildWebhookPayload } from './webhook-payload';

/**
 * Fan-out of payment events to registered webhook endpoints. Called by the
 * payments service on create and on every status transition. Creates one
 * WebhookEvent and one PENDING WebhookDelivery per matching endpoint, then
 * enqueues a BullMQ job (the worker performs the signed HTTP delivery).
 */
@Injectable()
export class WebhookEventsService {
  private readonly logger = new Logger('WebhookEvents');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @InjectQueue(QUEUE_WEBHOOK) private readonly queue: Queue,
  ) {}

  /** Emit the event that corresponds to a payment reaching `status`. */
  async emitForStatus(payment: Payment, status: PaymentStatus): Promise<void> {
    const type = STATUS_TO_EVENT[status];
    if (!type) return;
    await this.emit(payment, type);
  }

  /** Emit payment.created. */
  async emitCreated(payment: Payment): Promise<void> {
    await this.emit(payment, 'payment.created');
  }

  /**
   * Emit payment.refunded. Called for partial refunds (where the payment status
   * stays `paid`, so emitForStatus wouldn't fire) and full refunds alike.
   */
  async emitRefunded(payment: Payment): Promise<void> {
    await this.emit(payment, 'payment.refunded');
  }

  private async emit(payment: Payment, type: WebhookEventType): Promise<void> {
    // Mirror the event to the Telegram channel (independent of webhook endpoints).
    await this.notifications.onPaymentEvent(payment, type);

    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { storeId: payment.storeId, disabled: false },
    });
    // An endpoint with an empty enabledEvents list subscribes to all events.
    const matching = endpoints.filter(
      (e) => e.enabledEvents.length === 0 || e.enabledEvents.includes(type),
    );
    if (matching.length === 0) return;

    const eventId = ids.event();
    const createdIso = new Date().toISOString();
    const payload = buildWebhookPayload(eventId, type, payment, createdIso);

    await this.prisma.webhookEvent.create({
      data: {
        id: eventId,
        storeId: payment.storeId,
        paymentId: payment.id,
        type,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });

    for (const endpoint of matching) {
      const deliveryId = ids.webhookDelivery();
      await this.prisma.webhookDelivery.create({
        data: { id: deliveryId, endpointId: endpoint.id, eventId, status: 'PENDING' },
      });
      await this.enqueue(deliveryId);
    }
    this.logger.log(`emitted ${type} for ${payment.id} to ${matching.length} endpoint(s)`);
  }

  /** Enqueue a delivery job with the standard retry policy. */
  async enqueue(deliveryId: string): Promise<void> {
    const job: DeliverWebhookJob = { deliveryId };
    await this.queue.add(JOB_DELIVER_WEBHOOK, job, {
      attempts: WEBHOOK_MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: WEBHOOK_BACKOFF_MS },
      removeOnComplete: 1000,
      removeOnFail: false,
    });
  }
}
