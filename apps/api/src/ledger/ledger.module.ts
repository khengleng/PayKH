import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { ReconciliationService } from './reconciliation.service';
import { LedgerController } from './ledger.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [LedgerController],
  providers: [LedgerService, ReconciliationService],
  // ReconciliationService is exported for the worker's points-drift job, which
  // runs the same check the controller exposes.
  exports: [LedgerService, ReconciliationService],
})
export class LedgerModule {}
