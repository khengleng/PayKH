import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { LedgerAccountType, Payment, Prisma } from '@prisma/client';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';

/** Chart of accounts. code → {name, type}. Normal balance follows type. */
export const CHART_OF_ACCOUNTS: { code: string; name: string; type: LedgerAccountType }[] = [
  { code: 'settlement_clearing', name: 'Settlement Clearing', type: 'ASSET' }, // funds received via rails, awaiting payout
  { code: 'merchant_payable', name: 'Merchant Payable', type: 'LIABILITY' }, // owed to merchants
  { code: 'fee_revenue', name: 'Platform Fee Revenue', type: 'REVENUE' },
  { code: 'commission_expense', name: 'Affiliate Commission Expense', type: 'EXPENSE' },
  { code: 'commission_payable', name: 'Affiliate Commission Payable', type: 'LIABILITY' },
];

type Line = { accountCode: string; direction: 'DEBIT' | 'CREDIT'; amount: Prisma.Decimal };

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

@Injectable()
export class LedgerService implements OnModuleInit {
  private readonly logger = new Logger('Ledger');

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureAccounts();
  }

  /** Idempotently seed the chart of accounts. */
  async ensureAccounts() {
    for (const a of CHART_OF_ACCOUNTS) {
      await this.prisma.ledgerAccount.upsert({ where: { code: a.code }, create: a, update: { name: a.name, type: a.type } });
    }
  }

  /**
   * Post a balanced journal atomically. Enforces debits == credits per currency
   * and idempotency on (event, reference) — a duplicate event is a no-op. This
   * is the ONLY write path; entries are never updated or deleted.
   */
  async post(event: string, reference: string | null, storeId: string | null, currency: string, lines: Line[]): Promise<void> {
    const debits = lines.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s.add(l.amount), D(0));
    const credits = lines.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s.add(l.amount), D(0));
    if (!debits.equals(credits)) {
      throw ApiError.internal(`Unbalanced journal ${event}/${reference}: DR ${debits.toFixed(4)} != CR ${credits.toFixed(4)}`);
    }
    if (debits.lte(0)) return; // nothing to post

    try {
      await this.prisma.journalEntry.create({
        data: {
          id: prefixedId('jrn'),
          event,
          reference,
          storeId,
          currency,
          lines: {
            create: lines.map((l) => ({ id: prefixedId('led'), accountCode: l.accountCode, storeId, direction: l.direction, amount: l.amount, currency })),
          },
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return; // already posted (idempotent)
      throw e;
    }
  }

  // ------------------------------------------------------------- postings
  /** Payment captured: DR clearing (gross); CR merchant payable (net) + fee revenue. */
  async postPaymentCaptured(payment: Payment, feeBps: number): Promise<void> {
    const gross = D(payment.amount);
    const fee = gross.mul(feeBps).div(10_000);
    const net = gross.minus(fee);
    await this.post('payment.captured', payment.id, payment.storeId, payment.currency, [
      { accountCode: 'settlement_clearing', direction: 'DEBIT', amount: gross },
      { accountCode: 'merchant_payable', direction: 'CREDIT', amount: net },
      { accountCode: 'fee_revenue', direction: 'CREDIT', amount: fee },
    ]);
  }

  /**
   * Refund: reverse a proportional slice. CR clearing (R); DR merchant payable
   * (net portion) + fee revenue (fee portion). `reference` includes the running
   * refunded total so successive partial refunds each post a distinct journal.
   */
  async postRefund(payment: Payment, refundAmount: Prisma.Decimal, feeBps: number, refundRef: string): Promise<void> {
    const r = D(refundAmount);
    const feePortion = r.mul(feeBps).div(10_000);
    const netPortion = r.minus(feePortion);
    await this.post('payment.refunded', `${payment.id}:${refundRef}`, payment.storeId, payment.currency, [
      { accountCode: 'merchant_payable', direction: 'DEBIT', amount: netPortion },
      { accountCode: 'fee_revenue', direction: 'DEBIT', amount: feePortion },
      { accountCode: 'settlement_clearing', direction: 'CREDIT', amount: r },
    ]);
  }

  /** Commission accrued: DR expense; CR commission payable. */
  async postCommissionAccrued(commissionId: string, storeId: string, currency: string, amount: Prisma.Decimal): Promise<void> {
    await this.post('commission.accrued', commissionId, storeId, currency, [
      { accountCode: 'commission_expense', direction: 'DEBIT', amount: D(amount) },
      { accountCode: 'commission_payable', direction: 'CREDIT', amount: D(amount) },
    ]);
  }

  /** Merchant payout: DR merchant payable; CR clearing (cash paid out to merchant). */
  async postPayout(storeId: string, currency: string, amount: Prisma.Decimal, ref: string): Promise<void> {
    await this.post('payout', `${storeId}:${ref}`, storeId, currency, [
      { accountCode: 'merchant_payable', direction: 'DEBIT', amount: D(amount) },
      { accountCode: 'settlement_clearing', direction: 'CREDIT', amount: D(amount) },
    ]);
  }

  /** Commission paid out: DR commission payable; CR clearing (cash out). */
  async postCommissionPaid(commissionId: string, storeId: string, currency: string, amount: Prisma.Decimal): Promise<void> {
    await this.post('commission.paid', commissionId, storeId, currency, [
      { accountCode: 'commission_payable', direction: 'DEBIT', amount: D(amount) },
      { accountCode: 'settlement_clearing', direction: 'CREDIT', amount: D(amount) },
    ]);
  }
}
