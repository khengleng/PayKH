import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReconciliationService } from './reconciliation.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';

@ApiTags('ledger')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class LedgerController {
  constructor(private readonly recon: ReconciliationService) {}

  @Get('stores/:storeId/ledger/trial-balance')
  @ApiOperation({ summary: 'Trial balance (account balances + zero-sum check)' })
  trialBalance(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.recon.storeTrialBalance(user, storeId);
  }

  @Get('stores/:storeId/ledger/journals')
  @ApiOperation({ summary: 'Recent journal entries' })
  journals(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.recon.journals(user, storeId);
  }

  @Get('stores/:storeId/ledger/reconcile')
  @ApiOperation({ summary: 'Run reconciliation for a store' })
  reconcile(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.recon.reconcile(user, storeId);
  }

  // ------------------------------------------------------------- platform admin
  @Get('admin/ledger/trial-balance')
  @ApiOperation({ summary: 'Platform trial balance (admin)' })
  adminTrialBalance(@CurrentUser() user: AuthUser) {
    return this.recon.adminTrialBalance(user);
  }

  @Get('admin/ledger/reconcile')
  @ApiOperation({ summary: 'Platform-wide reconciliation (admin)' })
  adminReconcile(@CurrentUser() user: AuthUser) {
    return this.recon.reconcile(user);
  }

  @Post('admin/ledger/backfill')
  @ApiOperation({ summary: 'Backfill ledger from historical records (admin, idempotent)' })
  backfill(@CurrentUser() user: AuthUser) {
    return this.recon.backfill(user);
  }
}
