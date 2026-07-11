import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RiskService, UpdateCaseDto } from './risk.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';

@ApiTags('risk')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class RiskController {
  constructor(private readonly risk: RiskService) {}

  @Get('stores/:storeId/risk/cases')
  @ApiOperation({ summary: 'List risk/fraud cases (filter by status)' })
  list(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Query('status') status?: string) {
    return this.risk.listCases(user, storeId, status);
  }

  @Get('stores/:storeId/risk/summary')
  @ApiOperation({ summary: 'Risk case counts by status' })
  summary(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.risk.summary(user, storeId);
  }

  @Put('risk/cases/:caseId')
  @ApiOperation({ summary: 'Update a case (status + resolution)' })
  update(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: UpdateCaseDto) {
    return this.risk.updateCase(user, caseId, dto);
  }
}
