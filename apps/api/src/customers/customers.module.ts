import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController, CustomersDashboardController } from './customers.controller';
import { AuthModule } from '../auth/auth.module';
import { ReferralsModule } from '../referrals/referrals.module';

@Module({
  imports: [AuthModule, ReferralsModule],
  controllers: [CustomersController, CustomersDashboardController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
