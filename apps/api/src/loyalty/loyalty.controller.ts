import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Request } from 'express';
import { LoyaltyService, AdjustDto, CreateRewardDto, CreateTierDto, UpdateProgramDto, UpdateRewardDto, UpdateTierDto } from './loyalty.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { ApiKeyGuard, getApiKeyContext } from '../auth/api-key.guard';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';
import { AuditService } from '../audit/audit.service';
import { getRequestId } from '../common/request-context';

class ApiRedeemDto {
  @IsString() customer_id!: string;
  @IsInt() @Min(1) points!: number;
  @IsOptional() @IsString() reason?: string;
}

class RedeemRewardDto {
  @IsString() customer_id!: string;
  @IsString() reward_id!: string;
}

/** Dashboard loyalty management (JWT). */
@ApiTags('loyalty')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class LoyaltyDashboardController {
  constructor(
    private readonly loyalty: LoyaltyService,
    private readonly audit: AuditService,
  ) {}

  @Get('stores/:storeId/loyalty')
  @ApiOperation({ summary: 'Get the loyalty program config' })
  getProgram(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.loyalty.getProgram(user, storeId);
  }

  @Put('stores/:storeId/loyalty')
  @ApiOperation({ summary: 'Configure the loyalty program (active + points per unit)' })
  async updateProgram(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: UpdateProgramDto, @Req() req: Request) {
    const result = await this.loyalty.updateProgram(user, storeId, dto);
    await this.audit.record({ storeId, actorUserId: user.userId, action: 'loyalty.program.update', entity: `store:${storeId}`, afterValue: dto, ipAddress: req.ip, userAgent: req.header('user-agent'), requestId: getRequestId(req) });
    return result;
  }

  @Get('customers/:id/loyalty')
  @ApiOperation({ summary: 'Customer points balance + ledger' })
  ledger(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loyalty.ledger(user, id);
  }

  @Get('stores/:storeId/loyalty/summary')
  @ApiOperation({ summary: 'At-a-glance loyalty numbers for the overview' })
  loyaltySummary(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.loyalty.summary(user, storeId);
  }

  @Get('stores/:storeId/loyalty/expiry-preview')
  @ApiOperation({ summary: 'Dry run: what a given expiry window would take today' })
  expiryPreview(
    @CurrentUser() user: AuthUser,
    @Param('storeId') storeId: string,
    @Query('months') months: string,
    @Query('warn_days') warnDays?: string,
  ) {
    return this.loyalty.expiryPreview(user, storeId, Number(months), warnDays ? Number(warnDays) : undefined);
  }

  @Get('stores/:storeId/loyalty/liability')
  @ApiOperation({ summary: 'Outstanding points liability (pointValue = currency per point)' })
  liability(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Query('point_value') pointValue?: string) {
    return this.loyalty.liability(user, storeId, pointValue ? Number(pointValue) : undefined);
  }

  @Post('customers/:id/loyalty/adjust')
  @ApiOperation({ summary: 'Manually adjust a customer’s points (+/-)' })
  async adjust(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AdjustDto, @Req() req: Request) {
    const result = await this.loyalty.adjust(user, id, dto.points, dto.reason);
    await this.audit.record({ actorUserId: user.userId, action: 'loyalty.adjust', entity: `customer:${id}`, afterValue: { points: dto.points, reason: dto.reason }, ipAddress: req.ip, userAgent: req.header('user-agent'), requestId: getRequestId(req) });
    return result;
  }

  // --- tiers ---
  @Get('stores/:storeId/tiers')
  @ApiOperation({ summary: 'List loyalty tiers' })
  tiers(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.loyalty.listTiers(user, storeId);
  }

  @Post('stores/:storeId/tiers')
  @ApiOperation({ summary: 'Create a tier (threshold + earn multiplier)' })
  createTier(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: CreateTierDto) {
    return this.loyalty.createTier(user, storeId, dto);
  }

  @Patch('tiers/:id')
  @ApiOperation({ summary: 'Update a tier' })
  updateTier(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateTierDto) {
    return this.loyalty.updateTier(user, id, dto);
  }

  @Delete('tiers/:id')
  @ApiOperation({ summary: 'Delete a tier' })
  deleteTier(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loyalty.deleteTier(user, id);
  }

  // --- rewards catalog ---
  @Get('stores/:storeId/rewards')
  @ApiOperation({ summary: 'List rewards (catalog)' })
  rewards(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.loyalty.listRewardsForUser(user, storeId);
  }

  @Post('stores/:storeId/rewards')
  @ApiOperation({ summary: 'Create a reward' })
  createReward(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: CreateRewardDto) {
    return this.loyalty.createReward(user, storeId, dto);
  }

  @Patch('rewards/:id')
  @ApiOperation({ summary: 'Update a reward' })
  updateReward(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateRewardDto) {
    return this.loyalty.updateReward(user, id, dto);
  }

  @Delete('rewards/:id')
  @ApiOperation({ summary: 'Delete or deactivate a reward' })
  deleteReward(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loyalty.deleteReward(user, id);
  }

  // --- redemptions ---
  @Get('stores/:storeId/redemptions')
  @ApiOperation({ summary: 'List redemptions for a store' })
  redemptions(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.loyalty.listRedemptions(user, storeId);
  }

  @Get('stores/:storeId/redemptions/lookup')
  @ApiOperation({ summary: 'Find a voucher by its code (counter fulfilment)' })
  lookup(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Query('code') code: string) {
    return this.loyalty.lookupByCode(user, storeId, code ?? '');
  }

  @Post('redemptions/:id/fulfill')
  @ApiOperation({ summary: 'Mark a redemption fulfilled' })
  fulfill(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loyalty.fulfill(user, id);
  }

  @Post('redemptions/:id/cancel')
  @ApiOperation({ summary: 'Cancel a redemption (refund points + restore stock)' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loyalty.cancel(user, id);
  }
}

/** Public loyalty API (API key) — redeem points. */
@ApiTags('loyalty')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, RateLimitGuard)
@RateLimit({ limit: 100, windowSec: 10, by: 'apiKey' })
@Controller({ path: 'loyalty', version: '1' })
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Post('redeem')
  @ApiOperation({ summary: 'Redeem a customer’s points (raw points)' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  async redeem(
    @Req() req: Request,
    @Body() dto: ApiRedeemDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const ctx = getApiKeyContext(req);
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(dto);
    const { resource } = await this.loyalty.redeemIdempotent(ctx.storeId, ctx.mode, dto.customer_id, dto.points, idempotencyKey, rawBody, dto.reason);
    return resource;
  }

  @Get('rewards')
  @ApiOperation({ summary: 'List active rewards' })
  rewards(@Req() req: Request) {
    return this.loyalty.listRewards(getApiKeyContext(req).storeId, true);
  }

  @Post('redemptions')
  @ApiOperation({ summary: 'Redeem points for a reward (returns a voucher code)' })
  redeemReward(@Req() req: Request, @Body() dto: RedeemRewardDto) {
    const ctx = getApiKeyContext(req);
    return this.loyalty.redeemReward(ctx.storeId, dto.customer_id, dto.reward_id);
  }

  @Get('redemptions/:id')
  @ApiOperation({ summary: 'Retrieve a redemption' })
  getRedemption(@Req() req: Request, @Param('id') id: string) {
    // reuse dashboard read via a synthetic membership check is overkill; scope by store.
    return this.loyalty.redemptionForStore(getApiKeyContext(req).storeId, id);
  }
}
