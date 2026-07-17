import { LoyaltyService } from './loyalty.service';

type Txn = { points: number; createdAt: Date; status?: string };

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/**
 * Build a LoyaltyService over one customer's transaction history.
 * The prisma double runs the callback with itself as `tx`, so the real
 * expiry arithmetic executes against these rows.
 */
function make(opts: { balance: number; txns: Txn[]; expiryMonths?: number | null; active?: boolean }) {
  const state = { balance: opts.balance };
  const written: { type: string; points: number }[] = [];
  const posted: { type: string; points: number }[] = [];

  const client = {
    loyaltyProgram: {
      findUnique: jest.fn().mockResolvedValue(
        opts.expiryMonths === undefined
          ? { active: true, expiryMonths: 12 }
          : { active: opts.active ?? true, expiryMonths: opts.expiryMonths },
      ),
    },
    customer: {
      findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]),
      findUnique: jest.fn(() => Promise.resolve({ id: 'c1', storeId: 's1', pointsBalance: state.balance })),
      update: jest.fn(({ data }: { data: { pointsBalance: number } }) => {
        state.balance = data.pointsBalance;
        return Promise.resolve({ pointsBalance: state.balance });
      }),
    },
    pointsTransaction: {
      findMany: jest.fn(() => Promise.resolve(opts.txns.filter((t) => (t.status ?? 'CONFIRMED') === 'CONFIRMED'))),
      create: jest.fn(({ data }: { data: { type: string; points: number } }) => {
        written.push({ type: data.type, points: data.points });
        // The EXPIRE row is itself consumption — feed it back so a second pass
        // sees it, exactly as the database would.
        opts.txns.push({ points: data.points, createdAt: new Date(), status: 'CONFIRMED' });
        return Promise.resolve(data);
      }),
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };
  const ledger = {
    postPointsMovement: jest.fn((type: string, _id: string, _s: string, _c: string, points: number) => {
      posted.push({ type, points });
      return Promise.resolve();
    }),
  };
  const svc = new LoyaltyService(client as never, {} as never, ledger as never, {} as never);
  return { svc, state, written, posted, client };
}

describe('LoyaltyService.expireForStore', () => {
  it('expires points earned before the window', async () => {
    const { svc, state, written } = make({ balance: 100, txns: [{ points: 100, createdAt: daysAgo(400) }] });
    const r = await svc.expireForStore('s1');
    expect(r).toEqual({ customers: 1, points: 100 });
    expect(state.balance).toBe(0);
    expect(written[0]).toEqual({ type: 'EXPIRE', points: -100 });
  });

  it('leaves points inside the window alone', async () => {
    const { svc, state } = make({ balance: 100, txns: [{ points: 100, createdAt: daysAgo(30) }] });
    expect(await svc.expireForStore('s1')).toEqual({ customers: 0, points: 0 });
    expect(state.balance).toBe(100);
  });

  it('expires only the aged portion of a mixed balance', async () => {
    const { svc, state } = make({
      balance: 150,
      txns: [{ points: 100, createdAt: daysAgo(400) }, { points: 50, createdAt: daysAgo(10) }],
    });
    const r = await svc.expireForStore('s1');
    expect(r.points).toBe(100);
    expect(state.balance).toBe(50); // the recent 50 survives
  });

  it('treats redemptions as consuming the OLDEST points first', async () => {
    // 100 old + 50 new, 100 already redeemed. Under FIFO the redemption ate the
    // old points, so nothing is left to expire — LIFO would wrongly expire 100
    // and hand the customer a balance of -50 worth of grief.
    const { svc, state } = make({
      balance: 50,
      txns: [
        { points: 100, createdAt: daysAgo(400) },
        { points: 50, createdAt: daysAgo(10) },
        { points: -100, createdAt: daysAgo(5) },
      ],
    });
    expect(await svc.expireForStore('s1')).toEqual({ customers: 0, points: 0 });
    expect(state.balance).toBe(50);
  });

  it('expires only what the redemption did not already consume', async () => {
    const { svc, state } = make({
      balance: 70,
      txns: [
        { points: 100, createdAt: daysAgo(400) },
        { points: 30, createdAt: daysAgo(10) },
        { points: -60, createdAt: daysAgo(5) },
      ],
    });
    const r = await svc.expireForStore('s1'); // 100 old - 60 consumed = 40 still old
    expect(r.points).toBe(40);
    expect(state.balance).toBe(30);
  });

  it('never expires more than the customer holds', async () => {
    // An adjust-down already took the balance below what age alone implies.
    const { svc, state } = make({
      balance: 20,
      txns: [{ points: 100, createdAt: daysAgo(400) }, { points: -80, createdAt: daysAgo(1) }],
    });
    const r = await svc.expireForStore('s1');
    expect(r.points).toBe(20);
    expect(state.balance).toBe(0); // never negative
  });

  it('is idempotent — a second pass expires nothing', async () => {
    // The EXPIRE row is itself consumption, so the arithmetic self-closes.
    const m = make({ balance: 100, txns: [{ points: 100, createdAt: daysAgo(400) }] });
    expect((await m.svc.expireForStore('s1')).points).toBe(100);
    expect((await m.svc.expireForStore('s1')).points).toBe(0);
    expect((await m.svc.expireForStore('s1')).points).toBe(0);
    expect(m.state.balance).toBe(0);
    expect(m.written).toHaveLength(1); // exactly one EXPIRE row, ever
  });

  it('posts the expiry to the ledger so liability drops with the balance', async () => {
    const { svc, posted } = make({ balance: 100, txns: [{ points: 100, createdAt: daysAgo(400) }] });
    await svc.expireForStore('s1');
    expect(posted).toEqual([{ type: 'EXPIRE', points: -100 }]);
  });

  it('ignores unconfirmed points rather than ageing out value that is not theirs yet', async () => {
    const { svc, state } = make({
      balance: 100,
      txns: [{ points: 100, createdAt: daysAgo(400), status: 'PENDING' }],
    });
    expect((await svc.expireForStore('s1')).points).toBe(0);
    expect(state.balance).toBe(100);
  });

  it('does nothing when the program has no expiry window', async () => {
    const { svc, state } = make({ balance: 100, txns: [{ points: 100, createdAt: daysAgo(999) }], expiryMonths: null });
    expect(await svc.expireForStore('s1')).toEqual({ customers: 0, points: 0 });
    expect(state.balance).toBe(100);
  });

  it('does nothing when the program is inactive', async () => {
    const { svc, state } = make({ balance: 100, txns: [{ points: 100, createdAt: daysAgo(999) }], expiryMonths: 12, active: false });
    expect(await svc.expireForStore('s1')).toEqual({ customers: 0, points: 0 });
    expect(state.balance).toBe(100);
  });

  it('does not decrement lifetimePoints, so expiry cannot demote a tier', async () => {
    const { svc, client } = make({ balance: 100, txns: [{ points: 100, createdAt: daysAgo(400) }] });
    await svc.expireForStore('s1');
    const updates = client.customer.update.mock.calls.map((c: [{ data: Record<string, unknown> }]) => c[0].data);
    expect(updates.every((d) => !('lifetimePoints' in d))).toBe(true);
  });
});
