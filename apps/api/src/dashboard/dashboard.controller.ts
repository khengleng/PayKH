import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { PaymentStatus } from '@paykh/shared-types';

class DashboardRefundDto {
  @IsOptional() @IsString() amount?: string;
  @IsOptional() @IsString() reason?: string;
}

/** Merchant dashboard read APIs (JWT-authenticated). */
@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('stores/:storeId/overview')
  @ApiOperation({ summary: 'Store overview metrics' })
  overview(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.dashboard.overview(user, storeId);
  }

  @Get('stores/:storeId/payments')
  @ApiOperation({ summary: 'List a store’s payments (dashboard view)' })
  listPayments(
    @CurrentUser() user: AuthUser,
    @Param('storeId') storeId: string,
    @Query('status') status?: PaymentStatus,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.dashboard.listPayments(user, storeId, {
      status,
      search,
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('payments/:id')
  @ApiOperation({ summary: 'Payment detail with timeline (dashboard view)' })
  getPayment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dashboard.getPayment(user, id);
  }

  @Post('payments/:id/refund')
  @ApiOperation({ summary: 'Refund a payment (dashboard, requires payment:write)' })
  refund(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DashboardRefundDto) {
    return this.dashboard.refund(user, id, dto);
  }

  @Post('stores/:storeId/pos/charge')
  @ApiOperation({ summary: 'POS: charge an amount and get a KHQR to display' })
  posCharge(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: { amount: string; currency?: 'USD' | 'KHR'; reference?: string; customer_phone?: string; customer_email?: string; customer_name?: string }) {
    return this.dashboard.posCharge(user, storeId, dto);
  }

  @Get('stores/:storeId/pos/counter-qr')
  @ApiOperation({ summary: 'Get the store’s durable counter QR (open-amount link)' })
  counterQr(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.dashboard.counterQr(user, storeId);
  }

  @Get('orgs/:orgId/audit-logs')
  @ApiOperation({ summary: 'Read-only audit log (owner/admin)' })
  auditLogs(
    @CurrentUser() user: AuthUser,
    @Param('orgId') orgId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.dashboard.auditLogs(user, orgId, {
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('stores/:storeId/report')
  @ApiOperation({ summary: 'Settlement / transaction report over a date range' })
  report(
    @CurrentUser() user: AuthUser,
    @Param('storeId') storeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.dashboard.report(user, storeId, from, to);
  }
}
