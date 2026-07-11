import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PayoutCommissionsDto, ReferralsService, ReviewReferralDto, UpdateReferralProgramDto } from './referrals.service';
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

  @Get('stores/:storeId/commissions')
  @ApiOperation({ summary: 'List affiliate commissions (optionally filter by status)' })
  listCommissions(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Query('status') status?: string) {
    return this.referrals.listCommissions(user, storeId, status);
  }

  @Get('stores/:storeId/commissions/summary')
  @ApiOperation({ summary: 'Commission totals per referrer (accrued vs. paid)' })
  commissionSummary(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.referrals.commissionSummary(user, storeId);
  }

  @Post('stores/:storeId/commissions/payout')
  @ApiOperation({ summary: 'Mark accrued commissions as paid (all or one referrer)' })
  payout(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: PayoutCommissionsDto) {
    return this.referrals.payoutCommissions(user, storeId, dto);
  }

  @Get('customers/:customerId/referral-qr')
  @ApiOperation({ summary: 'Referral QR (PNG + SVG) for a customer' })
  customerQr(@CurrentUser() user: AuthUser, @Param('customerId') customerId: string) {
    return this.referrals.getReferralQrForDashboard(user, customerId);
  }

  @Get('stores/:storeId/referrals/flagged')
  @ApiOperation({ summary: 'List fraud-flagged referrals awaiting review' })
  flagged(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.referrals.listFlagged(user, storeId);
  }

  @Post('stores/:storeId/referrals/:referralId/review')
  @ApiOperation({ summary: 'Review a flagged referral: clear (release) or void (cancel) held commissions' })
  review(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Param('referralId') referralId: string, @Body() dto: ReviewReferralDto) {
    return this.referrals.reviewReferral(user, storeId, referralId, dto.action);
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

  @Get(':id/referral-qr')
  @ApiOperation({ summary: 'Get a scannable QR (PNG data URL + SVG) for the referral link' })
  qr(@Req() req: Request, @Param('id') id: string) {
    return this.referrals.getReferralQr(getApiKeyContext(req).storeId, id);
  }
}
