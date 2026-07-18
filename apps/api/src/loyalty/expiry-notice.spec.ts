import { Prisma } from '@prisma/client';
import { LoyaltyService } from './loyalty.service';

type Txn = { points: number; createdAt: Date; status?: string };
type Cust = { id: string; name?: string | null; email?: string | null; pointsBalance: number };

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const p2002 = () => new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '5' });

function make(opts: {
  customers: Cust[];
  txnsByCustomer: Record<string, Txn[]>;
  expiryMonths?: number | null;
  expiryWarnDays?: number;
  active?: boolean;
}) {
  const notices: { customerId: string; expiresOn: Date; points: number }[] = [];
  const client = {
    loyaltyProgram: {
      findUnique: jest.fn().mockResolvedValue({
        active: opts.active ?? true,
        expiryMonths: opts.expiryMonths === undefined ? 12 : opts.expiryMonths,
        expiryWarnDays: opts.expiryWarnDays ?? 14,
      }),
    },
    store: { findUnique: jest.fn().mockResolvedValue({ id: 's1', name: 'Acme', branding: { displayName: 'Acme Coffee' } }) },
    customer: {
      findMany: jest.fn(() => Promise.resolve(opts.customers.filter((c) => c.pointsBalance > 0 && c.email))),
    },
    pointsTransaction: {
      findMany: jest.fn(({ where }: { where: { customerId: string } }) =>
        Promise.resolve((opts.txnsByCustomer[where.customerId] ?? []).filter((t) => (t.status ?? 'CONFIRMED') === 'CONFIRMED')),
      ),
    },
    pointsExpiryNotice: {
      create: jest.fn(({ data }: { data: { customerId: string; expiresOn: Date; points: number } }) => {
        // Real unique index on (customerId, expiresOn).
        if (notices.some((n) => n.customerId === data.customerId && n.expiresOn.getTime() === data.expiresOn.getTime())) {
          return Promise.reject(p2002());
        }
        notices.push(data);
        return Promise.resolve(data);
      }),
    },
  };
  const email = { send: jest.fn().mockResolvedValue(undefined) };
  const svc = new LoyaltyService(client as never, {} as never, {} as never, {} as never, email as never, { resolve: async () => null } as never, {} as never);
  return { svc, email, notices, client };
}

describe('LoyaltyService.notifyExpiringForStore', () => {
  it('warns about points crossing the window within the warn period', async () => {
    // 12mo window, 14d warning: earned ~355d ago -> expires in ~10d.
    const { svc, email } = make({
      customers: [{ id: 'c1', name: 'Ana', email: 'ana@example.com', pointsBalance: 100 }],
      txnsByCustomer: { c1: [{ points: 100, createdAt: daysAgo(355) }] },
    });
    const r = await svc.notifyExpiringForStore('s1');
    expect(r).toEqual({ notified: 1, points: 100 });
    expect(email.send).toHaveBeenCalledTimes(1);
    const msg = email.send.mock.calls[0][0];
    expect(msg.to).toBe('ana@example.com');
    expect(msg.subject).toMatch(/100 points expiring on \d{4}-\d{2}-\d{2}/);
    expect(msg.html).toContain('Acme Coffee'); // the store's brand, not "PayKH"
  });

  it('stays quiet for points that are not near the window yet', async () => {
    const { svc, email } = make({
      customers: [{ id: 'c1', email: 'a@b.c', pointsBalance: 100 }],
      txnsByCustomer: { c1: [{ points: 100, createdAt: daysAgo(30) }] },
    });
    expect(await svc.notifyExpiringForStore('s1')).toEqual({ notified: 0, points: 0 });
    expect(email.send).not.toHaveBeenCalled();
  });

  it('does not email the same customer again the next day', async () => {
    // The job runs daily and recomputes the same batch; without the notice row
    // the customer would be emailed every morning until their points died.
    const m = make({
      customers: [{ id: 'c1', email: 'a@b.c', pointsBalance: 100 }],
      txnsByCustomer: { c1: [{ points: 100, createdAt: daysAgo(355) }] },
    });
    expect((await m.svc.notifyExpiringForStore('s1')).notified).toBe(1);
    expect((await m.svc.notifyExpiringForStore('s1')).notified).toBe(0);
    expect((await m.svc.notifyExpiringForStore('s1')).notified).toBe(0);
    expect(m.email.send).toHaveBeenCalledTimes(1);
    expect(m.notices).toHaveLength(1);
  });

  it('agrees with expiry under FIFO — no warning about points a redemption already consumed', async () => {
    // The failure that would matter most: telling someone points are expiring
    // when the expiry job will correctly expire nothing.
    const { svc, email } = make({
      customers: [{ id: 'c1', email: 'a@b.c', pointsBalance: 50 }],
      txnsByCustomer: {
        c1: [
          { points: 100, createdAt: daysAgo(355) },
          { points: 50, createdAt: daysAgo(10) },
          { points: -100, createdAt: daysAgo(5) },
        ],
      },
    });
    expect((await svc.notifyExpiringForStore('s1')).points).toBe(0);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('warns only about the unconsumed remainder', async () => {
    const { svc } = make({
      customers: [{ id: 'c1', email: 'a@b.c', pointsBalance: 70 }],
      txnsByCustomer: {
        c1: [
          { points: 100, createdAt: daysAgo(355) },
          { points: 30, createdAt: daysAgo(10) },
          { points: -60, createdAt: daysAgo(5) },
        ],
      },
    });
    expect((await svc.notifyExpiringForStore('s1')).points).toBe(40);
  });

  it('never warns about more than the customer holds', async () => {
    const { svc } = make({
      customers: [{ id: 'c1', email: 'a@b.c', pointsBalance: 20 }],
      txnsByCustomer: { c1: [{ points: 100, createdAt: daysAgo(355) }, { points: -80, createdAt: daysAgo(1) }] },
    });
    expect((await svc.notifyExpiringForStore('s1')).points).toBe(20);
  });

  it('skips customers with no email rather than failing the batch', async () => {
    const { svc, email } = make({
      customers: [
        { id: 'c1', email: null, pointsBalance: 100 },
        { id: 'c2', email: 'b@c.d', pointsBalance: 100 },
      ],
      txnsByCustomer: {
        c1: [{ points: 100, createdAt: daysAgo(355) }],
        c2: [{ points: 100, createdAt: daysAgo(355) }],
      },
    });
    expect((await svc.notifyExpiringForStore('s1')).notified).toBe(1);
    expect(email.send.mock.calls[0][0].to).toBe('b@c.d');
  });

  it('one customer failing does not strand the rest of the batch', async () => {
    const m = make({
      customers: [
        { id: 'c1', email: 'a@b.c', pointsBalance: 100 },
        { id: 'c2', email: 'b@c.d', pointsBalance: 100 },
      ],
      txnsByCustomer: {
        c1: [{ points: 100, createdAt: daysAgo(355) }],
        c2: [{ points: 100, createdAt: daysAgo(355) }],
      },
    });
    m.email.send.mockRejectedValueOnce(new Error('resend down'));
    expect((await m.svc.notifyExpiringForStore('s1')).notified).toBe(1); // c2 still got theirs
  });

  it('does nothing when the program has no expiry window', async () => {
    const { svc, email } = make({
      customers: [{ id: 'c1', email: 'a@b.c', pointsBalance: 100 }],
      txnsByCustomer: { c1: [{ points: 100, createdAt: daysAgo(999) }] },
      expiryMonths: null,
    });
    expect(await svc.notifyExpiringForStore('s1')).toEqual({ notified: 0, points: 0 });
    expect(email.send).not.toHaveBeenCalled();
  });

  it('does not warn about points that are ALREADY past expiry', async () => {
    // The expiry job takes these today. Emailing "expiring on <a date last
    // month>" is worse than saying nothing.
    const { svc, email } = make({
      customers: [{ id: 'c1', email: 'a@b.c', pointsBalance: 100 }],
      txnsByCustomer: { c1: [{ points: 100, createdAt: daysAgo(400) }] },
    });
    expect(await svc.notifyExpiringForStore('s1')).toEqual({ notified: 0, points: 0 });
    expect(email.send).not.toHaveBeenCalled();
  });

  it('warns only about the not-yet-due portion when a customer has both', async () => {
    const { svc } = make({
      customers: [{ id: 'c1', email: 'a@b.c', pointsBalance: 150 }],
      txnsByCustomer: {
        c1: [
          { points: 100, createdAt: daysAgo(400) }, // already due — expiry job's job
          { points: 50, createdAt: daysAgo(355) },  // due in ~10d — warn about this
        ],
      },
    });
    expect((await svc.notifyExpiringForStore('s1')).points).toBe(50);
  });

  it('dates the notice in the future, never the past', async () => {
    const { svc, notices } = make({
      customers: [{ id: 'c1', email: 'a@b.c', pointsBalance: 100 }],
      txnsByCustomer: { c1: [{ points: 100, createdAt: daysAgo(355) }] },
    });
    await svc.notifyExpiringForStore('s1');
    expect(notices[0].expiresOn.getTime()).toBeGreaterThan(Date.now() - 86_400_000);
  });

  it('honours a longer warn window', async () => {
    // 60d warning catches points that a 14d window would not mention yet.
    const short = make({
      customers: [{ id: 'c1', email: 'a@b.c', pointsBalance: 100 }],
      txnsByCustomer: { c1: [{ points: 100, createdAt: daysAgo(320) }] },
      expiryWarnDays: 14,
    });
    expect((await short.svc.notifyExpiringForStore('s1')).notified).toBe(0);

    const long = make({
      customers: [{ id: 'c1', email: 'a@b.c', pointsBalance: 100 }],
      txnsByCustomer: { c1: [{ points: 100, createdAt: daysAgo(320) }] },
      expiryWarnDays: 60,
    });
    expect((await long.svc.notifyExpiringForStore('s1')).notified).toBe(1);
  });
});
