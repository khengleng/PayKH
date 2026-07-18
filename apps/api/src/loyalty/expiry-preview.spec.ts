import { LoyaltyService } from './loyalty.service';

type Txn = { points: number; createdAt: Date; status?: string };
type Cust = { id: string; name?: string | null; email?: string | null; pointsBalance: number };

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const user = { userId: 'u1', memberships: [{ organizationId: 'org_1', role: 'owner' }] } as never;

function make(customers: Cust[], txnsByCustomer: Record<string, Txn[]>) {
  const client = {
    store: { findUnique: jest.fn().mockResolvedValue({ id: 's1', organizationId: 'org_1' }) },
    customer: { findMany: jest.fn(() => Promise.resolve(customers.filter((c) => c.pointsBalance > 0))) },
    pointsTransaction: {
      findMany: jest.fn(({ where }: { where: { customerId: string } }) =>
        Promise.resolve((txnsByCustomer[where.customerId] ?? []).filter((t) => (t.status ?? 'CONFIRMED') === 'CONFIRMED')),
      ),
    },
  };
  return new LoyaltyService(client as never, {} as never, {} as never, {} as never, {} as never, { resolve: async () => null } as never, {} as never);
}

describe('LoyaltyService.expiryPreview', () => {
  it('reports what a window would destroy today', async () => {
    const svc = make(
      [{ id: 'c1', name: 'Ana', pointsBalance: 100 }],
      { c1: [{ points: 100, createdAt: daysAgo(400) }] },
    );
    const r = await svc.expiryPreview(user, 's1', 12);
    expect(r.expires_immediately).toEqual({ customers: 1, points: 100 });
    expect(r.sample).toEqual([{ customer: 'Ana', points: 100 }]);
  });

  it('separates what dies today from what dies during the warn window', async () => {
    // The distinction the operator needs: the first group gets no warning.
    const svc = make(
      [{ id: 'c1', pointsBalance: 100 }, { id: 'c2', pointsBalance: 50 }],
      {
        c1: [{ points: 100, createdAt: daysAgo(400) }], // already past — no warning possible
        c2: [{ points: 50, createdAt: daysAgo(355) }],  // ~10 days out — will be warned
      },
    );
    const r = await svc.expiryPreview(user, 's1', 12);
    expect(r.expires_immediately).toEqual({ customers: 1, points: 100 });
    expect(r.expires_within_warn_window).toEqual({ customers: 1, points: 50, warn_days: 14 });
  });

  it('shows a shorter window destroying more — the whole point of previewing', async () => {
    const txns = { c1: [{ points: 100, createdAt: daysAgo(200) }] };
    const cust = [{ id: 'c1', pointsBalance: 100 }];
    expect((await make(cust, txns).expiryPreview(user, 's1', 12)).expires_immediately.points).toBe(0);
    expect((await make(cust, txns).expiryPreview(user, 's1', 3)).expires_immediately.points).toBe(100);
  });

  it('agrees with expiry under FIFO', async () => {
    // Must not scare an operator with points a redemption already consumed.
    const svc = make(
      [{ id: 'c1', pointsBalance: 50 }],
      {
        c1: [
          { points: 100, createdAt: daysAgo(400) },
          { points: 50, createdAt: daysAgo(10) },
          { points: -100, createdAt: daysAgo(5) },
        ],
      },
    );
    const r = await svc.expiryPreview(user, 's1', 12);
    expect(r.expires_immediately.points).toBe(0);
  });

  it('reports nothing when every point is inside the window', async () => {
    const svc = make([{ id: 'c1', pointsBalance: 100 }], { c1: [{ points: 100, createdAt: daysAgo(10) }] });
    const r = await svc.expiryPreview(user, 's1', 12);
    expect(r.expires_immediately.points).toBe(0);
    expect(r.sample).toEqual([]);
  });

  it('caps the sample at 10 but keeps the true customer count', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, pointsBalance: 10 }));
    const txns = Object.fromEntries(many.map((c) => [c.id, [{ points: 10, createdAt: daysAgo(400) }]]));
    const r = await make(many, txns).expiryPreview(user, 's1', 12);
    expect(r.expires_immediately).toEqual({ customers: 25, points: 250 });
    expect(r.sample).toHaveLength(10);
  });

  it('rejects a nonsense window rather than previewing garbage', async () => {
    const svc = make([], {});
    await expect(svc.expiryPreview(user, 's1', 0)).rejects.toThrow(/positive integer/);
    await expect(svc.expiryPreview(user, 's1', -3)).rejects.toThrow(/positive integer/);
    await expect(svc.expiryPreview(user, 's1', NaN)).rejects.toThrow(/positive integer/);
  });

  it('is read-only — previewing must never expire anything', async () => {
    const svc = make([{ id: 'c1', pointsBalance: 100 }], { c1: [{ points: 100, createdAt: daysAgo(400) }] });
    const client = (svc as unknown as { prisma: Record<string, unknown> }).prisma;
    await svc.expiryPreview(user, 's1', 12);
    // No write surface was even provided to the double; if the preview tried to
    // mutate, it would have thrown rather than silently expiring points.
    expect(client).not.toHaveProperty('pointsExpiryNotice');
    expect((client.customer as { update?: unknown }).update).toBeUndefined();
  });
});
