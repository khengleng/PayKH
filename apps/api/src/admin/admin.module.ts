import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { PayoutService } from './payout.service';
import { AuthModule } from '../auth/auth.module';
import { VerificationModule } from '../verification/verification.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [AuthModule, VerificationModule, LedgerModule],
  controllers: [AdminController],
  providers: [AdminService, PayoutService],
})
export class AdminModule {}
