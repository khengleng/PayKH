import { Body, Controller, Get, Headers, Injectable, Logger, Module, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { IsString, MaxLength } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { prefixedId, randomBase58 } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { Permission, requirePermission } from '../auth/rbac';
import { SettingsService } from '../settings/settings.module';
import { PaymentsService } from '../payments/payments.service';
import { parseBankAlert } from './bank-alert-parser';

/** How recent a pending payment must be to match an alert. Bank alerts arrive
 *  within seconds; a wide window invites false matches to unrelated charges. */
const MATCH_WINDOW_MS = 30 * 60 * 1000;

interface TgUpdate {
  update_id?: number;
  message?: { chat?: { id?: number | string }; text?: string; date?: number };
  channel_post?: { chat?: { id?: number | string }; text?: string; date?: number };
}

/**
 * Detect incoming bank payments from a merchant's Telegram alerts.
 *
 * Assist mode: a matched alert is recorded and surfaced so the cashier can
 * confirm with one tap — it NEVER marks a payment paid on its own. A Telegram
 * message is spoofable, so the only trust boundary is the chat: detection acts
 * exclusively on messages from a chat the merchant proved they control (by
 * posting a one-time code), and the webhook itself is authenticated by a secret
 * Telegram echoes back.
 */
@Injectable()
export class TelegramDetectionService {
  private readonly logger = new Logger('TelegramDetection');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly payments: PaymentsService,
    private readonly config: ConfigService,
  ) {}

  private async assertStore(user: AuthUser, storeId: string, perm: Permission) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }

  /** Status + a fresh verify code the merchant posts into their alert chat. */
  async status(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'store:read');
    const src = await this.prisma.telegramPaymentSource.findUnique({ where: { storeId } });
    const botConfigured = !!(await this.settings.resolve('telegram_bot_token'));
    return {
      bot_configured: botConfigured,
      verified: !!src?.verifiedAt,
      chat_id: src?.chatId ?? null,
      verify_code: src?.verifiedAt ? null : src?.verifyCode ?? null,
    };
  }

  /** Begin (or restart) verification: mint a code to post in the chat. */
  async beginVerify(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'store:write');
    // Distinctive so it cannot be confused with a payment amount in the chat.
    const code = `PAYKH-${randomBase58(6).toUpperCase()}`;
    await this.prisma.telegramPaymentSource.upsert({
      where: { storeId },
      create: { id: prefixedId('tgs'), storeId, verifyCode: code },
      update: { verifyCode: code, chatId: null, verifiedAt: null },
    });
    return { verify_code: code };
  }

  async unlink(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'store:write');
    await this.prisma.telegramPaymentSource.deleteMany({ where: { storeId } });
    return { verified: false };
  }

  /** Recent detections for a store (POS polls this to offer one-tap confirm). */
  async recent(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const rows = await this.prisma.paymentDetection.findMany({
      where: { storeId }, orderBy: { createdAt: 'desc' }, take: 20,
    });
    return rows.map((d) => ({
      id: d.id, payment_id: d.paymentId, amount: d.amount?.toString() ?? null,
      currency: d.currency, match_count: d.matchCount, confirmed: d.confirmed,
      at: d.createdAt.toISOString(), text: d.rawText.slice(0, 140),
    }));
  }

  /**
   * Ingest one Telegram update. Called only after the webhook secret is
   * verified. Everything here is untrusted input, so it fails closed: unknown
   * chats, duplicates, and unparseable messages are dropped silently.
   */
  async ingest(update: TgUpdate): Promise<void> {
    const msg = update.message ?? update.channel_post;
    const chatId = msg?.chat?.id;
    const text = msg?.text;
    if (chatId === undefined || chatId === null || !text) return;
    const chat = String(chatId);

    // Verification: a chat posting the store's one-time code binds itself.
    const trimmed = text.trim();
    if (/^PAYKH-[A-Z0-9]+$/.test(trimmed)) {
      const pending = await this.prisma.telegramPaymentSource.findFirst({ where: { verifyCode: trimmed, verifiedAt: null } });
      if (pending) {
        await this.prisma.telegramPaymentSource.update({
          where: { id: pending.id },
          data: { chatId: chat, verifiedAt: new Date(), verifyCode: null },
        });
        this.logger.log(`telegram source verified for store ${pending.storeId} (chat ${chat})`);
      }
      return;
    }

    // Payments: only from a verified chat. This is the security boundary.
    const source = await this.prisma.telegramPaymentSource.findFirst({ where: { chatId: chat, verifiedAt: { not: null } } });
    if (!source) return;

    const dedupeKey = update.update_id !== undefined ? `tg:${update.update_id}` : `tg:${chat}:${hash(text)}`;
    const parsed = parseBankAlert(text);

    // Match a pending payment: same store, same currency, same amount, recent.
    let paymentId: string | null = null;
    let matchCount = 0;
    if (parsed) {
      const since = new Date(Date.now() - MATCH_WINDOW_MS);
      const candidates = await this.prisma.payment.findMany({
        where: {
          storeId: source.storeId,
          status: { in: ['PENDING', 'SCANNED'] },
          currency: parsed.currency,
          createdAt: { gte: since },
        },
        select: { id: true, amount: true },
      });
      const exact = candidates.filter((c) => c.amount.equals(new Prisma.Decimal(parsed.amount)));
      matchCount = exact.length;
      if (exact.length === 1) paymentId = exact[0].id; // unique → offer confirm
    }

    try {
      await this.prisma.paymentDetection.create({
        data: {
          id: prefixedId('det'),
          storeId: source.storeId,
          paymentId,
          updateKey: dedupeKey,
          amount: parsed ? new Prisma.Decimal(parsed.amount) : null,
          currency: parsed?.currency ?? null,
          rawText: text.slice(0, 2000),
          matchCount,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return; // already ingested
      throw e;
    }
    this.logger.log(`detection for store ${source.storeId}: ${parsed?.amount ?? '?'} ${parsed?.currency ?? ''} → ${matchCount} match(es)`);
  }

  /** Cashier confirms a detected payment (assist mode — the actual mark-paid). */
  async confirm(user: AuthUser, detectionId: string) {
    const det = await this.prisma.paymentDetection.findUnique({ where: { id: detectionId } });
    if (!det) throw ApiError.paymentNotFound('Detection not found');
    await this.assertStore(user, det.storeId, 'payment:write');
    if (!det.paymentId) throw ApiError.invalidRequest('This detection is not matched to a payment');
    await this.payments.transition(det.paymentId, 'paid', `telegram detection ${det.id} confirmed by ${user.userId}`);
    await this.prisma.paymentDetection.update({ where: { id: det.id }, data: { confirmed: true } });
    return { confirmed: true, payment_id: det.paymentId };
  }

  /**
   * Dry-run a bank alert: what would PayKH read from this exact message?
   *
   * Read-only — records nothing, moves no money. Its purpose is to make the one
   * silent-failure mode visible: if a merchant's bank phrases alerts in a way
   * the parser does not recognise, detection would quietly never match. Pasting
   * a real message here shows whether it parses, and whether it would match a
   * pending charge right now.
   */
  async testParse(user: AuthUser, storeId: string, text: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const parsed = parseBankAlert(text);
    let wouldMatch = 0;
    if (parsed) {
      const since = new Date(Date.now() - MATCH_WINDOW_MS);
      const candidates = await this.prisma.payment.findMany({
        where: { storeId, status: { in: ['PENDING', 'SCANNED'] }, currency: parsed.currency, createdAt: { gte: since } },
        select: { amount: true },
      });
      wouldMatch = candidates.filter((c) => c.amount.equals(new Prisma.Decimal(parsed.amount))).length;
    }
    return {
      parsed: !!parsed,
      amount: parsed?.amount ?? null,
      currency: parsed?.currency ?? null,
      would_match_count: wouldMatch,
      hint: !parsed
        ? 'PayKH could not read an amount + currency from this. Detection would not match it. Send the exact message so the parser can be improved.'
        : wouldMatch === 1
          ? 'Reads cleanly and matches exactly one open charge — this would offer a one-tap confirm.'
          : wouldMatch === 0
            ? 'Reads cleanly, but no open charge matches right now (create a charge for this amount to test the full flow).'
            : 'Reads cleanly, but several open charges share this amount — PayKH would record it without auto-linking, to avoid confirming the wrong one.',
    };
  }

  /** The secret Telegram must echo in X-Telegram-Bot-Api-Secret-Token. */
  webhookSecret(): string | undefined {
    return this.config.get<string>('telegramWebhookSecret');
  }
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

class ConfirmDto {
  // Must carry a class-validator decorator: the global ValidationPipe runs with
  // whitelist:true, which strips any undecorated property — leaving detection_id
  // undefined and the lookup malformed.
  @IsString() detection_id!: string;
}

class TestParseDto {
  @IsString() @MaxLength(2000) text!: string;
}

@ApiTags('telegram-detection')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard/stores/:storeId/telegram-detection')
export class TelegramDetectionController {
  constructor(private readonly svc: TelegramDetectionService) {}

  @Get()
  status(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.svc.status(user, storeId);
  }

  @Post('verify')
  @ApiOperation({ summary: 'Get a code to post in your bank-alert chat' })
  verify(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.svc.beginVerify(user, storeId);
  }

  @Post('unlink')
  unlink(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.svc.unlink(user, storeId);
  }

  @Get('recent')
  @ApiOperation({ summary: 'Recent detections (POS polls this)' })
  recent(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.svc.recent(user, storeId);
  }

  @Post('confirm')
  @ApiOperation({ summary: 'Confirm a detected payment as paid' })
  confirm(@CurrentUser() user: AuthUser, @Body() dto: ConfirmDto) {
    return this.svc.confirm(user, dto.detection_id);
  }

  @Post('test-parse')
  @ApiOperation({ summary: 'Dry-run: what would PayKH read from this bank message?' })
  testParse(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: TestParseDto) {
    return this.svc.testParse(user, storeId, dto.text);
  }
}

/**
 * Public endpoint Telegram calls with bot updates. Not JWT-guarded — Telegram
 * cannot carry a bearer token — so it is authenticated by the secret configured
 * on setWebhook and echoed in this header. A request without it is ignored.
 */
@ApiTags('telegram-detection')
@Controller('telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger('TelegramWebhook');
  constructor(private readonly svc: TelegramDetectionService) {}

  @Post('webhook')
  async webhook(@Req() _req: Request, @Body() update: unknown, @Headers('x-telegram-bot-api-secret-token') secret?: string) {
    const expected = this.svc.webhookSecret();
    // Fail closed: if no secret is configured, accept nothing.
    if (!expected || secret !== expected) return { ok: true }; // 200 so Telegram stops retrying, but do nothing
    try {
      await this.svc.ingest(update as never);
    } catch (e) {
      this.logger.warn(`ingest failed: ${e}`);
    }
    return { ok: true };
  }
}

@Module({
  imports: [AuthModule, PaymentsModule],
  controllers: [TelegramDetectionController, TelegramWebhookController],
  providers: [TelegramDetectionService],
  exports: [TelegramDetectionService],
})
export class TelegramDetectionModule {}
