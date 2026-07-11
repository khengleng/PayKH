import { Controller, Get, Param, Module, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

/** Public hosted wallet — no auth; the customer id is the bearer. IP rate-limited. */
@ApiTags('wallet')
@UseGuards(RateLimitGuard)
@RateLimit({ limit: 30, windowSec: 10, by: 'ip' })
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get(':customerId')
  @ApiOperation({ summary: 'Public customer loyalty wallet' })
  get(@Param('customerId') customerId: string) {
    return this.wallet.wallet(customerId);
  }
}

@Module({
  controllers: [WalletController],
  providers: [WalletService],
})
export class WalletModule {}
