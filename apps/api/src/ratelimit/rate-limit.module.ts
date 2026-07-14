import { Global, Module } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit';
import { AccountThrottleService } from './account-throttle.service';

@Global()
@Module({
  providers: [RateLimitGuard, AccountThrottleService],
  exports: [RateLimitGuard, AccountThrottleService],
})
export class RateLimitModule {}
