import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { AccessModule } from '../access/access.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [AuthModule, PaymentsModule, AccessModule, CustomersModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
