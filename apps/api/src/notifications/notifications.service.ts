import { Injectable, Logger } from '@nestjs/common';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';
import { Payment } from '@prisma/client';
import { WebhookEventType } from '@paykh/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { TelegramService } from './telegram.service';
import { formatAmount } from '../payments/amount.util';

export class UpdateTelegramDto {
  @IsOptional() @IsString() chatId?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) enabledEvents?: string[];
}

const EVENT_LABEL: Partial<Record<WebhookEventType, string>> = {
  'payment.completed': '✅ Payment received',
  'payment.refunded': '↩️ Payment refunded',
  'payment.failed': '❌ Payment failed',
  'payment.expired': '⌛ Payment expired',
  'payment.cancelled': '🚫 Payment cancelled',
  'payment.scanned': '📷 QR scanned',
  'payment.created': '🧾 Payment created',
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  private async assertStore(user: AuthUser, storeId: string, perm: 'store:read' | 'store:write') {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }

  async getConfig(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'store:read');
    const c = await this.prisma.telegramConfig.findUnique({ where: { storeId } });
    return {
      store_id: storeId,
      enabled: c?.enabled ?? false,
      chat_id: c?.chatId ?? null,
      enabled_events: c?.enabledEvents ?? [],
      bot_configured: this.telegram.configured,
    };
  }

  async updateConfig(user: AuthUser, storeId: string, dto: UpdateTelegramDto) {
    await this.assertStore(user, storeId, 'store:write');
    const c = await this.prisma.telegramConfig.upsert({
      where: { storeId },
      create: { storeId, chatId: dto.chatId ?? null, enabled: dto.enabled ?? false, enabledEvents: dto.enabledEvents ?? [] },
      update: { chatId: dto.chatId, enabled: dto.enabled, enabledEvents: dto.enabledEvents },
    });
    return { store_id: storeId, enabled: c.enabled, chat_id: c.chatId, enabled_events: c.enabledEvents, bot_configured: this.telegram.configured };
  }

  async sendTest(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'store:write');
    const c = await this.prisma.telegramConfig.findUnique({ where: { storeId } });
    if (!c?.chatId) throw ApiError.invalidRequest('Set a Telegram chat id first');
    const ok = await this.telegram.send(c.chatId, '🔔 <b>PayKH test notification</b>\nYour Telegram alerts are connected.');
    return { sent: ok };
  }

  /**
   * Called from the webhook event fan-out so Telegram mirrors the same payment
   * events. Best-effort; never throws into the payment flow.
   */
  async onPaymentEvent(payment: Payment, type: WebhookEventType): Promise<void> {
    try {
      const c = await this.prisma.telegramConfig.findUnique({ where: { storeId: payment.storeId } });
      if (!c?.enabled || !c.chatId) return;
      if (c.enabledEvents.length > 0 && !c.enabledEvents.includes(type)) return;

      const label = EVENT_LABEL[type] ?? type;
      const amount = formatAmount(payment.amount, payment.currency);
      const ref = payment.referenceId ? `\nRef: <code>${payment.referenceId}</code>` : '';
      const text = `${label}\n${amount} ${payment.currency}${ref}\nPayment: <code>${payment.id}</code>`;
      await this.telegram.send(c.chatId, text);
    } catch (err) {
      this.logger.warn(`telegram notify failed for ${payment.id}: ${err}`);
    }
  }
}
