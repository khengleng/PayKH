import { ReconciliationService } from './reconciliation.service';
import { REDEMPTION_CANCELLED_REASON } from './ledger.service';

type Row = {
  id: string; storeId: string; customerId: string;
  type: 'EARN' | 'REDEEM' | 'ADJUST' | 'EXPIRE';
  points: number; reason?: string | null; status?: string;
};

/**
 * Build the service over a fixed sub-ledger. `findMany` emulates Prisma's
 * id-cursor pagination faithfully enough that the batching loop is the real
 * thing under test.
 */
function make(rows: Row[]) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ isPlatformAdmin: true }) },
    pointsTransaction: {
      findMany: jest.fn(({ take, cursor, skip, where }: { take: number; cursor?: { id: string }; skip?: number; where: { status: string } }) => {
        const all = rows.filter((r) => (r.status ?? 'CONFIRMED') === where.status).sort((a, b) => a.id.localeCompare(b.id));
        const start = cursor ? all.findIndex((r) => r.id === cursor.id) + (skip ?? 0) : 0;
        return Promise.resolve(all.slice(start, start + take));
      }),
    },
    ledgerEntry: { groupBy: jest.fn().mockResolvedValue([]) },
    customer: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const ledger = {
    ensureAccounts: jest.fn().mockResolvedValue(undefined),
    postPointsMovement: jest.fn().mockResolvedValue(undefined),
    pointsLiabilityFor: jest.fn().mockResolvedValue(0),
  };
  const svc = new ReconciliationService(prisma as never, ledger as never);
  return { svc, ledger, prisma };
}

const ADMIN = { userId: 'u1' } as never;
const callFor = (ledger: { postPointsMovement: jest.Mock }, id: string) =>
  ledger.postPointsMovement.mock.calls.find((c) => c[1] === id);

describe('ReconciliationService.backfillPoints', () => {
  it('replays each sub-ledger row with its own type and signed points', async () => {
    const { svc, ledger } = make([
      { id: 'p1', storeId: 's1', customerId: 'c1', type: 'EARN', points: 100 },
      { id: 'p2', storeId: 's1', customerId: 'c1', type: 'REDEEM', points: -40 },
      { id: 'p3', storeId: 's1', customerId: 'c2', type: 'EXPIRE', points: -10 },
    ]);
    const r = await svc.backfillPoints(ADMIN);
    expect(r.scanned).toBe(3);
    expect(r.posted).toBe(3);
    expect(callFor(ledger, 'p1')).toEqual(['EARN', 'p1', 's1', 'c1', 100]);
    expect(callFor(ledger, 'p2')).toEqual(['REDEEM', 'p2', 's1', 'c1', -40]);
    expect(callFor(ledger, 'p3')).toEqual(['EXPIRE', 'p3', 's1', 'c2', -10]);
  });

  it('maps a cancelled redemption to REDEEM_REVERSAL, matching the live path', async () => {
    // If this mapped to plain ADJUST it would post under `points.adjust` while
    // the live path posts `points.redeem_reversal` — two different idempotency
    // keys for one row, i.e. a double-count of the liability.
    const { svc, ledger } = make([
      { id: 'p1', storeId: 's1', customerId: 'c1', type: 'ADJUST', points: 40, reason: REDEMPTION_CANCELLED_REASON },
    ]);
    await svc.backfillPoints(ADMIN);
    expect(callFor(ledger, 'p1')![0]).toBe('REDEEM_REVERSAL');
  });

  it('leaves an ordinary adjust-up alone', async () => {
    const { svc, ledger } = make([
      { id: 'p1', storeId: 's1', customerId: 'c1', type: 'ADJUST', points: 40, reason: 'goodwill' },
    ]);
    await svc.backfillPoints(ADMIN);
    expect(callFor(ledger, 'p1')![0]).toBe('ADJUST');
  });

  it('does not mistake an adjust-DOWN for a cancelled redemption', async () => {
    const { svc, ledger } = make([
      { id: 'p1', storeId: 's1', customerId: 'c1', type: 'ADJUST', points: -40, reason: REDEMPTION_CANCELLED_REASON },
    ]);
    await svc.backfillPoints(ADMIN);
    expect(callFor(ledger, 'p1')![0]).toBe('ADJUST');
  });

  it('skips PENDING rows — only CONFIRMED points sit in the balance column', async () => {
    const { svc, ledger } = make([
      { id: 'p1', storeId: 's1', customerId: 'c1', type: 'EARN', points: 100, status: 'PENDING' },
      { id: 'p2', storeId: 's1', customerId: 'c1', type: 'EARN', points: 50 },
    ]);
    const r = await svc.backfillPoints(ADMIN);
    expect(r.scanned).toBe(1);
    expect(callFor(ledger, 'p1')).toBeUndefined();
    expect(callFor(ledger, 'p2')).toBeDefined();
  });

  it('pages past the batch size without dropping or repeating a row', async () => {
    const rows: Row[] = Array.from({ length: 1200 }, (_, i) => ({
      id: `p${String(i).padStart(5, '0')}`, storeId: 's1', customerId: `c${i}`, type: 'EARN' as const, points: 1,
    }));
    const { svc, ledger } = make(rows);
    const r = await svc.backfillPoints(ADMIN);
    expect(r.scanned).toBe(1200);
    expect(ledger.postPointsMovement).toHaveBeenCalledTimes(1200);
    expect(new Set(ledger.postPointsMovement.mock.calls.map((c) => c[1])).size).toBe(1200);
  });

  it('one failing row does not abort the repair', async () => {
    const { svc, ledger } = make([
      { id: 'p1', storeId: 's1', customerId: 'c1', type: 'EARN', points: 10 },
      { id: 'p2', storeId: 's1', customerId: 'c2', type: 'EARN', points: 20 },
      { id: 'p3', storeId: 's1', customerId: 'c3', type: 'EARN', points: 30 },
    ]);
    ledger.postPointsMovement.mockImplementation((_t, id: string) =>
      id === 'p2' ? Promise.reject(new Error('boom')) : Promise.resolve(undefined));
    const r = await svc.backfillPoints(ADMIN);
    expect(r.posted).toBe(2);
    expect(r.skipped).toBe(1);
    expect(callFor(ledger, 'p3')).toBeDefined();
  });

  it('reports the drift left after the repair', async () => {
    const { svc } = make([{ id: 'p1', storeId: 's1', customerId: 'c1', type: 'EARN', points: 10 }]);
    const r = await svc.backfillPoints(ADMIN);
    expect(r.drift_after).toMatchObject({ ok: true, drift_count: 0 });
  });

  it('refuses a non-admin', async () => {
    const { svc, prisma, ledger } = make([]);
    prisma.user.findUnique.mockResolvedValue({ isPlatformAdmin: false });
    await expect(svc.backfillPoints(ADMIN)).rejects.toThrow();
    expect(ledger.postPointsMovement).not.toHaveBeenCalled();
  });
});
