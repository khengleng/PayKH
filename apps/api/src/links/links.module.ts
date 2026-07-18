import { Body, Controller, Delete, Get, Module, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateLinkDto, LinksService, PayLinkDto } from './links.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { CustomersModule } from '../customers/customers.module';

/** Dashboard payment-link / invoice management (JWT). */
@ApiTags('payment-links')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class LinksDashboardController {
  constructor(private readonly links: LinksService) {}

  @Get('stores/:storeId/links')
  @ApiOperation({ summary: 'List payment links & invoices' })
  list(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.links.list(user, storeId);
  }

  @Post('stores/:storeId/links')
  @ApiOperation({ summary: 'Create a payment link or invoice' })
  create(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: CreateLinkDto) {
    return this.links.create(user, storeId, dto);
  }

  @Put('links/:linkId')
  @ApiOperation({ summary: 'Activate / deactivate a link' })
  setActive(@CurrentUser() user: AuthUser, @Param('linkId') linkId: string, @Body() body: { active: boolean }) {
    return this.links.setActive(user, linkId, body.active);
  }

  @Delete('links/:linkId')
  @ApiOperation({ summary: 'Delete a link' })
  remove(@CurrentUser() user: AuthUser, @Param('linkId') linkId: string) {
    return this.links.remove(user, linkId);
  }
}

/** Public hosted pay-link API — NO auth; the link id is the bearer. IP rate-limited. */
@ApiTags('payment-links')
@UseGuards(RateLimitGuard)
@RateLimit({ limit: 30, windowSec: 10, by: 'ip' })
@Controller('links')
export class LinksPublicController {
  constructor(private readonly links: LinksService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Public payment-link details' })
  get(@Param('id') id: string) {
    return this.links.publicGet(id);
  }

  @Post(':id/pay')
  @ApiOperation({ summary: 'Create a payment for a link → hosted checkout URL' })
  pay(@Param('id') id: string, @Body() dto: PayLinkDto) {
    return this.links.pay(id, dto);
  }
}

@Module({
  imports: [AuthModule, PaymentsModule, CustomersModule],
  controllers: [LinksDashboardController, LinksPublicController],
  providers: [LinksService],
  exports: [LinksService],
})
export class LinksModule {}
