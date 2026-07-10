import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { PaymentStatus } from '@paykh/shared-types';

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
