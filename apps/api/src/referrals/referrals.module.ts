import { Module } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { ReferralsController, ReferralsDashboardController } from './referrals.controller';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [AuthModule, LedgerModule],
  controllers: [ReferralsController, ReferralsDashboardController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
