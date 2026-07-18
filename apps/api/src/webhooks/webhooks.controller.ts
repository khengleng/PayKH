import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { AuditService } from '../audit/audit.service';
import { getRequestId } from '../common/request-context';
import { ApiError } from '../common/api-error';

@ApiTags('webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('webhook-endpoints')
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Register a webhook endpoint (signing secret shown once)' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateWebhookDto, @Req() req: Request) {
    const result = await this.webhooks.create(user, dto);
    await this.audit.record({
      storeId: dto.storeId,
      actorUserId: user.userId,
      action: 'webhook.create',
      entity: `webhook:${result.id}`,
      afterValue: { url: dto.url, events: dto.enabledEvents },
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }

  @Get()
  @ApiOperation({ summary: 'List webhook endpoints for a store' })
  list(@CurrentUser() user: AuthUser, @Query('store_id') storeId: string) {
    if (!storeId) throw ApiError.invalidRequest('store_id query parameter is required');
    return this.webhooks.list(user, storeId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a webhook endpoint (url, events, enable/disable)' })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
    @Req() req: Request,
  ) {
    const result = await this.webhooks.update(user, id, dto);
    await this.audit.record({
      storeId: result.store_id,
      actorUserId: user.userId,
      action: 'webhook.update',
      entity: `webhook:${id}`,
      afterValue: dto,
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const result = await this.webhooks.remove(user, id);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'webhook.delete',
      entity: `webhook:${id}`,
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }

  @Get(':id/secret')
  @ApiOperation({ summary: 'Reveal the active signing secret' })
  revealSecret(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.webhooks.revealSecret(user, id);
  }

  @Post(':id/rotate-secret')
  @ApiOperation({ summary: 'Rotate the signing secret (old one valid for 24h)' })
  async rotateSecret(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const result = await this.webhooks.rotateSecret(user, id);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'webhook.secret.rotate',
      entity: `webhook:${id}`,
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'List delivery attempts for an endpoint' })
  deliveries(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.webhooks.deliveries(user, id, limit ? Number(limit) : undefined);
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Send a synthetic test event to the endpoint' })
  sendTest(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.webhooks.sendTest(user, id);
  }

  @Post('deliveries/:deliveryId/resend')
  @ApiOperation({ summary: 'Resend a specific delivery' })
  resend(@CurrentUser() user: AuthUser, @Param('deliveryId') deliveryId: string) {
    return this.webhooks.resend(user, deliveryId);
  }

  @Get('dead-lettered/count')
  @ApiOperation({ summary: 'Count dead-lettered (failed) deliveries for a store' })
  deadLetteredCount(@CurrentUser() user: AuthUser, @Query('store_id') storeId: string) {
    if (!storeId) throw ApiError.invalidRequest('store_id query parameter is required');
    return this.webhooks.deadLetteredCount(user, storeId);
  }

  @Post('replay-dead-lettered')
  @ApiOperation({ summary: 'Re-enqueue every dead-lettered delivery for a store' })
  async replayDeadLettered(
    @CurrentUser() user: AuthUser,
    @Query('store_id') storeId: string,
    @Req() req: Request,
  ) {
    if (!storeId) throw ApiError.invalidRequest('store_id query parameter is required');
    const result = await this.webhooks.replayDeadLettered(user, storeId);
    await this.audit.record({
      storeId,
      actorUserId: user.userId,
      action: 'webhook.replay_dead_lettered',
      entity: `store:${storeId}`,
      afterValue: { replayed: result.replayed, remaining: result.remaining },
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }
}
