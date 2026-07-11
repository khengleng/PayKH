import { Injectable, Logger } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { NotificationChannelType, Payment } from '@prisma/client';
import { WebhookEventType } from '@paykh/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { TelegramService } from './telegram.service';
import { MessagingService } from './messaging.service';
import { formatAmount } from '../payments/amount.util';

export class UpdateTelegramDto {
  @IsOptional() @IsString() chatId?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) enabledEvents?: string[];
}

const CHANNELS: NotificationChannelType[] = ['WHATSAPP', 'SMS', 'SIGNAL'];

export class UpdateChannelDto {
  @IsIn(CHANNELS) channel!: NotificationChannelType;
  @IsOptional() @IsString() destination?: string;
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
    private readonly messaging: MessagingService,
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

  // ----------------------------------------------------- messaging channels
  async listChannels(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'store:read');
    const rows = await this.prisma.notificationChannel.findMany({ where: { storeId } });
    const byChannel = new Map(rows.map((r) => [r.channel, r]));
    return CHANNELS.map((channel) => {
      const c = byChannel.get(channel);
      return {
        channel: channel.toLowerCase(),
        enabled: c?.enabled ?? false,
        destination: c?.destination ?? null,
        enabled_events: c?.enabledEvents ?? [],
        provider_configured: this.messaging.configured(channel),
      };
    });
  }

  async updateChannel(user: AuthUser, storeId: string, dto: UpdateChannelDto) {
    await this.assertStore(user, storeId, 'store:write');
    const c = await this.prisma.notificationChannel.upsert({
      where: { storeId_channel: { storeId, channel: dto.channel } },
      create: { storeId, channel: dto.channel, destination: dto.destination ?? null, enabled: dto.enabled ?? false, enabledEvents: dto.enabledEvents ?? [] },
      update: { destination: dto.destination, enabled: dto.enabled, enabledEvents: dto.enabledEvents },
    });
    return { channel: c.channel.toLowerCase(), enabled: c.enabled, destination: c.destination, enabled_events: c.enabledEvents, provider_configured: this.messaging.configured(c.channel) };
  }

  async sendTestChannel(user: AuthUser, storeId: string, channel: NotificationChannelType) {
    await this.assertStore(user, storeId, 'store:write');
    const c = await this.prisma.notificationChannel.findUnique({ where: { storeId_channel: { storeId, channel } } });
    if (!c?.destination) throw ApiError.invalidRequest(`Set a ${channel.toLowerCase()} destination first`);
    const ok = await this.messaging.send(channel, c.destination, 'PayKH test notification — your alerts are connected.');
    return { sent: ok };
  }

  /**
   * Called from the webhook event fan-out so all configured channels (Telegram
   * + WhatsApp/SMS/Signal) mirror the same payment events. Best-effort; never
   * throws into the payment flow.
   */
  async onPaymentEvent(payment: Payment, type: WebhookEventType): Promise<void> {
    await this.notifyTelegram(payment, type);
    await this.notifyChannels(payment, type);
  }

  private async notifyTelegram(payment: Payment, type: WebhookEventType): Promise<void> {
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

  private async notifyChannels(payment: Payment, type: WebhookEventType): Promise<void> {
    try {
      const channels = await this.prisma.notificationChannel.findMany({ where: { storeId: payment.storeId, enabled: true } });
      if (channels.length === 0) return;

      const label = (EVENT_LABEL[type] ?? type).replace(/<[^>]+>/g, ''); // strip any markup
      const amount = formatAmount(payment.amount, payment.currency);
      const ref = payment.referenceId ? ` Ref: ${payment.referenceId}` : '';
      const text = `${label} — ${amount} ${payment.currency}${ref} (${payment.id})`;

      for (const c of channels) {
        if (!c.destination) continue;
        if (c.enabledEvents.length > 0 && !c.enabledEvents.includes(type)) continue;
        await this.messaging.send(c.channel, c.destination, text);
      }
    } catch (err) {
      this.logger.warn(`channel notify failed for ${payment.id}: ${err}`);
    }
  }
}
