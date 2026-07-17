import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { LedgerService, POINTS_CURRENCY } from './ledger.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const TOL = 0.005; // rounding tolerance for tie-outs

interface Break { check: string; currency?: string; expected: string; ledger: string; delta: string }

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger('Reconciliation');

  constructor(private readonly prisma: PrismaService, private readonly ledger: LedgerService) {}

  private async assertStore(user: AuthUser, storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, 'payment:read');
    return store;
  }
  private async assertAdmin(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u?.isPlatformAdmin) throw ApiError.forbidden('Platform admin access required');
  }

  // --------------------------------------------------------- trial balance
  /** Per-account, per-currency balances + the global debits==credits invariant. */
  async trialBalance(storeId?: string) {
    const where: Prisma.LedgerEntryWhereInput = storeId ? { storeId } : {};
    const [grouped, accounts] = await Promise.all([
      this.prisma.ledgerEntry.groupBy({ by: ['accountCode', 'direction', 'currency'], where, _sum: { amount: true } }),
      this.prisma.ledgerAccount.findMany(),
    ]);
    const typeOf = new Map(accounts.map((a) => [a.code, a.type]));
    // accountCode|currency -> {debit, credit}
    const acc = new Map<string, { code: string; currency: string; debit: Prisma.Decimal; credit: Prisma.Decimal }>();
    const totals = new Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>();
    for (const g of grouped) {
      const key = `${g.accountCode}|${g.currency}`;
      const row = acc.get(key) ?? { code: g.accountCode, currency: g.currency, debit: D(0), credit: D(0) };
      const sum = D(g._sum.amount ?? 0);
      if (g.direction === 'DEBIT') row.debit = row.debit.add(sum); else row.credit = row.credit.add(sum);
      acc.set(key, row);
      const t = totals.get(g.currency) ?? { debit: D(0), credit: D(0) };
      if (g.direction === 'DEBIT') t.debit = t.debit.add(sum); else t.credit = t.credit.add(sum);
      totals.set(g.currency, t);
    }
    const accounts_out = [...acc.values()].map((r) => {
      const type = typeOf.get(r.code);
      const debitNormal = type === 'ASSET' || type === 'EXPENSE';
      const balance = debitNormal ? r.debit.minus(r.credit) : r.credit.minus(r.debit);
      return { account: r.code, type, currency: r.currency, debit: r.debit.toFixed(2), credit: r.credit.toFixed(2), balance: balance.toFixed(2) };
    });
    const balances = [...totals.entries()].map(([currency, t]) => ({ currency, total_debit: t.debit.toFixed(2), total_credit: t.credit.toFixed(2), balanced: t.debit.minus(t.credit).abs().lte(TOL) }));
    return { accounts: accounts_out, currency_totals: balances, in_balance: balances.every((b) => b.balanced) };
  }

  async storeTrialBalance(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId);
    return this.trialBalance(storeId);
  }

  async adminTrialBalance(user: AuthUser) {
    await this.assertAdmin(user.userId);
    return this.trialBalance();
  }

  async journals(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId);
    const rows = await this.prisma.journalEntry.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' }, take: 100, include: { lines: true } });
    return rows.map((j) => ({
      id: j.id,
      event: j.event,
      reference: j.reference,
      currency: j.currency,
      created_at: j.createdAt.toISOString(),
      lines: j.lines.map((l) => ({ account: l.accountCode, direction: l.direction.toLowerCase(), amount: l.amount.toFixed(2) })),
    }));
  }

  // -------------------------------------------------------------- backfill
  /**
   * Post ledger journals for historical paid payments, refunds, and commissions
   * that predate the ledger (idempotent — safe to re-run). Platform admin only.
   */
  async backfill(user: AuthUser) {
    await this.assertAdmin(user.userId);
    await this.ledger.ensureAccounts();
    const stores = await this.prisma.store.findMany({ select: { id: true, feeBps: true } });
    const feeOf = new Map(stores.map((s) => [s.id, s.feeBps]));

    let payments = 0, refunds = 0, commissions = 0;
    const paid = await this.prisma.payment.findMany({ where: { status: 'PAID' }, select: { id: true, storeId: true, amount: true, currency: true, refundedAmount: true } });
    for (const p of paid) {
      const feeBps = feeOf.get(p.storeId) ?? 0;
      await this.ledger.postPaymentCaptured(p as never, feeBps);
      payments++;
      if (D(p.refundedAmount).gt(0)) {
        await this.ledger.postRefund(p as never, D(p.refundedAmount), feeBps, 'backfill');
        refunds++;
      }
    }
    const comm = await this.prisma.referralCommission.findMany();
    for (const c of comm) {
      if (['ACCRUED', 'HELD', 'PAID'].includes(c.status)) { await this.ledger.postCommissionAccrued(c.id, c.storeId, c.currency, c.amount); commissions++; }
      if (c.status === 'PAID') await this.ledger.postCommissionPaid(c.id, c.storeId, c.currency, c.amount);
    }
    let subscriptions = 0;
    const paidInvoices = await this.prisma.invoice.findMany({ where: { status: 'paid' }, select: { id: true, amountUsdCents: true } });
    for (const inv of paidInvoices) { await this.ledger.postSubscriptionCollected(inv.id, 'USD', D(inv.amountUsdCents).div(100)); subscriptions++; }
    this.logger.log(`ledger backfill: ${payments} payments, ${refunds} refunds, ${commissions} commissions, ${subscriptions} subscriptions`);
    return { payments, refunds, commissions, subscriptions };
  }

  // --------------------------------------------------------- reconciliation
  /**
   * Reconcile the ledger against source records. Runs four checks and returns
   * any breaks: (A) every journal balances, (B) the trial balance nets to zero
   * per currency, (C) every paid payment has a captured journal, (D) captured
   * gross ties to the source payment amounts (fee-independent).
   */
  async reconcile(user: AuthUser, storeId?: string) {
    if (storeId) await this.assertStore(user, storeId); else await this.assertAdmin(user.userId);
    const scope: Prisma.PaymentWhereInput = storeId ? { storeId } : {};
    const entryScope: Prisma.LedgerEntryWhereInput = storeId ? { storeId } : {};
    const breaks: Break[] = [];
    const checks: { id: string; label: string; ok: boolean; detail?: string }[] = [];

    // (A) journal integrity — every journal's lines net to zero
    const journals = await this.prisma.journalEntry.findMany({ where: storeId ? { storeId } : {}, include: { lines: true } });
    let unbalanced = 0;
    for (const j of journals) {
      const dr = j.lines.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s.add(l.amount), D(0));
      const cr = j.lines.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s.add(l.amount), D(0));
      if (dr.minus(cr).abs().gt(TOL)) unbalanced++;
    }
    checks.push({ id: 'journal_integrity', label: 'Every journal balances (DR = CR)', ok: unbalanced === 0, detail: `${journals.length} journals, ${unbalanced} unbalanced` });

    // (B) trial balance nets to zero per currency
    const tb = await this.trialBalance(storeId);
    checks.push({ id: 'trial_balance', label: 'Trial balance nets to zero per currency', ok: tb.in_balance });
    for (const c of tb.currency_totals) if (!c.balanced) breaks.push({ check: 'trial_balance', currency: c.currency, expected: c.total_debit, ledger: c.total_credit, delta: D(c.total_debit).minus(c.total_credit).toFixed(2) });

    // (C) coverage — every paid payment has a captured journal
    const paidCount = await this.prisma.payment.count({ where: { ...scope, status: 'PAID' } });
    const capturedRefs = await this.prisma.journalEntry.findMany({ where: { event: 'payment.captured', ...(storeId ? { storeId } : {}) }, select: { reference: true } });
    const capturedSet = new Set(capturedRefs.map((r) => r.reference));
    const paidIds = await this.prisma.payment.findMany({ where: { ...scope, status: 'PAID' }, select: { id: true } });
    const missing = paidIds.filter((p) => !capturedSet.has(p.id)).length;
    checks.push({ id: 'coverage', label: 'Every paid payment has a captured journal', ok: missing === 0, detail: `${paidCount} paid, ${missing} un-posted` });
    if (missing > 0) breaks.push({ check: 'coverage', expected: String(paidCount), ledger: String(paidCount - missing), delta: String(missing) });

    // (D) Gross-captured tie-out — fee-independent: the total money booked in
    // matches the gross of the payments actually captured. (Value tie-outs that
    // recompute fees are avoided since a store's fee can change over time; the
    // external tie-out to Bakong settlement files is the authoritative check.)
    const capturedIds = capturedRefs.map((r) => r.reference).filter((r): r is string => !!r);
    const capturedPayments = await this.prisma.payment.findMany({ where: { id: { in: capturedIds } }, select: { amount: true, currency: true } });
    const expGross = new Map<string, Prisma.Decimal>();
    for (const p of capturedPayments) expGross.set(p.currency, (expGross.get(p.currency) ?? D(0)).add(D(p.amount)));
    const clearingDebits = await this.prisma.ledgerEntry.groupBy({ by: ['currency'], where: { accountCode: 'settlement_clearing', direction: 'DEBIT', journal: { event: 'payment.captured' }, ...entryScope }, _sum: { amount: true } });
    const ledGross = new Map(clearingDebits.map((g) => [g.currency, D(g._sum.amount ?? 0)]));
    let grossOk = true;
    for (const cur of new Set<string>([...expGross.keys(), ...ledGross.keys()])) {
      const exp = expGross.get(cur) ?? D(0); const actual = ledGross.get(cur) ?? D(0);
      if (exp.minus(actual).abs().gt(TOL)) { grossOk = false; breaks.push({ check: 'gross_captured', currency: cur, expected: exp.toFixed(2), ledger: actual.toFixed(2), delta: exp.minus(actual).toFixed(2) }); }
    }
    checks.push({ id: 'gross_captured', label: 'Captured gross ties to source payment amounts', ok: grossOk });

    const balanced = checks.every((c) => c.ok);
    return { scope: storeId ?? 'platform', balanced, checks, breaks };
  }

  // -------------------------------------------------- loyalty points drift
  /**
   * Compare each customer's denormalised `Customer.pointsBalance` against the
   * points_liability position the ledger derives for them.
   *
   * These are written in one transaction, so a drift is never routine — it
   * means a balance moved without a journal (or vice versa), and it is the
   * signal that the two disagree BEFORE PayChain is added as a third opinion.
   * Spec §30 stages 3-6 (read-only comparison → dual-run → reconciliation) are
   * only meaningful if this is already clean.
   *
   * Points are whole units, so the tolerance is exact — unlike the money
   * tie-outs above, any non-zero delta is a real break.
   */
  async pointsDrift(storeId?: string) {
    const scope = storeId ? { storeId } : {};

    // Ledger view: credits minus debits on points_liability, per customer.
    const grouped = await this.prisma.ledgerEntry.groupBy({
      by: ['customerId', 'direction'],
      where: { accountCode: 'points_liability', currency: POINTS_CURRENCY, ...scope },
      _sum: { amount: true },
    });
    const ledgerByCustomer = new Map<string, number>();
    for (const g of grouped) {
      if (!g.customerId) continue;
      const signed = D(g._sum.amount ?? 0).toNumber() * (g.direction === 'CREDIT' ? 1 : -1);
      ledgerByCustomer.set(g.customerId, (ledgerByCustomer.get(g.customerId) ?? 0) + signed);
    }

    // Column view. Include zero-balance customers that the ledger knows about:
    // a customer whose column says 0 while the ledger says 100 is exactly the
    // kind of break this exists to catch, and filtering on `pointsBalance != 0`
    // would hide it.
    const customers = await this.prisma.customer.findMany({
      where: { OR: [{ pointsBalance: { not: 0 } }, { id: { in: [...ledgerByCustomer.keys()] } }], ...scope },
      select: { id: true, storeId: true, pointsBalance: true },
    });

    const drifted: { customer_id: string; store_id: string; column: number; ledger: number; delta: number }[] = [];
    for (const c of customers) {
      const ledger = ledgerByCustomer.get(c.id) ?? 0;
      if (ledger !== c.pointsBalance) {
        drifted.push({ customer_id: c.id, store_id: c.storeId, column: c.pointsBalance, ledger, delta: ledger - c.pointsBalance });
      }
    }

    const columnTotal = customers.reduce((s, c) => s + c.pointsBalance, 0);
    const ledgerTotal = await this.ledger.pointsLiabilityFor(storeId);

    return {
      scope: storeId ?? 'platform',
      ok: drifted.length === 0 && columnTotal === ledgerTotal,
      customers_checked: customers.length,
      liability_column: columnTotal,
      liability_ledger: ledgerTotal,
      liability_delta: ledgerTotal - columnTotal,
      drifted: drifted.slice(0, 50), // cap the payload; `drift_count` carries the truth
      drift_count: drifted.length,
    };
  }

  async storePointsDrift(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId);
    return this.pointsDrift(storeId);
  }

  async adminPointsDrift(user: AuthUser) {
    await this.assertAdmin(user.userId);
    return this.pointsDrift();
  }
}
