import { Prisma } from '@prisma/client';
import { IdempotencyService } from './idempotency.module';

type Rec = { storeId: string; endpoint: string; idempotencyKey: string; requestHash: string; responseStatus: number; responseBody: unknown };

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5' });

/**
 * A prisma double with a real unique index on (storeId, endpoint, key) and a
 * transaction that actually rolls back on throw — the two behaviours the
 * service's correctness depends on.
 */
function make(seed: Rec[] = []) {
  const rows: Rec[] = [...seed];
  const key = (r: { storeId: string; endpoint: string; idempotencyKey: string }) => `${r.storeId}|${r.endpoint}|${r.idempotencyKey}`;
  const find = (w: { storeId: string; endpoint: string; idempotencyKey: string }) => rows.find((r) => key(r) === key(w)) ?? null;

  const client = {
    idempotencyRecord: {
      findUnique: jest.fn(({ where }: { where: { storeId_endpoint_idempotencyKey: { storeId: string; endpoint: string; idempotencyKey: string } } }) =>
        Promise.resolve(find(where.storeId_endpoint_idempotencyKey)),
      ),
      create: jest.fn(({ data }: { data: Rec }) => {
        if (find(data)) return Promise.reject(p2002()); // the unique index
        rows.push(data);
        return Promise.resolve(data);
      }),
    },
    // Rolls back only the rows THIS transaction wrote. Truncating the shared
    // array instead would let a loser's rollback delete the winner's row —
    // something a real transaction never does, and it would mask the very race
    // this suite exists to check.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const added: Rec[] = [];
      const scoped = {
        ...client,
        idempotencyRecord: {
          ...client.idempotencyRecord,
          create: async (args: { data: Rec }) => {
            const r = await client.idempotencyRecord.create(args);
            added.push(args.data);
            return r;
          },
        },
      };
      try {
        return await fn(scoped);
      } catch (e) {
        for (const a of added) {
          const i = rows.indexOf(a);
          if (i >= 0) rows.splice(i, 1);
        }
        throw e;
      }
    },
  };
  return { svc: new IdempotencyService(client as never), rows, client };
}

const base = { scopeId: 'st_1', endpoint: 'POST /v1/loyalty/redeem:TEST', rawBody: '{"points":10}' };

describe('IdempotencyService.execute', () => {
  it('runs the work and stores the response under the key', async () => {
    const { svc, rows } = make();
    const run = jest.fn().mockResolvedValue({ resource: { balance: 40 }, status: 200 });
    const r = await svc.execute({ ...base, key: 'k1', run });
    expect(r).toEqual({ resource: { balance: 40 }, status: 200, replayed: false });
    expect(run).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
  });

  it('replays the stored response without re-running the work', async () => {
    // The whole point: a retried redeem must not deduct the points twice.
    const { svc } = make();
    const run = jest.fn().mockResolvedValue({ resource: { balance: 40 }, status: 200 });
    await svc.execute({ ...base, key: 'k1', run });
    const second = await svc.execute({ ...base, key: 'k1', run });
    expect(second).toEqual({ resource: { balance: 40 }, status: 200, replayed: true });
    expect(run).toHaveBeenCalledTimes(1); // NOT twice
  });

  it('rejects a key reused with a different body', async () => {
    const { svc } = make();
    const run = jest.fn().mockResolvedValue({ resource: { balance: 40 }, status: 200 });
    await svc.execute({ ...base, key: 'k1', run });
    await expect(svc.execute({ ...base, key: 'k1', rawBody: '{"points":9999}', run })).rejects.toThrow(/different request body/);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not let one store replay another store’s key', async () => {
    const { svc } = make();
    const run = jest.fn().mockResolvedValue({ resource: { balance: 40 }, status: 200 });
    await svc.execute({ ...base, key: 'k1', run });
    const other = await svc.execute({ ...base, scopeId: 'st_2', key: 'k1', run });
    expect(other.replayed).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not let a test-mode key replay a live-mode result', async () => {
    // Mode is part of the endpoint namespace precisely to prevent this.
    const { svc } = make();
    const run = jest.fn().mockResolvedValue({ resource: { balance: 40 }, status: 200 });
    await svc.execute({ ...base, endpoint: 'POST /v1/loyalty/redeem:TEST', key: 'k1', run });
    const live = await svc.execute({ ...base, endpoint: 'POST /v1/loyalty/redeem:LIVE', key: 'k1', run });
    expect(live.replayed).toBe(false);
  });

  it('replays the winner when a concurrent request loses the unique-index race', async () => {
    // Both callers pass the pre-check; the loser's insert hits P2002, its
    // transaction rolls back, and it must return the winner's response rather
    // than surface an error or double-apply.
    const { svc, rows } = make();
    const run = jest
      .fn()
      .mockResolvedValueOnce({ resource: { balance: 40 }, status: 200 })
      .mockResolvedValueOnce({ resource: { balance: 30 }, status: 200 }); // would have double-deducted
    const [a, b] = await Promise.all([
      svc.execute({ ...base, key: 'race', run }),
      svc.execute({ ...base, key: 'race', run }),
    ]);
    expect(rows).toHaveLength(1); // exactly one effect recorded
    const replayed = [a, b].filter((r) => r.replayed);
    expect(replayed).toHaveLength(1);
    expect(a.resource).toEqual(b.resource); // both callers see the same answer
  });

  it('rolls the idempotency record back when the work throws', async () => {
    // A failed redeem must not burn the key — the client has to be able to retry.
    const { svc, rows } = make();
    const boom = jest.fn().mockRejectedValue(new Error('insufficient points'));
    await expect(svc.execute({ ...base, key: 'k1', run: boom })).rejects.toThrow(/insufficient/);
    expect(rows).toHaveLength(0);

    const ok = jest.fn().mockResolvedValue({ resource: { balance: 1 }, status: 200 });
    const retry = await svc.execute({ ...base, key: 'k1', run: ok });
    expect(retry.replayed).toBe(false);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('runs without replay protection when no key is supplied', async () => {
    const { svc, rows } = make();
    const run = jest.fn().mockResolvedValue({ resource: { balance: 40 }, status: 200 });
    await svc.execute({ ...base, key: undefined, run });
    await svc.execute({ ...base, key: undefined, run });
    expect(run).toHaveBeenCalledTimes(2); // at-least-once, by the caller's choice
    expect(rows).toHaveLength(0);
  });

  it('propagates a non-P2002 database error rather than masking it as a replay', async () => {
    const { svc, client } = make();
    client.idempotencyRecord.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('deadlock', { code: 'P2034', clientVersion: '5' }),
    );
    const run = jest.fn().mockResolvedValue({ resource: {}, status: 200 });
    await expect(svc.execute({ ...base, key: 'k1', run })).rejects.toThrow(/deadlock/);
  });

  it('preserves the status code across a replay', async () => {
    const { svc } = make();
    const run = jest.fn().mockResolvedValue({ resource: { id: 'p1' }, status: 201 });
    await svc.execute({ ...base, key: 'k1', run });
    const again = await svc.execute({ ...base, key: 'k1', run });
    expect(again.status).toBe(201);
  });
});
