import { Global, Module } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit';

@Global()
@Module({
  providers: [RateLimitGuard],
  exports: [RateLimitGuard],
})
export class RateLimitModule {}
