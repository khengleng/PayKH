import { Module } from '@nestjs/common';
import { MonetizationService } from './monetization.service';
import { MonetizationController } from './monetization.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [MonetizationController],
  providers: [MonetizationService],
  exports: [MonetizationService],
})
export class MonetizationModule {}
