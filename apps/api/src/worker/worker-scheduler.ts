import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  JOB_BILLING_SWEEP,
  JOB_EXPIRY_SWEEP,
  JOB_IDEMPOTENCY_CLEANUP,
  JOB_POINTS_EXPIRY,
  JOB_POINTS_EXPIRY_NOTICE,
  JOB_POINTS_RECONCILE,
  JOB_SETTLEMENT_SWEEP,
  JOB_STATUS_POLL,
  JOB_WEBHOOK_RECONCILE,
  QUEUE_MAINTENANCE,
} from '../queue/queue.constants';

/**
 * Registers the repeatable maintenance jobs when the worker boots. Uses stable
 * jobIds so repeated boots upsert rather than duplicate the schedules.
 */
@Injectable()
export class WorkerScheduler implements OnModuleInit {
  private readonly logger = new Logger('WorkerScheduler');

  constructor(@InjectQueue(QUEUE_MAINTENANCE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add(JOB_EXPIRY_SWEEP, {}, {
      repeat: { every: 60_000 },
      jobId: 'repeat:expiry-sweep',
      removeOnComplete: true,
      removeOnFail: true,
    });
    await this.queue.add(JOB_STATUS_POLL, {}, {
      repeat: { every: 20_000 },
      jobId: 'repeat:status-poll',
      removeOnComplete: true,
      removeOnFail: true,
    });
    await this.queue.add(JOB_IDEMPOTENCY_CLEANUP, {}, {
      repeat: { every: 3_600_000 },
      jobId: 'repeat:idempotency-cleanup',
      removeOnComplete: true,
      removeOnFail: true,
    });
    await this.queue.add(JOB_BILLING_SWEEP, {}, {
      repeat: { every: 300_000 }, // every 5 min: confirm payments, renew, dun
      jobId: 'repeat:billing-sweep',
      removeOnComplete: true,
      removeOnFail: true,
    });
    await this.queue.add(JOB_SETTLEMENT_SWEEP, {}, {
      repeat: { every: 3_600_000 }, // hourly: batch completed-day paid payments
      jobId: 'repeat:settlement-sweep',
      removeOnComplete: true,
      removeOnFail: true,
    });
    await this.queue.add(JOB_WEBHOOK_RECONCILE, {}, {
      repeat: { every: 120_000 }, // every 2 min: re-enqueue orphaned PENDING deliveries
      jobId: 'repeat:webhook-reconcile',
      removeOnComplete: true,
      removeOnFail: true,
    });
    await this.queue.add(JOB_POINTS_RECONCILE, {}, {
      repeat: { every: 900_000 }, // every 15 min: points column vs ledger drift
      jobId: 'repeat:points-reconcile',
      removeOnComplete: true,
      removeOnFail: true,
    });
    await this.queue.add(JOB_POINTS_EXPIRY, {}, {
      repeat: { every: 86_400_000 }, // daily: expiry is a date boundary, not a hot path
      jobId: 'repeat:points-expiry',
      removeOnComplete: true,
      removeOnFail: true,
    });
    await this.queue.add(JOB_POINTS_EXPIRY_NOTICE, {}, {
      repeat: { every: 86_400_000 }, // daily, and deduped per expiry date
      jobId: 'repeat:points-expiry-notice',
      removeOnComplete: true,
      removeOnFail: true,
    });
    this.logger.log('registered repeatable maintenance jobs');
  }
}
