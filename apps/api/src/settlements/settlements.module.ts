import { Module } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { ReconciliationService } from './reconciliation.service';
import { SettlementsController } from './settlements.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [SettlementsController],
  providers: [SettlementService, ReconciliationService],
  exports: [SettlementService],
})
export class SettlementsModule {}
