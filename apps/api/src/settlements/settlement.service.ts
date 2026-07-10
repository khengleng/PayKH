import { Injectable, Logger } from '@nestjs/common';
import { Payment, Prisma, Settlement } from '@prisma/client';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { computeSettlementAmounts } from './settlement.util';

const D = Prisma.Decimal;

/** Truncate a date to the start of its UTC day. */
function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Settlement batching. Groups a store's paid/refunded payments into daily
 * Settlement records per currency and computes gross / refunds / fee / net.
 * Merchant customer payments settle to the merchant's own Bakong account; PayKH
 * records the settlement statement (fees in basis points, `Store.feeBps`).
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger('Settlement');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Batch settleable payments for one store. By default only fully-elapsed days
   * are settled (paidAt before the start of today UTC); `includeToday` settles
   * everything currently paid (used by the manual "settle now" action / tests).
   */
  async runForStore(storeId: string, includeToday = false): Promise<Settlement[]> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return [];
    const cutoff = includeToday ? new Date() : utcDay(new Date());

    const payments = await this.prisma.payment.findMany({
      where: {
        storeId,
        status: { in: ['PAID', 'REFUNDED'] },
        settlementId: null,
        paidAt: { not: null, lt: cutoff },
      },
      take: 5000,
    });
    if (payments.length === 0) return [];

    // Group by currency + payout day.
    const groups = new Map<string, Payment[]>();
    for (const p of payments) {
      const day = utcDay(p.paidAt as Date).toISOString();
      const key = `${p.currency}|${day}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
    }

    const results: Settlement[] = [];
    for (const [key, group] of groups) {
      const [currency, dayIso] = key.split('|');
      const payoutDate = new Date(dayIso);
      const settlement = await this.settleGroup(store.id, store.feeBps, currency as 'USD' | 'KHR', payoutDate, group);
      results.push(settlement);
    }
    this.logger.log(`settled ${payments.length} payment(s) into ${results.length} batch(es) for store ${storeId}`);
    return results;
  }

  private async settleGroup(
    storeId: string,
    feeBps: number,
    currency: 'USD' | 'KHR',
    payoutDate: Date,
    group: Payment[],
  ): Promise<Settlement> {
    let grossSum = new D(0);
    let refundSum = new D(0);
    for (const p of group) {
      grossSum = grossSum.plus(p.amount);
      refundSum = refundSum.plus(p.refundedAmount);
    }
    const { gross, refunds, fee, net } = computeSettlementAmounts(grossSum, refundSum, feeBps);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.settlement.findUnique({
        where: { storeId_currency_payoutDate: { storeId, currency, payoutDate } },
      });
      let settlement: Settlement;
      if (existing) {
        settlement = await tx.settlement.update({
          where: { id: existing.id },
          data: {
            grossAmount: existing.grossAmount.plus(gross),
            refundAmount: existing.refundAmount.plus(refunds),
            feeAmount: existing.feeAmount.plus(fee),
            netAmount: existing.netAmount.plus(net),
            paymentCount: existing.paymentCount + group.length,
          },
        });
      } else {
        settlement = await tx.settlement.create({
          data: {
            id: prefixedId('setl'),
            storeId,
            currency,
            payoutDate,
            status: 'SETTLED',
            grossAmount: gross,
            refundAmount: refunds,
            feeBps,
            feeAmount: fee,
            netAmount: net,
            paymentCount: group.length,
            settledAt: new Date(),
          },
        });
      }
      await tx.payment.updateMany({
        where: { id: { in: group.map((p) => p.id) } },
        data: { settlementId: settlement.id },
      });
      return settlement;
    });
  }

  // --------------------------------------------------------- dashboard reads
  async list(user: AuthUser, storeId: string) {
    await this.assertStoreAccess(user, storeId);
    const rows = await this.prisma.settlement.findMany({
      where: { storeId },
      orderBy: { payoutDate: 'desc' },
      take: 200,
    });
    return rows.map((s) => this.serialize(s));
  }

  async get(user: AuthUser, settlementId: string) {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id: settlementId },
      include: { payments: { select: { id: true, amount: true, refundedAmount: true, currency: true, referenceId: true, paidAt: true } } },
    });
    if (!settlement) throw ApiError.paymentNotFound('Settlement not found');
    await this.assertStoreAccess(user, settlement.storeId);
    return {
      ...this.serialize(settlement),
      payments: settlement.payments.map((p) => ({
        id: p.id,
        amount: p.amount.toFixed(2),
        refunded: p.refundedAmount.toFixed(2),
        reference_id: p.referenceId,
        paid_at: p.paidAt?.toISOString() ?? null,
      })),
    };
  }

  /** Manual "settle now" for a store (owner/admin) — includes today. */
  async runNow(user: AuthUser, storeId: string) {
    const store = await this.assertStoreAccess(user, storeId, 'store:write');
    const settlements = await this.runForStore(store.id, true);
    return { store_id: storeId, created: settlements.length, settlements: settlements.map((s) => this.serialize(s)) };
  }

  private async assertStoreAccess(user: AuthUser, storeId: string, perm: 'payment:read' | 'store:write' = 'payment:read') {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }

  private serialize(s: Settlement) {
    return {
      id: s.id,
      store_id: s.storeId,
      currency: s.currency,
      payout_date: s.payoutDate.toISOString().slice(0, 10),
      status: s.status.toLowerCase(),
      gross: s.grossAmount.toFixed(2),
      refunds: s.refundAmount.toFixed(2),
      fee_bps: s.feeBps,
      fee: s.feeAmount.toFixed(2),
      net: s.netAmount.toFixed(2),
      payment_count: s.paymentCount,
      settled_at: s.settledAt?.toISOString() ?? null,
    };
  }
}
