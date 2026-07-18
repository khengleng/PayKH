import { Body, Controller, Get, Param, Post, Module, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { WalletService } from './wallet.service';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

class RedeemDto {
  @IsString() reward_id!: string;
}

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

  @Post(':customerId/redeem')
  @RateLimit({ limit: 5, windowSec: 10, by: 'ip' })
  @ApiOperation({ summary: 'Redeem points for a reward (returns a voucher code)' })
  redeem(@Param('customerId') customerId: string, @Body() dto: RedeemDto) {
    return this.wallet.redeem(customerId, dto.reward_id);
  }
}

import { PayChainIntegrationModule } from '../paychain/paychain-integration.module';

@Module({
  imports: [LoyaltyModule, PayChainIntegrationModule],
  controllers: [WalletController],
  providers: [WalletService],
})
export class WalletModule {}
