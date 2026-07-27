import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { AuthModule } from '../auth/auth.module';
import { SegmentsModule } from '../segments/segments.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [AuthModule, SegmentsModule, LedgerModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
