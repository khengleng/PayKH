import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ReferralsService, UpdateReferralProgramDto } from './referrals.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { ApiKeyGuard, getApiKeyContext } from '../auth/api-key.guard';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

/** Dashboard referral management (JWT). */
@ApiTags('referrals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class ReferralsDashboardController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('stores/:storeId/referral-program')
  @ApiOperation({ summary: 'Get referral program config' })
  getProgram(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.referrals.getProgram(user, storeId);
  }

  @Put('stores/:storeId/referral-program')
  @ApiOperation({ summary: 'Configure referral rewards (referrer + referee points)' })
  updateProgram(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: UpdateReferralProgramDto) {
    return this.referrals.updateProgram(user, storeId, dto);
  }

  @Get('stores/:storeId/referrals')
  @ApiOperation({ summary: 'List referrals' })
  list(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.referrals.list(user, storeId);
  }
}

/** Public referral API (API key) — a customer's referral code. */
@ApiTags('referrals')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, RateLimitGuard)
@RateLimit({ limit: 100, windowSec: 10, by: 'apiKey' })
@Controller({ path: 'customers', version: '1' })
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Post(':id/referral-code')
  @ApiOperation({ summary: 'Get or create a customer’s referral code + share URL' })
  code(@Req() req: Request, @Param('id') id: string) {
    return this.referrals.getOrCreateCode(getApiKeyContext(req).storeId, id);
  }
}
