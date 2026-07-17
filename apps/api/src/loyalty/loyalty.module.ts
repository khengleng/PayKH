import { Module } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyController, LoyaltyDashboardController } from './loyalty.controller';
import { AuthModule } from '../auth/auth.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [AuthModule, CampaignsModule, LedgerModule],
  controllers: [LoyaltyController, LoyaltyDashboardController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
