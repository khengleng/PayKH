import { Global, Injectable, Module } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';

/** How long a key is honoured for replay. Matches the payments implementation. */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotentResult<T> {
  resource: T;
  status: number;
}

export interface IdempotentExecuteOptions<T> {
  /** Tenant scope. Two stores may use the same key without colliding. */
  scopeId: string;
  /**
   * Namespace for the key. Include anything that must not share a replay
   * namespace — notably the key mode, so a test-mode key cannot replay a
   * live-mode resource within one store.
   */
  endpoint: string;
  /** The client's Idempotency-Key. Omitted → `run` executes with no replay protection. */
  key: string | undefined;
  /** Raw request body, hashed to detect a key reused with different content. */
  rawBody: string;
  ttlMs?: number;
  /**
   * The work to perform. Receives the transaction the idempotency record is
   * written in, so the record and the effect commit together — a rollback must
   * never leave a key claiming a result that was never produced.
   */
  run: (tx: Prisma.TransactionClient) => Promise<IdempotentResult<T>>;
}

/**
 * Idempotency for value-bearing write APIs (spec §25).
 *
 * Lifted out of PaymentsService, which had this logic inline and duplicated
 * across create and refund. Every endpoint that issues or redeems value needs
 * the same contract, and PayChain's retry semantics depend on it: a retried
 * submission must return the original result rather than move value twice.
 *
 * The guarantee rests on the unique index on
 * (storeId, endpoint, idempotencyKey) — not on the pre-check. The pre-check is
 * only a fast path; two concurrent requests can both pass it, and the loser's
 * insert then violates the constraint, rolls its transaction back, and replays
 * the winner's stored response.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute<T>(opts: IdempotentExecuteOptions<T>): Promise<IdempotentResult<T> & { replayed: boolean }> {
    const { scopeId, endpoint, key, rawBody, run } = opts;

    // No key supplied: the caller accepts at-least-once semantics. Still run in
    // a transaction so `run`'s own writes stay atomic.
    if (!key) {
      const r = await this.prisma.$transaction((tx) => run(tx));
      return { ...r, replayed: false };
    }

    const requestHash = this.hashBody(rawBody);

    // Fast path: a completed request with this key.
    const prior = await this.find(scopeId, endpoint, key);
    if (prior) return { ...this.replay<T>(prior, requestHash), replayed: true };

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const r = await run(tx);
        await tx.idempotencyRecord.create({
          data: {
            storeId: scopeId,
            endpoint,
            idempotencyKey: key,
            requestHash,
            responseStatus: r.status,
            responseBody: r.resource as unknown as Prisma.InputJsonValue,
            expiresAt: new Date(Date.now() + (opts.ttlMs ?? DEFAULT_TTL_MS)),
          },
        });
        return r;
      });
      return { ...result, replayed: false };
    } catch (err) {
      // A concurrent request with the same key won the race. Our transaction —
      // including whatever `run` did — has rolled back, so replaying the
      // winner's response is correct rather than a second effect.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.find(scopeId, endpoint, key);
        if (winner) return { ...this.replay<T>(winner, requestHash), replayed: true };
      }
      throw err;
    }
  }

  private find(scopeId: string, endpoint: string, key: string) {
    return this.prisma.idempotencyRecord.findUnique({
      where: { storeId_endpoint_idempotencyKey: { storeId: scopeId, endpoint, idempotencyKey: key } },
    });
  }

  /** Replay a stored response, refusing if the key was reused for a different body. */
  private replay<T>(record: { requestHash: string; responseBody: unknown; responseStatus: number }, requestHash: string): IdempotentResult<T> {
    if (record.requestHash !== requestHash) {
      throw ApiError.idempotencyConflict('Idempotency-Key already used with a different request body');
    }
    return { resource: record.responseBody as T, status: record.responseStatus };
  }

  private hashBody(rawBody: string): string {
    return createHash('sha256').update(rawBody || '{}').digest('hex');
  }
}

// @Global with no auth dependency, mirroring SettingsCoreModule — any value
// module can inject it without creating a module cycle.
@Global()
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
