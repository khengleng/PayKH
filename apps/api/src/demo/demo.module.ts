import { Controller, Get, Injectable, Module, Post, UseGuards } from '@nestjs/common';
import { Currency, KeyMode, PaymentStatus, PointsTxnType, Prisma } from '@prisma/client';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { WalletModule } from '../wallet/wallet.module';
import { WalletService } from '../wallet/wallet.service';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';
import { LedgerModule } from '../ledger/ledger.module';
import { LedgerService } from '../ledger/ledger.service';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

/**
 * A deliberately isolated, test-mode merchant/customer pair used by the
 * public product demo. It exercises the same paid-payment → loyalty → wallet
 * flow as a merchant integration, but never uses a merchant API key, bank
 * credential, or live-mode store.
 */
const DEMO = {
  org: 'demo_org_paykh', store: 'demo_store_malis', customer: 'demo_customer_serey',
  tier: 'demo_tier_gold', reward: 'demo_reward_save', game: 'demo_game_friday', giftCard: 'demo_gift_malis',
  seedPoints: 2480,
};

@Injectable()
export class DemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
  ) {}

  async snapshot() {
    await this.ensure();
    const wallet = await this.wallet.wallet(DEMO.customer);
    return {
      merchant: { name: 'Malis Coffee · BKK1', city: 'Phnom Penh', khqr: true },
      customer_id: DEMO.customer,
      wallet_url: `${process.env.CHECKOUT_BASE_URL ?? ''}/wallet/${DEMO.customer}`,
      wallet,
    };
  }

  async pay() {
    await this.ensure();
    // A test-mode payment is intentionally created directly for the demo, then
    // transitioned through the canonical state machine. The transition runs
    // loyalty earning, games, ledger posting, receipts and risk hooks exactly
    // as it does for a merchant's simulated test payment.
    const payment = await this.prisma.payment.create({
      data: {
        id: prefixedId('pay'), storeId: DEMO.store, apiKeyId: null, mode: KeyMode.TEST,
        status: PaymentStatus.PENDING, amount: new Prisma.Decimal(12_500), currency: Currency.KHR,
        referenceId: `demo-${Date.now()}`, description: 'Malis Coffee demo payment',
        metadata: { demo: true }, qrString: 'PAYKH-DEMO-KHQR', expiresAt: new Date(Date.now() + 300_000), customerId: DEMO.customer,
      },
    });
    const paid = await this.payments.transition(payment.id, 'paid', 'PayKH public demo payment');
    return { payment_id: paid.id, receipt_url: `${process.env.CHECKOUT_BASE_URL ?? ''}/r/${paid.id}`, ...(await this.snapshot()) };
  }

  private async ensure() {
    await this.prisma.organization.upsert({ where: { id: DEMO.org }, create: { id: DEMO.org, name: 'PayKH Demo Merchant' }, update: { name: 'PayKH Demo Merchant' } });
    await this.prisma.store.upsert({ where: { id: DEMO.store }, create: { id: DEMO.store, organizationId: DEMO.org, name: 'Malis Coffee · BKK1', liveMode: false }, update: { name: 'Malis Coffee · BKK1', liveMode: false } });
    await this.prisma.storeBranding.upsert({ where: { storeId: DEMO.store }, create: { storeId: DEMO.store, displayName: 'Malis Coffee', primaryColor: '#1649E8' }, update: { displayName: 'Malis Coffee', primaryColor: '#1649E8' } });
    await this.prisma.loyaltyProgram.upsert({ where: { storeId: DEMO.store }, create: { storeId: DEMO.store, active: true, pointsPerUnit: new Prisma.Decimal('0.01') }, update: { active: true, pointsPerUnit: new Prisma.Decimal('0.01') } });
    await this.prisma.loyaltyTier.upsert({ where: { id: DEMO.tier }, create: { id: DEMO.tier, storeId: DEMO.store, name: 'Gold', threshold: 2000, earnMultiplier: new Prisma.Decimal(1) }, update: { name: 'Gold', threshold: 2000, earnMultiplier: new Prisma.Decimal(1) } });
    const customer = await this.prisma.customer.upsert({
      where: { id: DEMO.customer },
      create: { id: DEMO.customer, storeId: DEMO.store, name: 'Serey Chenda', externalId: 'paykh-demo-serey', metadata: { demo: true }, pointsBalance: DEMO.seedPoints, lifetimePoints: DEMO.seedPoints, tierId: DEMO.tier, referralCode: 'SEREY-24' },
      update: { name: 'Serey Chenda', tierId: DEMO.tier, referralCode: 'SEREY-24' },
    });
    // Seed the points sub-ledger once, so the demo is reconciled from its first
    // render rather than showing a balance with no matching liability journal.
    const seedTxn = 'demo_points_opening_balance';
    const hasSeed = await this.prisma.pointsTransaction.findUnique({ where: { id: seedTxn } });
    if (!hasSeed) await this.prisma.$transaction(async tx => {
      await tx.pointsTransaction.create({ data: { id: seedTxn, storeId: DEMO.store, customerId: customer.id, type: PointsTxnType.EARN, points: DEMO.seedPoints, reason: 'demo opening balance', confirmedAt: new Date() } });
      await this.ledger.postPointsMovement('EARN', seedTxn, DEMO.store, customer.id, DEMO.seedPoints, tx);
    });
    await this.prisma.reward.upsert({ where: { id: DEMO.reward }, create: { id: DEMO.reward, storeId: DEMO.store, name: '15% off your next order', description: 'Malis Coffee · valid for 14 days', pointsCost: 500, stock: -1, active: true }, update: { active: true, pointsCost: 500 } });
    await this.prisma.game.upsert({ where: { id: DEMO.game }, create: { id: DEMO.game, storeId: DEMO.store, name: 'Friday coffee surprise', type: 'SCRATCH_CARD', active: true, autoIssue: true, minPaymentAmount: new Prisma.Decimal(1) }, update: { active: true, autoIssue: true } });
    await this.prisma.giftCard.upsert({ where: { id: DEMO.giftCard }, create: { id: DEMO.giftCard, storeId: DEMO.store, customerId: DEMO.customer, code: 'DEMO-MALIS-25', currency: Currency.USD, initialBalance: new Prisma.Decimal(25), balance: new Prisma.Decimal(25), active: true }, update: { active: true } });
  }
}

@ApiTags('demo')
@UseGuards(RateLimitGuard)
@RateLimit({ limit: 15, windowSec: 60, by: 'ip' })
@Controller('demo/mobile')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Get()
  @ApiOperation({ summary: 'Get the isolated PayKH mobile demo scenario' })
  get() { return this.demo.snapshot(); }

  @Post('pay')
  @ApiOperation({ summary: 'Run a test-mode KHQR payment through the PayKH demo scenario' })
  pay() { return this.demo.pay(); }
}

@Module({ imports: [WalletModule, PaymentsModule, LedgerModule], controllers: [DemoController], providers: [DemoService] })
export class DemoModule {}
