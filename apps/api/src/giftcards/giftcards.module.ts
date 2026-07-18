import { Body, Controller, Get, Inject, Injectable, Logger, Module, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';
import { Prisma, GiftCard, Currency } from '@prisma/client';
import { prefixedId, randomBase58 } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthModule } from '../auth/auth.module';
import { requirePermission, Permission } from '../auth/rbac';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';
import { DIGITAL_VALUE_PROVIDER, DigitalValueProvider } from '../providers/digital-value-provider.interface';
import { FeatureFlagsService } from '../feature-flags/feature-flags.module';

const DECIMALS: Record<Currency, number> = { USD: 2, KHR: 0 };

export interface GiftCardApplied {
  gift_card_id: string;
  code: string;
  applied: string; // amount this card covers of the order
  remaining: string; // amount left to pay by QR
  currency: Currency;
}

class IssueGiftCardDto {
  @IsNumberString() amount!: string;
  @IsIn(['USD', 'KHR']) currency!: Currency;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() expiresAt?: string;
}

/**
 * Gift cards / store credit: a prepaid monetary balance a customer spends at
 * checkout. Distinct from loyalty points (which are earned) — this is money the
 * store already holds. Balance is the source of truth and every change is
 * journaled; it is only decremented when a payment is captured, atomically.
 */
@Injectable()
export class GiftCardsService {
  private readonly logger = new Logger('GiftCards');
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FeatureFlagsService,
    @Inject(DIGITAL_VALUE_PROVIDER) private readonly value: DigitalValueProvider,
  ) {}

  // --- PayChain value rail (the store-credit balance's real home once enabled) ---
  // Store credit is money-value, so it belongs on the digital-value rail, not a
  // raw counter. Today PayKH's DB balance is authoritative and these mirror
  // calls are best-effort behind `paychain.enabled` (off until the PayChain team
  // wires credentials); when on, PayChain holds the value and the DB reconciles
  // against it. Whole minor units only (USD cents / KHR riel) — the rail is
  // integer-valued.
  private assetId(currency: Currency) { return `storecredit:${currency}`; }
  private minor(amount: Prisma.Decimal, currency: Currency): string {
    const factor = currency === 'USD' ? 100 : 1;
    return amount.mul(factor).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toString();
  }

  private async mirrorIssue(card: GiftCard, orgId: string): Promise<void> {
    if (!(await this.flags.isEnabled('paychain.enabled', orgId).catch(() => false))) return;
    try {
      const holder = card.customerId ?? card.id; // bearer card → synthetic holder
      const wallet = await this.value.createWallet({ customerId: holder, storeId: card.storeId });
      const txn = await this.value.issue({
        toWalletId: wallet.walletId,
        value: { assetId: this.assetId(card.currency), amount: this.minor(card.initialBalance, card.currency) },
        idempotencyKey: `paykh:giftcard:issue:${card.id}`,
        reference: card.id,
      });
      await this.prisma.giftCard.update({ where: { id: card.id }, data: { paychainWalletId: wallet.walletId } });
      await this.prisma.giftCardTransaction.updateMany({ where: { giftCardId: card.id, type: 'ISSUE' }, data: { providerTxnId: txn.transactionId } });
    } catch (e) {
      this.logger.warn(`gift card ${card.id} PayChain issue mirror failed (DB authoritative): ${e}`);
    }
  }

  private async mirrorRedeem(card: { id: string; storeId: string; currency: Currency; paychainWalletId: string | null }, applied: Prisma.Decimal, paymentId: string, orgId: string): Promise<void> {
    if (!card.paychainWalletId) return;
    if (!(await this.flags.isEnabled('paychain.enabled', orgId).catch(() => false))) return;
    try {
      const txn = await this.value.redeem({
        fromWalletId: card.paychainWalletId,
        value: { assetId: this.assetId(card.currency), amount: this.minor(applied, card.currency) },
        idempotencyKey: `paykh:giftcard:redeem:${paymentId}`,
        reference: paymentId,
      });
      await this.prisma.giftCardTransaction.updateMany({ where: { giftCardId: card.id, paymentId, type: 'REDEEM' }, data: { providerTxnId: txn.transactionId } });
    } catch (e) {
      this.logger.warn(`gift card ${card.id} PayChain redeem mirror failed (DB authoritative): ${e}`);
    }
  }

  private async assertStore(user: AuthUser, storeId: string, perm: Permission) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }

  async issue(user: AuthUser, storeId: string, dto: IssueGiftCardDto) {
    const store = await this.assertStore(user, storeId, 'giftcard:write');
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) throw ApiError.invalidRequest('Amount must be greater than 0');
    const code = `GC${randomBase58(10).toUpperCase()}`;
    const card = await this.prisma.giftCard.create({
      data: {
        id: prefixedId('gc'),
        storeId,
        code,
        currency: dto.currency,
        initialBalance: amount,
        balance: amount,
        customerId: dto.customerId ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        transactions: { create: { id: prefixedId('gctx'), type: 'ISSUE', amount, balance: amount, reason: 'issued' } },
      },
    });
    await this.mirrorIssue(card, store.organizationId); // PayChain rail (best-effort, flag-gated)
    return this.serialize(card);
  }

  async list(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'giftcard:read');
    const rows = await this.prisma.giftCard.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((c) => this.serialize(c));
  }

  /** Public balance check — by code, no auth (like the wallet). */
  async publicBalance(storeId: string, code: string) {
    const card = await this.prisma.giftCard.findUnique({ where: { storeId_code: { storeId, code: (code ?? '').trim().toUpperCase() } } });
    if (!card) throw ApiError.paymentNotFound('No gift card with that code');
    return { code: card.code, currency: card.currency, balance: card.balance.toString(), active: card.active && (!card.expiresAt || card.expiresAt > new Date()) };
  }

  /**
   * How much of an order a card can cover. Never mutates — the decrement happens
   * on capture. `applied` = min(balance, amount); `remaining` is paid by QR.
   */
  async quote(storeId: string, rawCode: string, ctx: { amount: Prisma.Decimal; currency: Currency }): Promise<GiftCardApplied> {
    const code = (rawCode ?? '').trim().toUpperCase();
    if (!code) throw ApiError.invalidRequest('Enter a gift card code');
    const card = await this.prisma.giftCard.findUnique({ where: { storeId_code: { storeId, code } } });
    if (!card || !card.active) throw ApiError.invalidRequest('That gift card is not valid');
    if (card.expiresAt && card.expiresAt <= new Date()) throw ApiError.invalidRequest('That gift card has expired');
    if (card.currency !== ctx.currency) throw ApiError.invalidRequest(`That gift card is in ${card.currency}, not ${ctx.currency}`);
    if (card.balance.lte(0)) throw ApiError.invalidRequest('That gift card has no balance left');

    const dp = DECIMALS[ctx.currency];
    const applied = Prisma.Decimal.min(card.balance, ctx.amount).toDecimalPlaces(dp, Prisma.Decimal.ROUND_DOWN);
    const remaining = ctx.amount.minus(applied);
    return {
      gift_card_id: card.id,
      code: card.code,
      applied: applied.toFixed(dp),
      remaining: remaining.toFixed(dp),
      currency: ctx.currency,
    };
  }

  /**
   * Decrement the balance once the payment is captured. Idempotent: if a REDEEM
   * txn already exists for this payment, do nothing. The optimistic guard on the
   * old balance prevents a concurrent double-spend.
   */
  async onPaid(payment: { id: string; storeId: string; metadata: unknown }): Promise<void> {
    const meta = (payment.metadata ?? {}) as { gift_card?: { id: string; applied: string } };
    const g = meta.gift_card;
    if (!g?.id) return;
    const applied = new Prisma.Decimal(g.applied);
    if (applied.lte(0)) return;
    let decremented = false;
    let card: GiftCard | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        const already = await tx.giftCardTransaction.findFirst({ where: { giftCardId: g.id, paymentId: payment.id, type: 'REDEEM' } });
        if (already) return; // idempotent
        card = await tx.giftCard.findUnique({ where: { id: g.id } });
        if (!card) return;
        const newBalance = card.balance.minus(applied);
        // Guard on the current balance so two captures can't both spend it.
        const upd = await tx.giftCard.updateMany({ where: { id: g.id, balance: card.balance }, data: { balance: newBalance.lt(0) ? new Prisma.Decimal(0) : newBalance } });
        if (upd.count !== 1) return;
        await tx.giftCardTransaction.create({
          data: { id: prefixedId('gctx'), giftCardId: g.id, type: 'REDEEM', amount: applied.negated(), balance: newBalance.lt(0) ? new Prisma.Decimal(0) : newBalance, paymentId: payment.id, reason: 'redeemed at checkout' },
        });
        decremented = true;
      });
    } catch (e) {
      this.logger.warn(`gift card onPaid failed for ${payment.id}: ${e}`);
      return;
    }
    // Mirror the spend onto the PayChain rail (best-effort, flag-gated).
    if (decremented && card) {
      const store = await this.prisma.store.findUnique({ where: { id: payment.storeId }, select: { organizationId: true } });
      if (store) await this.mirrorRedeem(card, applied, payment.id, store.organizationId);
    }
  }

  private serialize(c: GiftCard) {
    return {
      id: c.id,
      code: c.code,
      currency: c.currency,
      initial_balance: c.initialBalance.toString(),
      balance: c.balance.toString(),
      customer_id: c.customerId,
      active: c.active,
      expires_at: c.expiresAt?.toISOString() ?? null,
      created_at: c.createdAt.toISOString(),
    };
  }
}

@ApiTags('gift-cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class GiftCardsDashboardController {
  constructor(private readonly giftcards: GiftCardsService) {}

  @Get('stores/:storeId/gift-cards')
  @ApiOperation({ summary: 'List gift cards' })
  list(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.giftcards.list(user, storeId);
  }

  @Post('stores/:storeId/gift-cards')
  @ApiOperation({ summary: 'Issue a gift card' })
  issue(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: IssueGiftCardDto) {
    return this.giftcards.issue(user, storeId, dto);
  }
}

/** Public: check a gift card balance by code (for the shop/wallet). */
@ApiTags('gift-cards')
@UseGuards(RateLimitGuard)
@Controller('gift-cards')
export class GiftCardsPublicController {
  constructor(private readonly giftcards: GiftCardsService) {}

  @Get(':storeId/:code')
  @RateLimit({ limit: 20, windowSec: 10, by: 'ip' })
  @ApiOperation({ summary: 'Check a gift card balance' })
  balance(@Param('storeId') storeId: string, @Param('code') code: string) {
    return this.giftcards.publicBalance(storeId, code);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [GiftCardsDashboardController, GiftCardsPublicController],
  providers: [GiftCardsService],
  exports: [GiftCardsService],
})
export class GiftCardsModule {}
