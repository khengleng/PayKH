import { Injectable, Logger } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUrl } from 'class-validator';
import { ConnectorType, Payment } from '@prisma/client';
import { WebhookEventType } from '@paykh/shared-types';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { formatAmount } from '../payments/amount.util';

const TYPES: ConnectorType[] = ['SLACK', 'ZAPIER', 'WEBHOOK'];

/** Static marketplace catalog of available integrations. */
export const MARKETPLACE = [
  { type: 'SLACK', name: 'Slack', category: 'notifications', description: 'Post payment events to a Slack channel via an Incoming Webhook.', setup: 'Paste your Slack Incoming Webhook URL.' },
  { type: 'ZAPIER', name: 'Zapier', category: 'automation', description: 'Trigger Zaps on payment events via a Catch Hook.', setup: 'Paste your Zapier Catch Hook URL.' },
  { type: 'WEBHOOK', name: 'Custom Webhook', category: 'developer', description: 'POST the raw event JSON to any endpoint (fire-and-forget).', setup: 'Paste your endpoint URL.' },
  { type: 'TELEGRAM', name: 'Telegram', category: 'notifications', description: 'Payment alerts in Telegram.', setup: 'Configure under Stores → Telegram.', builtin: true },
];

export class ConnectorDto {
  @IsIn(TYPES) type!: ConnectorType;
  @IsUrl({ require_tld: false }) targetUrl!: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) enabledEvents?: string[];
}

@Injectable()
export class ConnectorsService {
  private readonly logger = new Logger('Connectors');

  constructor(private readonly prisma: PrismaService) {}

  private async assertStore(user: AuthUser, storeId: string, perm: 'payment:read' | 'store:write') {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }

  marketplace() {
    return { apps: MARKETPLACE };
  }

  async list(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const rows = await this.prisma.connector.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' } });
    return rows.map((c) => this.serialize(c));
  }

  async install(user: AuthUser, storeId: string, dto: ConnectorDto) {
    await this.assertStore(user, storeId, 'store:write');
    const c = await this.prisma.connector.create({
      data: { id: prefixedId('conn'), storeId, type: dto.type, targetUrl: dto.targetUrl, enabled: dto.enabled ?? true, enabledEvents: dto.enabledEvents ?? [] },
    });
    return this.serialize(c);
  }

  async update(user: AuthUser, connectorId: string, dto: Partial<ConnectorDto>) {
    const c = await this.prisma.connector.findUnique({ where: { id: connectorId } });
    if (!c) throw ApiError.paymentNotFound('Connector not found');
    await this.assertStore(user, c.storeId, 'store:write');
    const updated = await this.prisma.connector.update({ where: { id: connectorId }, data: { targetUrl: dto.targetUrl, enabled: dto.enabled, enabledEvents: dto.enabledEvents } });
    return this.serialize(updated);
  }

  async remove(user: AuthUser, connectorId: string) {
    const c = await this.prisma.connector.findUnique({ where: { id: connectorId } });
    if (!c) throw ApiError.paymentNotFound('Connector not found');
    await this.assertStore(user, c.storeId, 'store:write');
    await this.prisma.connector.delete({ where: { id: connectorId } });
    return { deleted: true };
  }

  async test(user: AuthUser, connectorId: string) {
    const c = await this.prisma.connector.findUnique({ where: { id: connectorId } });
    if (!c) throw ApiError.paymentNotFound('Connector not found');
    await this.assertStore(user, c.storeId, 'store:write');
    const ok = await this.post(c.type, c.targetUrl, { event: 'test', message: 'PayKH connector test' });
    return { sent: ok };
  }

  /**
   * Fire enabled connectors for a payment event. Called from the event fan-out.
   * Best-effort, fire-and-forget (unlike signed developer webhooks).
   */
  async dispatch(payment: Payment, type: WebhookEventType): Promise<void> {
    try {
      const connectors = await this.prisma.connector.findMany({ where: { storeId: payment.storeId, enabled: true } });
      for (const c of connectors) {
        if (c.enabledEvents.length > 0 && !c.enabledEvents.includes(type)) continue;
        const amount = formatAmount(payment.amount, payment.currency);
        const payload = {
          event: type,
          payment: { id: payment.id, amount: payment.amount.toFixed(2), currency: payment.currency, reference_id: payment.referenceId, status: payment.status.toLowerCase() },
          summary: `${type} — ${amount} ${payment.currency} (${payment.id})`,
        };
        await this.post(c.type, c.targetUrl, payload);
      }
    } catch (err) {
      this.logger.warn(`connector dispatch failed for ${payment.id}: ${err}`);
    }
  }

  private async post(type: ConnectorType, url: string, payload: { event: string; message?: string; summary?: string; payment?: unknown }): Promise<boolean> {
    // Slack expects { text }; others receive the raw payload.
    const body = type === 'SLACK' ? { text: payload.summary ?? payload.message ?? payload.event } : payload;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
      if (!res.ok) { this.logger.warn(`connector ${type} POST ${res.status}`); return false; }
      return true;
    } catch (err) {
      this.logger.warn(`connector ${type} POST failed: ${err}`);
      return false;
    }
  }

  private serialize(c: { id: string; type: ConnectorType; targetUrl: string; enabled: boolean; enabledEvents: string[]; createdAt: Date }) {
    // Mask the URL — it can contain a secret token.
    const masked = c.targetUrl.replace(/(https?:\/\/[^/]+\/).*/, '$1…');
    return { id: c.id, type: c.type.toLowerCase(), target_url_masked: masked, enabled: c.enabled, enabled_events: c.enabledEvents, created_at: c.createdAt.toISOString() };
  }
}
