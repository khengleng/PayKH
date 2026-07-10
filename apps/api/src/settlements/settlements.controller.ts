import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { SettlementService } from './settlement.service';
import { ReconciliationService } from './reconciliation.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { AuditService } from '../audit/audit.service';
import { getRequestId } from '../common/request-context';

@ApiTags('settlements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class SettlementsController {
  constructor(
    private readonly settlements: SettlementService,
    private readonly reconciliation: ReconciliationService,
    private readonly audit: AuditService,
  ) {}

  @Get('stores/:storeId/settlements')
  @ApiOperation({ summary: 'List settlement batches for a store' })
  list(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.settlements.list(user, storeId);
  }

  @Get('settlements/:id')
  @ApiOperation({ summary: 'Settlement detail (with payments)' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.settlements.get(user, id);
  }

  @Post('stores/:storeId/settle')
  @ApiOperation({ summary: 'Run settlement now for a store (includes today)' })
  async settle(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Req() req: Request) {
    const result = await this.settlements.runNow(user, storeId);
    await this.audit.record({
      storeId, actorUserId: user.userId, action: 'settlement.run', entity: `store:${storeId}`,
      afterValue: { created: result.created }, ipAddress: req.ip, userAgent: req.header('user-agent'), requestId: getRequestId(req),
    });
    return result;
  }

  @Post('stores/:storeId/reconcile')
  @ApiOperation({ summary: 'Run reconciliation for a store over a date range' })
  async reconcile(
    @CurrentUser() user: AuthUser,
    @Param('storeId') storeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reconciliation.run(user, storeId, from, to);
  }

  @Get('stores/:storeId/reconciliations')
  @ApiOperation({ summary: 'List reconciliation reports for a store' })
  reconciliations(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.reconciliation.list(user, storeId);
  }
}
