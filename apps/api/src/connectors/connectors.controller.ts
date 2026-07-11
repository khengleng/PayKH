import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConnectorDto, ConnectorsService } from './connectors.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';

@ApiTags('connectors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  @Get('marketplace')
  @ApiOperation({ summary: 'Available integrations (app marketplace)' })
  marketplace() {
    return this.connectors.marketplace();
  }

  @Get('stores/:storeId/connectors')
  @ApiOperation({ summary: 'Installed connectors' })
  list(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.connectors.list(user, storeId);
  }

  @Post('stores/:storeId/connectors')
  @ApiOperation({ summary: 'Install a connector' })
  install(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: ConnectorDto) {
    return this.connectors.install(user, storeId, dto);
  }

  @Put('connectors/:connectorId')
  @ApiOperation({ summary: 'Update a connector' })
  update(@CurrentUser() user: AuthUser, @Param('connectorId') connectorId: string, @Body() dto: Partial<ConnectorDto>) {
    return this.connectors.update(user, connectorId, dto);
  }

  @Post('connectors/:connectorId/test')
  @ApiOperation({ summary: 'Send a test event to a connector' })
  test(@CurrentUser() user: AuthUser, @Param('connectorId') connectorId: string) {
    return this.connectors.test(user, connectorId);
  }

  @Delete('connectors/:connectorId')
  @ApiOperation({ summary: 'Remove a connector' })
  remove(@CurrentUser() user: AuthUser, @Param('connectorId') connectorId: string) {
    return this.connectors.remove(user, connectorId);
  }
}
