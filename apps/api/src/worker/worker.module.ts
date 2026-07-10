import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { loadConfig } from '../config/configuration';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { EmailModule } from '../email/email.module';
import { AuditModule } from '../audit/audit.module';
import { ProviderModule } from '../providers/provider.module';
import { QueueModule } from '../queue/queue.module';
import { RedisModule } from '../redis/redis.module';
import { RateLimitModule } from '../ratelimit/rate-limit.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PaymentsModule } from '../payments/payments.module';
import { BillingModule } from '../billing/billing.module';
import { SettlementsModule } from '../settlements/settlements.module';
import { BranchesModule } from '../branches/branches.module';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { MaintenanceProcessor } from './maintenance.processor';
import { WorkerScheduler } from './worker-scheduler';

/**
 * Root module for the background worker process. Reuses the same Prisma,
 * provider, webhook, and payments services as the API, but additionally
 * registers the BullMQ processors and the repeatable-job scheduler.
 *
 * Bootstrapped via NestFactory.createApplicationContext (no HTTP server).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [loadConfig] }),
    PrismaModule,
    CommonModule,
    EmailModule,
    AuditModule,
    ProviderModule,
    QueueModule,
    RedisModule,
    RateLimitModule,
    WebhooksModule,
    PaymentsModule,
    BillingModule,
    SettlementsModule,
    BranchesModule,
  ],
  providers: [WebhookDeliveryProcessor, MaintenanceProcessor, WorkerScheduler],
})
export class WorkerModule {}
