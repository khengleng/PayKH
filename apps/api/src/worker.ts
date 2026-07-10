import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { validateConfig } from './config/configuration';
import { WorkerModule } from './worker/worker.module';

/**
 * Worker entrypoint. Boots the Nest application context (no HTTP listener) so
 * the BullMQ processors and repeatable-job scheduler start. Deployed as the
 * `worker` Railway service using the api image with start command
 * `node dist/worker.js`.
 */
async function bootstrap(): Promise<void> {
  const config = validateConfig();
  const logger = new Logger('Worker');

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.enableShutdownHooks();

  logger.log(`PayKH worker started (provider=${config.paymentProvider})`);

  const shutdown = async (signal: string) => {
    logger.log(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal worker bootstrap error', err);
  process.exit(1);
});
