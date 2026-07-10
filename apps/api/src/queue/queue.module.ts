import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { QUEUE_MAINTENANCE, QUEUE_WEBHOOK } from './queue.constants';

/**
 * Shared BullMQ wiring (Redis connection + queue registration). Imported by
 * both the HTTP API (produces jobs) and the worker (consumes jobs). Processors
 * live only in the worker's WorkerModule so the API never processes jobs.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('redisUrl');
        // BullMQ requires maxRetriesPerRequest = null on the shared connection.
        const connection = new IORedis(url ?? 'redis://localhost:6379', {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        });
        return { connection };
      },
    }),
    BullModule.registerQueue({ name: QUEUE_WEBHOOK }, { name: QUEUE_MAINTENANCE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
