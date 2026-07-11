import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('stores/:storeId/analytics/timeseries')
  @ApiOperation({ summary: 'Daily revenue/count time-series' })
  timeseries(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.timeseries(user, storeId, from, to);
  }

  @Get('stores/:storeId/analytics/forecast')
  @ApiOperation({ summary: 'Revenue forecast (linear trend + moving average)' })
  forecast(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Query('days') days?: string) {
    return this.analytics.forecast(user, storeId, days ? Math.min(Number(days), 90) : undefined);
  }

  @Get('orgs/:orgId/analytics/executive')
  @ApiOperation({ summary: 'Org-level executive summary' })
  executive(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string) {
    return this.analytics.executiveSummary(user, orgId);
  }
}
