import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController, CustomersDashboardController } from './customers.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CustomersController, CustomersDashboardController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
