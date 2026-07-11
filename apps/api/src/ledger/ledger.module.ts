import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { ReconciliationService } from './reconciliation.service';
import { LedgerController } from './ledger.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [LedgerController],
  providers: [LedgerService, ReconciliationService],
  exports: [LedgerService],
})
export class LedgerModule {}
