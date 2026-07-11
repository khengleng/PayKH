import { Module } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { ReferralsController, ReferralsDashboardController } from './referrals.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ReferralsController, ReferralsDashboardController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
