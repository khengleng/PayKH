import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { PayChainIntegrationService } from '../paychain/paychain-integration.module';
import { PayChainClient } from '../paychain/paychain-client';

/**
 * Public customer wallet — a customer-facing loyalty pass keyed by the customer
 * id (bearer token, like the payment checkout page). Aggregates points, tier,
 * redeemable rewards + the customer's vouchers, referral code/QR, and unrevealed
 * scratch cards for the hosted wallet page.
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loyalty: LoyaltyService,
    private readonly paychain: PayChainIntegrationService,
    private readonly pcClient: PayChainClient,
  ) {}

  /** The customer's on-chain PayChain balance — proof the points live on the
   *  value rail, not just a PayKH counter. Best-effort: null when PayChain isn't
   *  connected for the store or the read fails; the local balance still shows. */
  private async paychainProof(customer: { paychainWalletId: string | null; storeId: string; store: { organizationId: string } }) {
    if (!customer.paychainWalletId) return null;
    const conn = await this.paychain.resolve(customer.store.organizationId).catch(() => null);
    if (!conn) return null;
    try {
      const balances = await this.pcClient.balances(conn, customer.paychainWalletId);
      const b = balances[0];
      return { wallet_id: customer.paychainWalletId, asset_code: b?.assetCode ?? null, balance: b?.balance ?? null, secured: true };
    } catch {
      return { wallet_id: customer.paychainWalletId, asset_code: null, balance: null, secured: true };
    }
  }

  async wallet(customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, include: { tier: true, store: true } });
    if (!customer) throw ApiError.paymentNotFound('Wallet not found');

    const [issuedCards, program, referralCount, rewardRows, redemptionRows] = await Promise.all([
      this.prisma.gamePlay.findMany({ where: { customerId, status: 'ISSUED' }, include: { game: true }, take: 20 }),
      this.prisma.loyaltyProgram.findUnique({ where: { storeId: customer.storeId } }),
      this.prisma.referral.count({ where: { referrerCustomerId: customerId } }),
      this.prisma.reward.findMany({ where: { storeId: customer.storeId, active: true }, orderBy: { pointsCost: 'asc' } }),
      this.prisma.redemption.findMany({ where: { customerId }, include: { reward: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const giftCards = await this.prisma.giftCard.findMany({
      where: { customerId, active: true, balance: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const paychain = await this.paychainProof(customer);

    let referral: { code: string; share_url: string; qr_png_data_url: string } | null = null;
    if (customer.referralCode) {
      const shareUrl = `${process.env.CHECKOUT_BASE_URL ?? ''}/?ref=${encodeURIComponent(customer.referralCode)}`;
      referral = { code: customer.referralCode, share_url: shareUrl, qr_png_data_url: await QRCode.toDataURL(shareUrl, { margin: 2, width: 240 }) };
    }

    return {
      customer_id: customer.id,
      name: customer.name,
      store_name: customer.store.name,
      loyalty_active: !!program?.active,
      points_balance: customer.pointsBalance,
      lifetime_points: customer.lifetimePoints,
      tier: customer.tier ? { name: customer.tier.name, multiplier: customer.tier.earnMultiplier.toString() } : null,
      referrals: referralCount,
      referral,
      scratch_cards: issuedCards.map((c) => ({ play_id: c.id, game: c.game.name, play_url: `${process.env.CHECKOUT_BASE_URL ?? ''}/play/${c.id}` })),
      gift_cards: giftCards.map((g) => ({ code: g.code, currency: g.currency, balance: g.balance.toString() })),
      paychain, // on-chain proof of the loyalty balance, when the store is connected

      // What the points can buy, cheapest first, with whether this customer can
      // afford each right now — so the wallet shows a clear "you can get this".
      rewards: program?.active
        ? rewardRows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            points_cost: r.pointsCost,
            in_stock: r.stock !== 0,
            affordable: customer.pointsBalance >= r.pointsCost,
          }))
        : [],
      // The customer's vouchers — an ISSUED one is theirs to show the merchant.
      redemptions: redemptionRows.map((r) => ({
        id: r.id,
        reward_name: r.reward?.name ?? null,
        points_spent: r.pointsSpent,
        code: r.code,
        status: r.status.toLowerCase(),
        created_at: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Redeem the customer's own points for a reward, returning a voucher code they
   * show the merchant. Public + keyed only by the (hard-to-guess) customer id,
   * like the rest of the wallet: the voucher is non-transferable — it belongs to
   * this customer at this store — so the worst an id-guesser could do is convert
   * someone's points to their own voucher, not extract value. Rate-limited at the
   * controller. The points deduction + stock decrement are atomic in the service.
   */
  async redeem(customerId: string, rewardId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw ApiError.paymentNotFound('Wallet not found');
    const program = await this.prisma.loyaltyProgram.findUnique({ where: { storeId: customer.storeId } });
    if (!program?.active) throw ApiError.invalidRequest('This store’s loyalty program is not active');
    return this.loyalty.redeemReward(customer.storeId, customerId, rewardId);
  }
}
