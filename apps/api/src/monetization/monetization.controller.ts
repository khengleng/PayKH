import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MonetizationService, RevenueShareDto } from './monetization.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';

@ApiTags('monetization')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class MonetizationController {
  constructor(private readonly monetization: MonetizationService) {}

  @Get('stores/:storeId/revenue-shares')
  @ApiOperation({ summary: 'List revenue-share agreements' })
  listShares(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.monetization.listShares(user, storeId);
  }

  @Post('stores/:storeId/revenue-shares')
  @ApiOperation({ summary: 'Create a revenue-share agreement' })
  createShare(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: RevenueShareDto) {
    return this.monetization.createShare(user, storeId, dto);
  }

  @Put('revenue-shares/:shareId')
  @ApiOperation({ summary: 'Update a revenue-share agreement' })
  updateShare(@CurrentUser() user: AuthUser, @Param('shareId') shareId: string, @Body() dto: Partial<RevenueShareDto>) {
    return this.monetization.updateShare(user, shareId, dto);
  }

  @Delete('revenue-shares/:shareId')
  @ApiOperation({ summary: 'Delete a revenue-share agreement' })
  deleteShare(@CurrentUser() user: AuthUser, @Param('shareId') shareId: string) {
    return this.monetization.deleteShare(user, shareId);
  }

  @Get('stores/:storeId/ledger')
  @ApiOperation({ summary: 'Derived accounting ledger over a date range' })
  ledger(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.monetization.ledger(user, storeId, from, to);
  }
}
