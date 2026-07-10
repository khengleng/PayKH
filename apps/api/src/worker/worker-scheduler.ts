import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  JOB_BILLING_SWEEP,
  JOB_EXPIRY_SWEEP,
  JOB_IDEMPOTENCY_CLEANUP,
  JOB_SETTLEMENT_SWEEP,
  JOB_STATUS_POLL,
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
    this.logger.log('registered repeatable maintenance jobs');
  }
}
