import { Injectable } from '@nestjs/common';
import { Payment, Prisma, PaymentStatus as DbStatus } from '@prisma/client';
import { PaymentStatus } from '@paykh/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { formatAmount } from '../payments/amount.util';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertStoreAccess(user: AuthUser, storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, 'payment:read');
    return store;
  }

  async overview(user: AuthUser, storeId: string) {
    await this.assertStoreAccess(user, storeId);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [total, byStatus, paidAgg, monthPaid] = await Promise.all([
      this.prisma.payment.count({ where: { storeId } }),
      this.prisma.payment.groupBy({
        by: ['status'],
        where: { storeId },
        _count: { _all: true },
      }),
      this.prisma.payment.aggregate({
        where: { storeId, status: 'PAID' },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.payment.count({
        where: { storeId, status: 'PAID', paidAt: { gte: monthStart } },
      }),
    ]);

    const counts: Record<string, number> = {};
    for (const row of byStatus) {
      counts[row.status.toLowerCase()] = row._count._all;
    }
    const paidCount = paidAgg._count._all;
    const successRate = total > 0 ? Number(((paidCount / total) * 100).toFixed(1)) : 0;

    return {
      store_id: storeId,
      total_payments: total,
      paid_count: paidCount,
      paid_volume: paidAgg._sum.amount ? paidAgg._sum.amount.toFixed(2) : '0.00',
      pending_count: counts['pending'] ?? 0,
      scanned_count: counts['scanned'] ?? 0,
      failed_count: counts['failed'] ?? 0,
      expired_count: counts['expired'] ?? 0,
      cancelled_count: counts['cancelled'] ?? 0,
      success_rate: successRate,
      month_paid_count: monthPaid,
      // Webhook failure metrics wire up in Phase 2.
      recent_webhook_failures: 0,
    };
  }

  async listPayments(
    user: AuthUser,
    storeId: string,
    opts: { status?: PaymentStatus; search?: string; limit?: number; cursor?: string },
  ) {
    await this.assertStoreAccess(user, storeId);
    const limit = Math.min(opts.limit ?? 25, 100);
    const where: Prisma.PaymentWhereInput = { storeId };
    if (opts.status) where.status = opts.status.toUpperCase() as DbStatus;
    if (opts.search) {
      where.OR = [
        { id: { contains: opts.search } },
        { referenceId: { contains: opts.search, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.payment.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    return {
      object: 'list' as const,
      data: rows.slice(0, limit).map((p) => this.serialize(p)),
      has_more: hasMore,
      next_cursor: hasMore ? rows[limit - 1].id : null,
    };
  }

  async getPayment(user: AuthUser, id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        statusHistory: { orderBy: { createdAt: 'asc' } },
        providerReference: true,
      },
    });
    if (!payment) throw ApiError.paymentNotFound();
    await this.assertStoreAccess(user, payment.storeId);
    return {
      ...this.serialize(payment),
      timeline: payment.statusHistory.map((h) => ({
        from: h.fromStatus?.toLowerCase() ?? null,
        to: h.toStatus.toLowerCase(),
        reason: h.reason,
        at: h.createdAt.toISOString(),
      })),
      provider_reference: payment.providerReference
        ? {
            provider: payment.providerReference.provider,
            md5: payment.providerReference.md5,
            bill_number: payment.providerReference.billNumber,
            provider_txn_id: payment.providerReference.providerTxnId,
          }
        : null,
    };
  }

  private serialize(p: Payment) {
    return {
      id: p.id,
      status: p.status.toLowerCase(),
      mode: p.mode.toLowerCase(),
      amount: formatAmount(p.amount, p.currency),
      currency: p.currency,
      reference_id: p.referenceId,
      description: p.description,
      metadata: (p.metadata as Record<string, unknown>) ?? {},
      created_at: p.createdAt.toISOString(),
      expires_at: p.expiresAt.toISOString(),
      paid_at: p.paidAt?.toISOString() ?? null,
    };
  }
}
