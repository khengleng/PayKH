import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PayoutMethod, PayoutStatus } from '@prisma/client';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.module';
import { AlertService } from '../observability/alert.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const TOL = 0.005;

/**
 * Payout execution rail. A payout has a lifecycle independent of the ledger:
 * PENDING → PAID (funds actually sent, ledger posted) | FAILED (no ledger
 * impact). The ledger is only ever posted once money has really left, so the
 * books can never claim a payout that didn't settle.
 *
 * Two methods:
 *  - MANUAL: the admin transferred funds out-of-band (bank app / Bakong app) and
 *    is recording it. Settles immediately.
 *  - BAKONG: automated Bakong disbursement. Requires disbursement credentials
 *    (system setting `bakong_disbursement_token`); until those exist and the
 *    disbursement API is wired, a BAKONG payout FAILS cleanly instead of
 *    silently booking money that never moved.
 */
@Injectable()
export class PayoutService {
  private readonly logger = new Logger('Payout');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly alerts: AlertService,
  ) {}

  /** The merchant_payable balance owed to a store in one currency. */
  private async owed(storeId: string, currency: string): Promise<Prisma.Decimal> {
    const grouped = await this.prisma.ledgerEntry.groupBy({
      by: ['direction'],
      where: { accountCode: 'merchant_payable', storeId, currency },
      _sum: { amount: true },
    });
    let credit = D(0);
    let debit = D(0);
    for (const g of grouped) {
      if (g.direction === 'CREDIT') credit = D(g._sum.amount ?? 0);
      else debit = D(g._sum.amount ?? 0);
    }
    return credit.minus(debit);
  }

  /** Initiate a payout, execute it via the chosen method, persist the outcome. */
  async pay(user: AuthUser, storeId: string, currency: string, amount: string, method: PayoutMethod, note?: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    const value = D(amount);
    if (value.lte(0)) throw ApiError.invalidRequest('Amount must be positive');

    const owed = await this.owed(storeId, currency);
    if (value.minus(owed).gt(TOL)) {
      throw ApiError.invalidRequest(`Amount ${value.toFixed(2)} exceeds ${currency} owed (${owed.toFixed(2)})`);
    }

    const payout = await this.prisma.payout.create({
      data: {
        id: prefixedId('pout'),
        storeId,
        currency,
        amount: value,
        status: 'PENDING',
        method,
        note: note ?? null,
        initiatedByUserId: user.userId,
      },
    });

    try {
      if (method === 'MANUAL') {
        // Admin has already transferred the funds out-of-band; record + book it.
        await this.ledger.postPayout(storeId, currency, value, payout.id);
        return this.settle(payout.id, prefixedId('manual'));
      }
      // BAKONG automated disbursement.
      const token = await this.settings.resolve('bakong_disbursement_token');
      if (!token) {
        return this.fail(payout.id, 'Bakong disbursement not configured (set bakong_disbursement_token)');
      }
      // Disbursement API is not yet wired to the bank rail — fail cleanly rather
      // than book money that never moved. Flip to a real call when the bank
      // provides the disbursement endpoint + account.
      return this.fail(payout.id, 'Bakong disbursement rail not yet enabled');
    } catch (err) {
      this.logger.error(`payout ${payout.id} execution error: ${err}`);
      return this.fail(payout.id, String(err));
    }
  }

  private async settle(payoutId: string, providerRef: string) {
    const p = await this.prisma.payout.update({
      where: { id: payoutId },
      data: { status: 'PAID', paidAt: new Date(), providerRef },
    });
    this.logger.log(`payout ${payoutId} settled (${p.amount.toFixed(2)} ${p.currency})`);
    return this.view(p);
  }

  private async fail(payoutId: string, reason: string) {
    const p = await this.prisma.payout.update({
      where: { id: payoutId },
      data: { status: 'FAILED', failureReason: reason },
    });
    void this.alerts.critical('Payout failed', `Payout ${payoutId} for store ${p.storeId} (${p.amount.toFixed(2)} ${p.currency}) failed: ${reason}`);
    this.logger.warn(`payout ${payoutId} failed: ${reason}`);
    return this.view(p);
  }

  /** Recent payouts across all merchants, newest first. */
  async history(limit = 100) {
    const rows = await this.prisma.payout.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { store: { include: { organization: true } } },
    });
    return rows.map((p) => this.view(p, p.store?.name, p.store?.organization?.name));
  }

  private view(p: { id: string; storeId: string; currency: string; amount: Prisma.Decimal; status: PayoutStatus; method: PayoutMethod; providerRef: string | null; note: string | null; failureReason: string | null; createdAt: Date; paidAt: Date | null }, store?: string, merchant?: string) {
    return {
      id: p.id,
      store_id: p.storeId,
      store: store ?? p.storeId,
      merchant: merchant ?? '',
      currency: p.currency,
      amount: p.amount.toFixed(2),
      status: p.status.toLowerCase(),
      method: p.method.toLowerCase(),
      provider_ref: p.providerRef,
      note: p.note,
      failure_reason: p.failureReason,
      created_at: p.createdAt.toISOString(),
      paid_at: p.paidAt?.toISOString() ?? null,
    };
  }
}
