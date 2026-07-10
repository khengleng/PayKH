import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { PAYMENT_PROVIDER, PaymentProvider } from '../providers/payment-provider.interface';

interface Discrepancy {
  payment_id: string;
  type: string;
  detail: string;
}

/**
 * Reconciliation cross-checks PayKH's ledger against internal invariants and,
 * for the real provider, against Bakong's transaction status — surfacing any
 * mismatch (over-refund, refund-sum drift, missing settlement/provider ref,
 * provider status disagreement) as a stored, auditable report.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger('Reconciliation');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async run(user: AuthUser, storeId: string, fromIso?: string, toIso?: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, 'payment:read');

    const from = fromIso ? new Date(fromIso) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const to = toIso ? new Date(toIso) : new Date();

    const payments = await this.prisma.payment.findMany({
      where: { storeId, createdAt: { gte: from, lte: to } },
      include: { refunds: true, providerReference: true },
      take: 5000,
    });

    const discrepancies: Discrepancy[] = [];
    for (const p of payments) {
      const status = p.status.toLowerCase();

      // Invariant: refunded amount never exceeds the payment amount.
      if (p.refundedAmount.greaterThan(p.amount)) {
        discrepancies.push({ payment_id: p.id, type: 'over_refunded', detail: `refunded ${p.refundedAmount} > amount ${p.amount}` });
      }
      // Invariant: sum(refunds) === refundedAmount.
      const refundSum = p.refunds
        .filter((r) => r.status === 'SUCCEEDED')
        .reduce((acc, r) => acc.plus(r.amount), new Prisma.Decimal(0));
      if (!refundSum.equals(p.refundedAmount)) {
        discrepancies.push({ payment_id: p.id, type: 'refund_sum_mismatch', detail: `sum(refunds)=${refundSum} != refundedAmount=${p.refundedAmount}` });
      }
      // Paid/refunded payments must have a paidAt + provider reference.
      if ((status === 'paid' || status === 'refunded') && !p.paidAt) {
        discrepancies.push({ payment_id: p.id, type: 'missing_paid_at', detail: 'paid/refunded without paidAt' });
      }
      if (status === 'paid' && !p.providerReference?.md5) {
        discrepancies.push({ payment_id: p.id, type: 'missing_provider_ref', detail: 'no provider md5' });
      }

      // Provider cross-check (real provider only; mock is not source of truth).
      if (this.provider.name !== 'mock' && status === 'paid' && p.providerReference?.md5) {
        try {
          const st = await this.provider.checkPaymentStatus({ md5: p.providerReference.md5 });
          if (st.state !== 'paid' && st.state !== 'unknown') {
            discrepancies.push({ payment_id: p.id, type: 'provider_status_mismatch', detail: `local=paid provider=${st.state}` });
          }
        } catch (err) {
          this.logger.warn(`provider check failed for ${p.id}: ${err}`);
        }
      }
    }

    const checked = payments.length;
    const mismatched = new Set(discrepancies.map((d) => d.payment_id)).size;
    const report = await this.prisma.reconciliationReport.create({
      data: {
        id: prefixedId('rec'),
        storeId,
        provider: this.provider.name,
        periodStart: from,
        periodEnd: to,
        checked,
        matched: checked - mismatched,
        mismatched,
        discrepancies: discrepancies as unknown as Prisma.InputJsonValue,
      },
    });
    this.logger.log(`reconcile store ${storeId}: checked=${checked} mismatched=${mismatched}`);
    return this.serialize(report);
  }

  async list(user: AuthUser, storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, 'payment:read');
    const rows = await this.prisma.reconciliationReport.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => this.serialize(r));
  }

  private serialize(r: {
    id: string;
    provider: string;
    periodStart: Date;
    periodEnd: Date;
    checked: number;
    matched: number;
    mismatched: number;
    discrepancies: unknown;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      provider: r.provider,
      period_start: r.periodStart.toISOString(),
      period_end: r.periodEnd.toISOString(),
      checked: r.checked,
      matched: r.matched,
      mismatched: r.mismatched,
      discrepancies: r.discrepancies,
      created_at: r.createdAt.toISOString(),
    };
  }
}
