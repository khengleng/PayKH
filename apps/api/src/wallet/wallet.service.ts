import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';

/**
 * Public customer wallet — a customer-facing loyalty pass keyed by the customer
 * id (bearer token, like the payment checkout page). Aggregates points, tier,
 * referral code/QR, and unrevealed scratch cards for the hosted wallet page.
 */
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async wallet(customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, include: { tier: true, store: true } });
    if (!customer) throw ApiError.paymentNotFound('Wallet not found');

    const [issuedCards, program, referralCount] = await Promise.all([
      this.prisma.gamePlay.findMany({ where: { customerId, status: 'ISSUED' }, include: { game: true }, take: 20 }),
      this.prisma.loyaltyProgram.findUnique({ where: { storeId: customer.storeId } }),
      this.prisma.referral.count({ where: { referrerCustomerId: customerId } }),
    ]);

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
    };
  }
}
