import { Prisma } from '@prisma/client';
import { ReconciliationService } from './reconciliation.service';

const D = (v: number) => new Prisma.Decimal(v);

type Entry = { customerId: string | null; direction: 'DEBIT' | 'CREDIT'; amount: number };
type Cust = { id: string; storeId: string; pointsBalance: number };

/**
 * Build the service over a fixed set of points_liability entries and customers.
 * groupBy is emulated faithfully enough that the sign/aggregation logic under
 * test is the real thing.
 */
function make(entries: Entry[], customers: Cust[]) {
  const prisma = {
    ledgerEntry: {
      groupBy: jest.fn(() => {
        const acc = new Map<string, Prisma.Decimal>();
        for (const e of entries) {
          const k = `${e.customerId}|${e.direction}`;
          acc.set(k, (acc.get(k) ?? D(0)).add(D(e.amount)));
        }
        return Promise.resolve(
          [...acc.entries()].map(([k, amount]) => {
            const [customerId, direction] = k.split('|');
            return { customerId: customerId === 'null' ? null : customerId, direction, _sum: { amount } };
          }),
        );
      }),
    },
    customer: {
      findMany: jest.fn(({ where }: { where: { OR: [{ pointsBalance: { not: number } }, { id: { in: string[] } }] } }) => {
        const known = new Set(where.OR[1].id.in);
        return Promise.resolve(customers.filter((c) => c.pointsBalance !== 0 || known.has(c.id)));
      }),
    },
  };
  const ledgerTotal = entries.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amount : -e.amount), 0);
  const ledger = { pointsLiabilityFor: jest.fn().mockResolvedValue(ledgerTotal) };
  return new ReconciliationService(prisma as never, ledger as never);
}

const earn = (customerId: string, amount: number): Entry => ({ customerId, direction: 'CREDIT', amount });
const redeem = (customerId: string, amount: number): Entry => ({ customerId, direction: 'DEBIT', amount });

describe('ReconciliationService.pointsDrift', () => {
  it('reports clean when every column matches the ledger', async () => {
    const svc = make(
      [earn('c1', 100), redeem('c1', 30), earn('c2', 50)],
      [
        { id: 'c1', storeId: 's1', pointsBalance: 70 },
        { id: 'c2', storeId: 's1', pointsBalance: 50 },
      ],
    );
    const r = await svc.pointsDrift();
    expect(r.ok).toBe(true);
    expect(r.drift_count).toBe(0);
    expect(r.liability_column).toBe(120);
    expect(r.liability_ledger).toBe(120);
  });

  it('catches a balance changed without a journal', async () => {
    // The classic break: someone wrote pointsBalance directly.
    const svc = make([earn('c1', 100)], [{ id: 'c1', storeId: 's1', pointsBalance: 150 }]);
    const r = await svc.pointsDrift();
    expect(r.ok).toBe(false);
    expect(r.drift_count).toBe(1);
    expect(r.drifted[0]).toMatchObject({ customer_id: 'c1', column: 150, ledger: 100, delta: -50 });
  });

  it('catches a journal with no value behind it', async () => {
    const svc = make([earn('c1', 100)], [{ id: 'c1', storeId: 's1', pointsBalance: 60 }]);
    const r = await svc.pointsDrift();
    expect(r.drifted[0]).toMatchObject({ column: 60, ledger: 100, delta: 40 });
  });

  it('catches a zero-balance customer the ledger still credits', async () => {
    // Filtering on `pointsBalance != 0` would hide exactly this — the customer
    // looks unremarkable while the ledger says the platform owes them 100.
    const svc = make([earn('c1', 100)], [{ id: 'c1', storeId: 's1', pointsBalance: 0 }]);
    const r = await svc.pointsDrift();
    expect(r.ok).toBe(false);
    expect(r.drifted[0]).toMatchObject({ customer_id: 'c1', column: 0, ledger: 100 });
  });

  it('catches a customer with a balance the ledger has never heard of', async () => {
    const svc = make([], [{ id: 'c1', storeId: 's1', pointsBalance: 25 }]);
    const r = await svc.pointsDrift();
    expect(r.ok).toBe(false);
    expect(r.drifted[0]).toMatchObject({ customer_id: 'c1', column: 25, ledger: 0, delta: -25 });
  });

  it('is exact — a single point of drift is a break, not rounding', async () => {
    // Unlike the money tie-outs, points are whole units: no tolerance applies.
    const svc = make([earn('c1', 100)], [{ id: 'c1', storeId: 's1', pointsBalance: 99 }]);
    expect((await svc.pointsDrift()).ok).toBe(false);
  });

  it('nets credits against debits per customer', async () => {
    const svc = make(
      [earn('c1', 500), earn('c1', 250), redeem('c1', 300), redeem('c1', 50)],
      [{ id: 'c1', storeId: 's1', pointsBalance: 400 }],
    );
    expect((await svc.pointsDrift()).ok).toBe(true);
  });

  it('does not attribute a store-level contra line to a customer', async () => {
    // Only points_liability lines carry customerId; contra lines are null and
    // must not be folded into anyone's balance.
    const svc = make(
      [earn('c1', 100), { customerId: null, direction: 'DEBIT', amount: 100 }],
      [{ id: 'c1', storeId: 's1', pointsBalance: 100 }],
    );
    const r = await svc.pointsDrift();
    expect(r.drift_count).toBe(0);
  });

  it('flags an aggregate liability mismatch even when no single customer drifts', async () => {
    // Two errors that cancel per-customer but not in total would otherwise pass.
    const svc = make([earn('c1', 100)], [{ id: 'c1', storeId: 's1', pointsBalance: 100 }]);
    // Force the aggregate to disagree with the per-customer sum.
    (svc as unknown as { ledger: { pointsLiabilityFor: jest.Mock } }).ledger.pointsLiabilityFor.mockResolvedValue(999);
    const r = await svc.pointsDrift();
    expect(r.ok).toBe(false);
    expect(r.liability_delta).toBe(899);
  });

  it('caps the payload but reports the true count', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, storeId: 's1', pointsBalance: 10 }));
    const r = await make([], many).pointsDrift();
    expect(r.drift_count).toBe(60);
    expect(r.drifted).toHaveLength(50);
  });
});
