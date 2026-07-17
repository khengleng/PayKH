import { Module } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyController, LoyaltyDashboardController } from './loyalty.controller';
import { AuthModule } from '../auth/auth.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { LedgerModule } from '../ledger/ledger.module';
// Imported here rather than relied on from the root: IdempotencyModule is
// @Global, but @Global only takes effect once the module is in the graph, and
// the worker has its own root (worker.module.ts) that does not load app.module.
// A module must carry its own dependencies or it breaks under a second root.
import { IdempotencyModule } from '../idempotency/idempotency.module';

@Module({
  imports: [AuthModule, CampaignsModule, LedgerModule, IdempotencyModule],
  controllers: [LoyaltyController, LoyaltyDashboardController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
