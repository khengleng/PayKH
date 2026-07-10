import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [AuthModule, PaymentsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
