import { Injectable } from '@nestjs/common';
import { WebhookEndpoint, WebhookDelivery, Prisma } from '@prisma/client';
import { generateWebhookSecret, ids } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { WebhookEventsService } from './webhook-events.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: WebhookEventsService,
  ) {}

  private async storeOrgId(storeId: string): Promise<string> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    return store.organizationId;
  }

  private async loadEndpointForUser(user: AuthUser, endpointId: string) {
    const endpoint = await this.prisma.webhookEndpoint.findUnique({
      where: { id: endpointId },
    });
    if (!endpoint) throw ApiError.paymentNotFound('Webhook endpoint not found');
    const orgId = await this.storeOrgId(endpoint.storeId);
    requirePermission(user, orgId, 'webhook:write');
    return endpoint;
  }

  async create(user: AuthUser, dto: CreateWebhookDto) {
    const orgId = await this.storeOrgId(dto.storeId);
    requirePermission(user, orgId, 'webhook:write');

    const endpoint = await this.prisma.webhookEndpoint.create({
      data: {
        storeId: dto.storeId,
        url: dto.url,
        enabledEvents: dto.enabledEvents ?? [],
        secrets: { create: { secret: generateWebhookSecret(), active: true } },
      },
      include: { secrets: true },
    });
    const secret = endpoint.secrets[0]?.secret;
    return { ...this.serialize(endpoint), signing_secret: secret };
  }

  async list(user: AuthUser, storeId: string) {
    const orgId = await this.storeOrgId(storeId);
    requirePermission(user, orgId, 'webhook:write');
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
    });
    return endpoints.map((e) => this.serialize(e));
  }

  async update(user: AuthUser, endpointId: string, dto: UpdateWebhookDto) {
    await this.loadEndpointForUser(user, endpointId);
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: {
        url: dto.url,
        enabledEvents: dto.enabledEvents,
        disabled: dto.disabled,
      },
    });
    return this.serialize(updated);
  }

  async remove(user: AuthUser, endpointId: string) {
    await this.loadEndpointForUser(user, endpointId);
    await this.prisma.webhookEndpoint.delete({ where: { id: endpointId } });
    return { id: endpointId, deleted: true };
  }

  /** Reveal the active signing secret (needs webhook:write). */
  async revealSecret(user: AuthUser, endpointId: string) {
    await this.loadEndpointForUser(user, endpointId);
    const secret = await this.prisma.webhookSecret.findFirst({
      where: { endpointId, active: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!secret) throw ApiError.paymentNotFound('No active signing secret');
    return { endpoint_id: endpointId, signing_secret: secret.secret };
  }

  /**
   * Rotate the signing secret. The old secret stays valid for a grace period so
   * in-flight deliveries and slow consumers do not break.
   */
  async rotateSecret(user: AuthUser, endpointId: string) {
    await this.loadEndpointForUser(user, endpointId);
    const graceUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const newSecret = generateWebhookSecret();
    await this.prisma.$transaction([
      this.prisma.webhookSecret.updateMany({
        where: { endpointId, active: true },
        data: { active: false, expiresAt: graceUntil },
      }),
      this.prisma.webhookSecret.create({
        data: { endpointId, secret: newSecret, active: true },
      }),
    ]);
    return { endpoint_id: endpointId, signing_secret: newSecret, previous_secret_valid_until: graceUntil.toISOString() };
  }

  async deliveries(user: AuthUser, endpointId: string, limit = 50) {
    await this.loadEndpointForUser(user, endpointId);
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { endpointId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: { event: true },
    });
    return rows.map((d) => this.serializeDelivery(d));
  }

  /** Re-enqueue a delivery for immediate retry (also re-enables the endpoint). */
  async resend(user: AuthUser, deliveryId: string) {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    });
    if (!delivery) throw ApiError.paymentNotFound('Delivery not found');
    const orgId = await this.storeOrgId(delivery.endpoint.storeId);
    requirePermission(user, orgId, 'webhook:write');

    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'PENDING', error: null, nextAttemptAt: null },
    });
    await this.events.enqueue(deliveryId);
    return { id: deliveryId, resent: true };
  }

  /** Send a synthetic test event to an endpoint. */
  async sendTest(user: AuthUser, endpointId: string) {
    const endpoint = await this.loadEndpointForUser(user, endpointId);
    const eventId = ids.event();
    const payload = {
      id: eventId,
      type: 'payment.completed',
      created: new Date().toISOString(),
      data: {
        payment: {
          id: 'pay_test_00000000',
          status: 'paid',
          amount: '1.00',
          currency: 'USD',
          reference_id: 'test_reference',
          metadata: { test: true },
          approved_at: new Date().toISOString(),
        },
      },
    };
    await this.prisma.webhookEvent.create({
      data: {
        id: eventId,
        storeId: endpoint.storeId,
        type: 'payment.completed',
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
    const deliveryId = ids.webhookDelivery();
    await this.prisma.webhookDelivery.create({
      data: { id: deliveryId, endpointId, eventId, status: 'PENDING' },
    });
    await this.events.enqueue(deliveryId);
    return { endpoint_id: endpointId, event_id: eventId, delivery_id: deliveryId, sent: true };
  }

  private serialize(e: WebhookEndpoint) {
    return {
      id: e.id,
      store_id: e.storeId,
      url: e.url,
      enabled_events: e.enabledEvents,
      disabled: e.disabled,
      created_at: e.createdAt.toISOString(),
    };
  }

  private serializeDelivery(d: WebhookDelivery & { event?: { type: string } | null }) {
    return {
      id: d.id,
      event_id: d.eventId,
      event_type: d.event?.type ?? null,
      status: d.status.toLowerCase(),
      attempt: d.attempt,
      response_status: d.responseStatus,
      error: d.error,
      next_attempt_at: d.nextAttemptAt?.toISOString() ?? null,
      created_at: d.createdAt.toISOString(),
      updated_at: d.updatedAt.toISOString(),
    };
  }
}
