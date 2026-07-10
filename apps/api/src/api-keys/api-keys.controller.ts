import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { AuditService } from '../audit/audit.service';
import { getRequestId } from '../common/request-context';
import { ApiError } from '../common/api-error';

@ApiTags('api-keys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api-keys')
export class ApiKeysController {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create an API key (secret shown once)' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateApiKeyDto, @Req() req: Request) {
    const result = await this.keys.create(user, dto);
    await this.audit.record({
      storeId: dto.storeId,
      actorUserId: user.userId,
      action: 'apikey.create',
      entity: `apikey:${result.id}`,
      afterValue: { mode: dto.mode, label: dto.label, display_prefix: result.display_prefix },
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }

  @Get()
  @ApiOperation({ summary: 'List API keys for a store' })
  list(@CurrentUser() user: AuthUser, @Query('store_id') storeId: string) {
    if (!storeId) throw ApiError.invalidRequest('store_id query parameter is required');
    return this.keys.list(user, storeId);
  }

  @Post(':id/revoke')
  @ApiOperation({ summary: 'Revoke an API key' })
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const result = await this.keys.revoke(user, id);
    await this.audit.record({
      storeId: result.store_id,
      actorUserId: user.userId,
      action: 'apikey.revoke',
      entity: `apikey:${id}`,
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }

  @Post(':id/rotate')
  @ApiOperation({ summary: 'Rotate an API key (revoke old, issue new)' })
  async rotate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const result = await this.keys.rotate(user, id);
    await this.audit.record({
      storeId: result.store_id,
      actorUserId: user.userId,
      action: 'apikey.rotate',
      entity: `apikey:${result.id}`,
      beforeValue: { id },
      afterValue: { id: result.id },
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }
}
