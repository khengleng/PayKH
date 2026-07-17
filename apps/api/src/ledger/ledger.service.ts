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
  { code: 'subscription_revenue', name: 'Platform Subscription Revenue', type: 'REVENUE' },
  { code: 'commission_expense', name: 'Affiliate Commission Expense', type: 'EXPENSE' },
  { code: 'commission_payable', name: 'Affiliate Commission Payable', type: 'LIABILITY' },
  // Loyalty points. Issuing points creates a real obligation to the customer,
  // so they are a liability like merchant payables — not a counter.
  { code: 'points_liability', name: 'Loyalty Points Liability', type: 'LIABILITY' }, // points owed to customers
  { code: 'points_expense', name: 'Loyalty Points Expense', type: 'EXPENSE' }, // cost of issuing points
  { code: 'points_settled', name: 'Loyalty Points Settled', type: 'REVENUE' }, // obligation discharged by a redemption
  { code: 'points_breakage', name: 'Loyalty Points Breakage', type: 'REVENUE' }, // obligation released unredeemed (expiry / write-down)
];

/** The ledger currency for loyalty points. Points are whole units, not money. */
export const POINTS_CURRENCY = 'PTS';

type Line = { accountCode: string; direction: 'DEBIT' | 'CREDIT'; amount: Prisma.Decimal; customerId?: string };

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
  async post(event: string, reference: string | null, storeId: string | null, currency: string, lines: Line[], client: Prisma.TransactionClient = this.prisma): Promise<void> {
    // Round every line to the ledger column scale (4dp) FIRST, then assert
    // balance on the rounded values — otherwise a fee whose 5th decimal is an
    // exact half can round each line the same direction and persist a journal
    // that no longer sums to zero (hidden under reconciliation's tolerance).
    const rounded = lines.map((l) => ({ ...l, amount: l.amount.toDecimalPlaces(4) }));
    const debits = rounded.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s.add(l.amount), D(0));
    const credits = rounded.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s.add(l.amount), D(0));
    if (!debits.equals(credits)) {
      throw ApiError.internal(`Unbalanced journal ${event}/${reference}: DR ${debits.toFixed(4)} != CR ${credits.toFixed(4)}`);
    }
    if (debits.lte(0)) return; // nothing to post

    try {
      await client.journalEntry.create({
        data: {
          id: prefixedId('jrn'),
          event,
          reference,
          storeId,
          currency,
          lines: {
            create: rounded.map((l) => ({ id: prefixedId('led'), accountCode: l.accountCode, storeId, customerId: l.customerId ?? null, direction: l.direction, amount: l.amount, currency })),
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

  /**
   * Subscription invoice collected: DR clearing (cash received via the platform
   * KHQR); CR subscription revenue. Platform-level (no merchant store), keyed on
   * the invoice id for idempotency.
   */
  async postSubscriptionCollected(invoiceId: string, currency: string, amount: Prisma.Decimal): Promise<void> {
    await this.post('subscription.collected', invoiceId, null, currency, [
      { accountCode: 'settlement_clearing', direction: 'DEBIT', amount: D(amount) },
      { accountCode: 'subscription_revenue', direction: 'CREDIT', amount: D(amount) },
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
  async postPayout(storeId: string, currency: string, amount: Prisma.Decimal, ref: string, client: Prisma.TransactionClient = this.prisma): Promise<void> {
    await this.post('payout', `${storeId}:${ref}`, storeId, currency, [
      { accountCode: 'merchant_payable', direction: 'DEBIT', amount: D(amount) },
      { accountCode: 'settlement_clearing', direction: 'CREDIT', amount: D(amount) },
    ], client);
  }

  /** Commission paid out: DR commission payable; CR clearing (cash out). */
  async postCommissionPaid(commissionId: string, storeId: string, currency: string, amount: Prisma.Decimal): Promise<void> {
    await this.post('commission.paid', commissionId, storeId, currency, [
      { accountCode: 'commission_payable', direction: 'DEBIT', amount: D(amount) },
      { accountCode: 'settlement_clearing', direction: 'CREDIT', amount: D(amount) },
    ]);
  }

  // -------------------------------------------------------- loyalty points
  /**
   * Post the points half of a loyalty movement. `pointsTxnId` is the sub-ledger
   * row this mirrors, and (event, pointsTxnId) is what makes the posting
   * idempotent — so a retried earn cannot inflate the liability.
   *
   * `points` is signed exactly as PointsTransaction.points is: positive adds to
   * the customer's balance, negative removes. The direction on points_liability
   * follows from the sign, and the contra account follows from *why*:
   *
   *   earn / adjust-up   DR points_expense    CR points_liability
   *   redeem             DR points_liability  CR points_settled    (obligation discharged for a reward)
   *   expire / adjust-dn DR points_liability  CR points_breakage   (obligation released unredeemed)
   *
   * Only the points_liability line carries `customerId`; the contra lines are
   * store-level. That keeps `pointsBalanceFor` a single-account filter and makes
   * the per-customer balances sum to the account balance by construction.
   */
  async postPointsMovement(
    type: 'EARN' | 'REDEEM' | 'ADJUST' | 'EXPIRE',
    pointsTxnId: string,
    storeId: string,
    customerId: string,
    points: number,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    if (points === 0) return;
    const magnitude = D(Math.abs(points));
    const increasesBalance = points > 0;

    // An ADJUST can go either way, so pick the contra account from the sign
    // rather than the type. EXPIRE and REDEEM both reduce, but for different
    // reasons, and conflating them would misstate breakage.
    const contra = increasesBalance ? 'points_expense' : type === 'REDEEM' ? 'points_settled' : 'points_breakage';

    const liabilityLine: Line = {
      accountCode: 'points_liability',
      direction: increasesBalance ? 'CREDIT' : 'DEBIT',
      amount: magnitude,
      customerId,
    };
    const contraLine: Line = {
      accountCode: contra,
      direction: increasesBalance ? 'DEBIT' : 'CREDIT',
      amount: magnitude,
    };

    await this.post(
      `points.${type.toLowerCase()}`,
      pointsTxnId,
      storeId,
      POINTS_CURRENCY,
      [liabilityLine, contraLine],
      client,
    );
  }

  /**
   * A customer's points balance as the ledger sees it: credits minus debits on
   * points_liability. This is the reconciliation counterpart to the denormalised
   * Customer.pointsBalance column and, later, to the PayChain balance.
   */
  async pointsBalanceFor(customerId: string): Promise<number> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['direction'],
      where: { customerId, accountCode: 'points_liability', currency: POINTS_CURRENCY },
      _sum: { amount: true },
    });
    return this.creditsMinusDebits(rows);
  }

  /** Total outstanding points liability for a store (or the platform if null). */
  async pointsLiabilityFor(storeId?: string): Promise<number> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['direction'],
      where: { accountCode: 'points_liability', currency: POINTS_CURRENCY, ...(storeId ? { storeId } : {}) },
      _sum: { amount: true },
    });
    return this.creditsMinusDebits(rows);
  }

  private creditsMinusDebits(rows: { direction: 'DEBIT' | 'CREDIT'; _sum: { amount: Prisma.Decimal | null } }[]): number {
    const sum = (dir: 'DEBIT' | 'CREDIT') => rows.find((r) => r.direction === dir)?._sum.amount ?? D(0);
    return sum('CREDIT').minus(sum('DEBIT')).toNumber();
  }
}
