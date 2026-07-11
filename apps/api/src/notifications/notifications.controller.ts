import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationChannelType } from '@prisma/client';
import { NotificationsService, UpdateChannelDto, UpdateTelegramDto } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('stores/:storeId/telegram')
  @ApiOperation({ summary: 'Get Telegram notification config' })
  get(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.notifications.getConfig(user, storeId);
  }

  @Put('stores/:storeId/telegram')
  @ApiOperation({ summary: 'Configure Telegram notifications (chat id, events)' })
  update(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: UpdateTelegramDto) {
    return this.notifications.updateConfig(user, storeId, dto);
  }

  @Post('stores/:storeId/telegram/test')
  @ApiOperation({ summary: 'Send a test Telegram message' })
  test(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.notifications.sendTest(user, storeId);
  }

  @Get('stores/:storeId/channels')
  @ApiOperation({ summary: 'List messaging channels (WhatsApp/SMS/Signal) config' })
  channels(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.notifications.listChannels(user, storeId);
  }

  @Put('stores/:storeId/channels')
  @ApiOperation({ summary: 'Configure a messaging channel' })
  updateChannel(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: UpdateChannelDto) {
    return this.notifications.updateChannel(user, storeId, dto);
  }

  @Post('stores/:storeId/channels/:channel/test')
  @ApiOperation({ summary: 'Send a test message on a channel' })
  testChannel(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Param('channel') channel: string) {
    return this.notifications.sendTestChannel(user, storeId, channel.toUpperCase() as NotificationChannelType);
  }
}
