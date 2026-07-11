import { Injectable } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Prisma } from '@prisma/client';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';

export class RevenueShareDto {
  @IsString() @MaxLength(120) partnerName!: string;
  @IsInt() @Min(0) @Max(10000) shareBps!: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Injectable()
export class MonetizationService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertStore(user: AuthUser, storeId: string, perm: 'payment:read' | 'billing:manage') {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }

  // ---------------------------------------------------------- revenue share
  async listShares(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const rows = await this.prisma.revenueShareAgreement.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({ id: r.id, partner_name: r.partnerName, share_bps: r.shareBps, active: r.active }));
  }

  async createShare(user: AuthUser, storeId: string, dto: RevenueShareDto) {
    await this.assertStore(user, storeId, 'billing:manage');
    const r = await this.prisma.revenueShareAgreement.create({
      data: { id: prefixedId('rev'), storeId, partnerName: dto.partnerName, shareBps: dto.shareBps, active: dto.active ?? true },
    });
    return { id: r.id, partner_name: r.partnerName, share_bps: r.shareBps, active: r.active };
  }

  async updateShare(user: AuthUser, shareId: string, dto: Partial<RevenueShareDto>) {
    const share = await this.prisma.revenueShareAgreement.findUnique({ where: { id: shareId } });
    if (!share) throw ApiError.paymentNotFound('Agreement not found');
    await this.assertStore(user, share.storeId, 'billing:manage');
    const r = await this.prisma.revenueShareAgreement.update({ where: { id: shareId }, data: { partnerName: dto.partnerName, shareBps: dto.shareBps, active: dto.active } });
    return { id: r.id, partner_name: r.partnerName, share_bps: r.shareBps, active: r.active };
  }

  async deleteShare(user: AuthUser, shareId: string) {
    const share = await this.prisma.revenueShareAgreement.findUnique({ where: { id: shareId } });
    if (!share) throw ApiError.paymentNotFound('Agreement not found');
    await this.assertStore(user, share.storeId, 'billing:manage');
    await this.prisma.revenueShareAgreement.delete({ where: { id: shareId } });
    return { deleted: true };
  }

  // ------------------------------------------------------- accounting ledger
  /**
   * A derived double-entry accounting view over a window: gross revenue and
   * processing fees from paid payments, refunds, affiliate-commission expense,
   * and partner revenue-share expense. Read-only — computed from source tables
   * (no separate ledger writes to drift out of sync).
   */
  async ledger(user: AuthUser, storeId: string, fromIso?: string, toIso?: string) {
    const store = await this.assertStore(user, storeId, 'payment:read');
    const to = toIso ? new Date(toIso) : new Date();
    const from = fromIso ? new Date(fromIso) : new Date(to.getTime() - 30 * 86_400_000);

    const paidWhere: Prisma.PaymentWhereInput = { storeId, status: 'PAID', paidAt: { gte: from, lte: to } };
    const [paid, refundAgg, commissionAgg, shares] = await Promise.all([
      this.prisma.payment.aggregate({ where: paidWhere, _sum: { amount: true, refundedAmount: true }, _count: { _all: true } }),
      this.prisma.payment.aggregate({ where: { storeId, refundedAmount: { gt: 0 }, paidAt: { gte: from, lte: to } }, _sum: { refundedAmount: true } }),
      this.prisma.referralCommission.aggregate({ where: { storeId, createdAt: { gte: from, lte: to }, status: { in: ['ACCRUED', 'PAID'] } }, _sum: { amount: true } }),
      this.prisma.revenueShareAgreement.findMany({ where: { storeId, active: true } }),
    ]);

    const gross = new Prisma.Decimal(paid._sum.amount ?? 0);
    const refunds = new Prisma.Decimal(refundAgg._sum.refundedAmount ?? 0);
    const processingFee = gross.mul(store.feeBps).div(10_000);
    const commissions = new Prisma.Decimal(commissionAgg._sum.amount ?? 0);
    const revShareTotalBps = shares.reduce((a, s) => a + s.shareBps, 0);
    const revShare = processingFee.mul(revShareTotalBps).div(10_000);
    const net = gross.minus(refunds).minus(processingFee).minus(commissions).minus(revShare);

    const entries = [
      { account: 'Gross revenue', type: 'credit', amount: gross.toFixed(2) },
      { account: 'Refunds', type: 'debit', amount: refunds.toFixed(2) },
      { account: 'Processing fees', type: 'debit', amount: processingFee.toFixed(2) },
      { account: 'Affiliate commissions', type: 'debit', amount: commissions.toFixed(2) },
      { account: 'Partner revenue share', type: 'debit', amount: revShare.toFixed(2) },
    ];

    return {
      store_id: storeId,
      from: from.toISOString(),
      to: to.toISOString(),
      fee_bps: store.feeBps,
      paid_count: paid._count._all,
      entries,
      net_earnings: net.toFixed(2),
      revenue_share_breakdown: shares.map((s) => ({ partner: s.partnerName, share_bps: s.shareBps, amount: processingFee.mul(s.shareBps).div(10_000).toFixed(2) })),
    };
  }
}
