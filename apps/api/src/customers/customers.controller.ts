import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CustomersService, CreateCustomerDto, SetPreferencesDto } from './customers.service';
import { ApiKeyGuard, getApiKeyContext } from '../auth/api-key.guard';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { ApiError } from '../common/api-error';

/** Public developer API for customers (API-key authenticated). */
@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, RateLimitGuard)
@RateLimit({ limit: 100, windowSec: 10, by: 'apiKey' })
@Controller({ path: 'customers', version: '1' })
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a customer' })
  create(@Req() req: Request, @Body() dto: CreateCustomerDto) {
    return this.customers.create(getApiKeyContext(req), dto);
  }

  @Get()
  @ApiOperation({ summary: 'List customers' })
  list(
    @Req() req: Request,
    @Query('email') email?: string,
    @Query('external_id') externalId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.customers.list(getApiKeyContext(req), { email, external_id: externalId, limit: limit ? Number(limit) : undefined, cursor });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve a customer' })
  retrieve(@Req() req: Request, @Param('id') id: string) {
    return this.customers.retrieve(getApiKeyContext(req), id);
  }

  @Get(':id/preferences')
  @ApiOperation({ summary: 'Get a customer’s communication preferences' })
  getPrefs(@Req() req: Request, @Param('id') id: string) {
    return this.customers.getPreferences(getApiKeyContext(req).storeId, id);
  }

  @Put(':id/preferences')
  @ApiOperation({ summary: 'Update a customer’s preferences (records consent)' })
  setPrefs(@Req() req: Request, @Param('id') id: string, @Body() dto: SetPreferencesDto) {
    return this.customers.setPreferences(getApiKeyContext(req).storeId, id, dto.preferences, 'api');
  }
}

/** Dashboard customer views incl. Customer 360 (JWT authenticated). */
@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class CustomersDashboardController {
  constructor(private readonly customers: CustomersService) {}

  @Get('stores/:storeId/customers')
  @ApiOperation({ summary: 'List/search a store’s customers' })
  list(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Query('search') search?: string, @Query('cursor') cursor?: string) {
    return this.customers.dashboardList(user, storeId, search, cursor);
  }

  @Get('customers/:id')
  @ApiOperation({ summary: 'Customer 360 (profile + lifetime metrics + recent payments)' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!id) throw ApiError.invalidRequest('customer id required');
    return this.customers.customer360(user, id);
  }

  @Put('customers/:id/preferences')
  @ApiOperation({ summary: 'Update a customer’s preferences (records consent)' })
  setPrefs(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetPreferencesDto) {
    return this.customers.setPreferencesDashboard(user, id, dto.preferences);
  }

  @Get('customers/:id/consent-log')
  @ApiOperation({ summary: 'Consent change history' })
  consentLog(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customers.consentHistory(user, id);
  }

  @Delete('customers/:id/pii')
  @ApiOperation({ summary: 'Right-to-erasure: anonymize PII, preserve financial records' })
  erase(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customers.erase(user, id);
  }
}
