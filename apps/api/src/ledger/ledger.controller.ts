import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReconciliationService } from './reconciliation.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

// Reconciliation / trial-balance / drift scan a store's whole ledger history, so
// on top of the global backstop they get a tight per-IP cap — one tenant can't
// pin DB CPU by looping these.
@ApiTags('ledger')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RateLimitGuard)
@RateLimit({ limit: 20, windowSec: 10, by: 'ip' })
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

  @Get('stores/:storeId/ledger/points-drift')
  @ApiOperation({ summary: 'Loyalty points: balance column vs ledger drift' })
  pointsDrift(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.recon.storePointsDrift(user, storeId);
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

  @Get('admin/ledger/points-drift')
  @ApiOperation({ summary: 'Platform-wide loyalty points drift (admin)' })
  adminPointsDrift(@CurrentUser() user: AuthUser) {
    return this.recon.adminPointsDrift(user);
  }

  @Post('admin/ledger/backfill')
  @ApiOperation({ summary: 'Backfill ledger from historical records (admin, idempotent)' })
  backfill(@CurrentUser() user: AuthUser) {
    return this.recon.backfill(user);
  }
}
