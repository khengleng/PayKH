import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { Request } from 'express';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { AuditService } from '../audit/audit.service';
import { getRequestId } from '../common/request-context';
import { ApiError } from '../common/api-error';

class ChangePlanDto {
  @IsString()
  planId!: string;
}

@ApiTags('billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly audit: AuditService,
  ) {}

  @Get('plans')
  @ApiOperation({ summary: 'List available plans' })
  plans() {
    return this.billing.listPlans();
  }

  @Get()
  @ApiOperation({ summary: 'Billing overview (plan + usage + warnings)' })
  overview(@CurrentUser() user: AuthUser, @Query('org_id') orgId: string) {
    if (!orgId) throw ApiError.invalidRequest('org_id query parameter is required');
    return this.billing.overview(user, orgId);
  }

  @Post(':orgId/subscribe')
  @ApiOperation({ summary: 'Subscribe to a plan (free activates now; paid returns a KHQR invoice)' })
  async subscribe(
    @CurrentUser() user: AuthUser,
    @Param('orgId') orgId: string,
    @Body() dto: ChangePlanDto,
    @Req() req: Request,
  ) {
    const result = await this.billing.subscribe(user, orgId, dto.planId);
    await this.audit.record({
      organizationId: orgId,
      actorUserId: user.userId,
      action: 'billing.subscribe',
      entity: `org:${orgId}`,
      afterValue: { planId: dto.planId, activated: result.activated },
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }

  @Post('invoices/:id/simulate-pay')
  @ApiOperation({ summary: 'Confirm a subscription invoice payment (mock provider only)' })
  simulatePay(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.billing.simulateInvoicePayment(user, id);
  }

  @Get(':orgId/history')
  @ApiOperation({ summary: 'Plan history' })
  history(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string) {
    return this.billing.planHistory(user, orgId);
  }

  @Get(':orgId/invoices')
  @ApiOperation({ summary: 'Invoice history' })
  invoices(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string) {
    return this.billing.listInvoices(user, orgId);
  }
}
