import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { loadConfig } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { EmailModule } from './email/email.module';
import { AuditModule } from './audit/audit.module';
import { ProviderModule } from './providers/provider.module';
import { QueueModule } from './queue/queue.module';
import { RedisModule } from './redis/redis.module';
import { RateLimitModule } from './ratelimit/rate-limit.module';
import { AuthModule } from './auth/auth.module';
import { StoresModule } from './stores/stores.module';
import { BranchesModule } from './branches/branches.module';
import { CustomersModule } from './customers/customers.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { SegmentsModule } from './segments/segments.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { ReferralsModule } from './referrals/referrals.module';
import { GamesModule } from './games/games.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { PaymentsModule } from './payments/payments.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { BillingModule } from './billing/billing.module';
import { TeamModule } from './team/team.module';
import { AdminModule } from './admin/admin.module';
import { SettlementsModule } from './settlements/settlements.module';
import { VerificationModule } from './verification/verification.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { RequestIdMiddleware } from './common/request-context';

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
    AuthModule,
    StoresModule,
    BranchesModule,
    CustomersModule,
    LoyaltyModule,
    SegmentsModule,
    CampaignsModule,
    ReferralsModule,
    GamesModule,
    AnalyticsModule,
    NotificationsModule,
    ApiKeysModule,
    PaymentsModule,
    WebhooksModule,
    BillingModule,
    TeamModule,
    AdminModule,
    SettlementsModule,
    VerificationModule,
    DashboardModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
