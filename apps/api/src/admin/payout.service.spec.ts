import { Prisma } from '@prisma/client';
import { PayoutService } from './payout.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const user = { userId: 'u_admin' } as never;

/** Build a PayoutService with just enough of its collaborators mocked. */
function make(opts: { owedCredit: number; owedDebit: number; disbursementToken?: string }) {
  const created: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const prisma = {
    store: { findUnique: jest.fn().mockResolvedValue({ id: 's1', name: 'Store One' }) },
    ledgerEntry: {
      groupBy: jest.fn().mockResolvedValue([
        { direction: 'CREDIT', _sum: { amount: D(opts.owedCredit) } },
        { direction: 'DEBIT', _sum: { amount: D(opts.owedDebit) } },
      ]),
    },
    payout: {
      create: jest.fn().mockImplementation(({ data }) => {
        const row = { ...data, providerRef: null, note: data.note ?? null, failureReason: null, paidAt: null, createdAt: new Date(0) };
        created.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const base = created.find((c) => c.id === where.id) ?? {};
        const row = { ...base, ...data, amount: (base as { amount: Prisma.Decimal }).amount ?? D(0), currency: (base as { currency: string }).currency ?? 'USD', storeId: 's1' };
        updates.push(row);
        return Promise.resolve(row);
      }),
    },
    // The MANUAL path runs its critical section inside a $transaction; the mock
    // just invokes the callback with the same client (the advisory lock is a
    // raw no-op here).
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const ledger = { postPayout: jest.fn().mockResolvedValue(undefined) };
  const settings = { resolve: jest.fn().mockResolvedValue(opts.disbursementToken) };
  const alerts = { critical: jest.fn().mockResolvedValue(undefined) };
  const svc = new PayoutService(prisma as never, ledger as never, settings as never, alerts as never);
  return { svc, prisma, ledger, alerts, created, updates };
}

describe('PayoutService', () => {
  it('rejects a payout larger than the amount owed', async () => {
    const { svc, ledger } = make({ owedCredit: 100, owedDebit: 0 });
    await expect(svc.pay(user, 's1', 'USD', '150.00', 'MANUAL')).rejects.toThrow(/exceeds/i);
    expect(ledger.postPayout).not.toHaveBeenCalled();
  });

  it('settles a MANUAL payout and posts it to the ledger', async () => {
    const { svc, ledger } = make({ owedCredit: 149, owedDebit: 0 });
    const res = await svc.pay(user, 's1', 'USD', '149.00', 'MANUAL');
    expect(res.status).toBe('paid');
    expect(res.method).toBe('manual');
    expect(ledger.postPayout).toHaveBeenCalledTimes(1);
    expect(res.paid_at).not.toBeNull();
  });

  it('FAILS a BAKONG payout with no disbursement token and does NOT touch the ledger', async () => {
    const { svc, ledger, alerts } = make({ owedCredit: 149, owedDebit: 0 });
    const res = await svc.pay(user, 's1', 'USD', '50.00', 'BAKONG');
    expect(res.status).toBe('failed');
    expect(res.failure_reason).toMatch(/not configured/i);
    expect(ledger.postPayout).not.toHaveBeenCalled();
    expect(alerts.critical).toHaveBeenCalledTimes(1);
  });
});
