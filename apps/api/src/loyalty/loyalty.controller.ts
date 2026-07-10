import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Request } from 'express';
import { LoyaltyService, AdjustDto, RedeemDto, UpdateProgramDto } from './loyalty.service';
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

  @Post('customers/:id/loyalty/adjust')
  @ApiOperation({ summary: 'Manually adjust a customer’s points (+/-)' })
  async adjust(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AdjustDto, @Req() req: Request) {
    const result = await this.loyalty.adjust(user, id, dto.points, dto.reason);
    await this.audit.record({ actorUserId: user.userId, action: 'loyalty.adjust', entity: `customer:${id}`, afterValue: { points: dto.points, reason: dto.reason }, ipAddress: req.ip, userAgent: req.header('user-agent'), requestId: getRequestId(req) });
    return result;
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
  @ApiOperation({ summary: 'Redeem a customer’s points' })
  redeem(@Req() req: Request, @Body() dto: ApiRedeemDto) {
    const ctx = getApiKeyContext(req);
    return this.loyalty.redeem(ctx.storeId, dto.customer_id, dto.points, dto.reason);
  }
}
