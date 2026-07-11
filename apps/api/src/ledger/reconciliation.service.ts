import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { LedgerService } from './ledger.service';

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
    this.logger.log(`ledger backfill: ${payments} payments, ${refunds} refunds, ${commissions} commissions`);
    return { payments, refunds, commissions };
  }

  // --------------------------------------------------------- reconciliation
  /**
   * Reconcile the ledger against source records. Runs five checks and returns
   * any breaks: (A) every journal balances, (B) the trial balance nets to zero
   * per currency, (C) every paid payment has a captured journal, (D) fee revenue
   * ties to expected fees, (E) merchant payable ties to expected net owed.
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

    // Expected fee/net from source, per currency (fee rate is per store).
    const groups = await this.prisma.payment.groupBy({ by: ['storeId', 'currency'], where: { ...scope, status: 'PAID' }, _sum: { amount: true, refundedAmount: true } });
    const stores = await this.prisma.store.findMany({ where: storeId ? { id: storeId } : {}, select: { id: true, feeBps: true } });
    const feeOf = new Map(stores.map((s) => [s.id, s.feeBps]));
    const expFee = new Map<string, Prisma.Decimal>();
    const expPayable = new Map<string, Prisma.Decimal>();
    for (const g of groups) {
      const bps = feeOf.get(g.storeId) ?? 0;
      const base = D(g._sum.amount ?? 0).minus(D(g._sum.refundedAmount ?? 0));
      const fee = base.mul(bps).div(10_000);
      expFee.set(g.currency, (expFee.get(g.currency) ?? D(0)).add(fee));
      expPayable.set(g.currency, (expPayable.get(g.currency) ?? D(0)).add(base.minus(fee)));
    }

    // Ledger balances per account+currency (credit-normal accounts: credit - debit)
    const led = await this.prisma.ledgerEntry.groupBy({ by: ['accountCode', 'direction', 'currency'], where: entryScope, _sum: { amount: true } });
    const ledBal = (code: string, cur: string) => {
      let credit = D(0), debit = D(0);
      for (const g of led) if (g.accountCode === code && g.currency === cur) { if (g.direction === 'CREDIT') credit = credit.add(D(g._sum.amount ?? 0)); else debit = debit.add(D(g._sum.amount ?? 0)); }
      return credit.minus(debit);
    };
    const currencies = new Set<string>([...expFee.keys(), ...led.map((g) => g.currency)]);

    // (D) fee revenue tie-out
    let feeOk = true;
    for (const cur of currencies) {
      const exp = expFee.get(cur) ?? D(0); const actual = ledBal('fee_revenue', cur);
      if (exp.minus(actual).abs().gt(TOL)) { feeOk = false; breaks.push({ check: 'fee_revenue', currency: cur, expected: exp.toFixed(2), ledger: actual.toFixed(2), delta: exp.minus(actual).toFixed(2) }); }
    }
    checks.push({ id: 'fee_revenue', label: 'Fee revenue ties to expected fees', ok: feeOk });

    // (E) merchant payable tie-out
    let payOk = true;
    for (const cur of currencies) {
      const exp = expPayable.get(cur) ?? D(0); const actual = ledBal('merchant_payable', cur);
      if (exp.minus(actual).abs().gt(TOL)) { payOk = false; breaks.push({ check: 'merchant_payable', currency: cur, expected: exp.toFixed(2), ledger: actual.toFixed(2), delta: exp.minus(actual).toFixed(2) }); }
    }
    checks.push({ id: 'merchant_payable', label: 'Merchant payable ties to expected net owed', ok: payOk });

    const balanced = checks.every((c) => c.ok);
    return { scope: storeId ?? 'platform', balanced, checks, breaks };
  }
}
