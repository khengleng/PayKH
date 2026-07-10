import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * A general-purpose Redis client (separate from the BullMQ connection) used for
 * rate limiting and metrics counters.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('redisUrl') ?? 'redis://localhost:6379';
        return new IORedis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false, lazyConnect: false });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
