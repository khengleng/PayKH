import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { StoresService } from './stores.service';
import {
  ActivateLiveDto,
  CreateStoreDto,
  UpdateBrandingDto,
  UpsertCredentialDto,
} from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { AuditService } from '../audit/audit.service';
import { getRequestId } from '../common/request-context';

@ApiTags('stores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('stores')
export class StoresController {
  constructor(
    private readonly stores: StoresService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a store' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateStoreDto, @Req() req: Request) {
    const store = await this.stores.create(user, dto);
    await this.audit.record({
      organizationId: dto.organizationId,
      storeId: store.id,
      actorUserId: user.userId,
      action: 'store.create',
      entity: `store:${store.id}`,
      afterValue: { name: dto.name },
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return store;
  }

  @Get()
  @ApiOperation({ summary: 'List stores across your organizations' })
  list(@CurrentUser() user: AuthUser) {
    return this.stores.list(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve a store' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.stores.get(user, id);
  }

  @Put(':id/branding')
  @ApiOperation({ summary: 'Update checkout branding' })
  async updateBranding(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBrandingDto,
    @Req() req: Request,
  ) {
    const result = await this.stores.updateBranding(user, id, dto);
    await this.audit.record({
      storeId: id,
      actorUserId: user.userId,
      action: 'branding.update',
      entity: `store:${id}`,
      afterValue: dto,
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }

  @Put(':id/credentials')
  @ApiOperation({ summary: 'Configure encrypted Bakong provider credentials' })
  async upsertCredential(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpsertCredentialDto,
    @Req() req: Request,
  ) {
    const result = await this.stores.upsertCredential(user, id, dto);
    // NB: the secret itself is never logged or audited.
    await this.audit.record({
      storeId: id,
      actorUserId: user.userId,
      action: 'store.credentials.update',
      entity: `store:${id}`,
      afterValue: { mode: dto.mode, label: dto.label },
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }

  @Put(':id/live-mode')
  @ApiOperation({ summary: 'Activate or deactivate production (live) mode' })
  async setLiveMode(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ActivateLiveDto,
    @Req() req: Request,
  ) {
    const result = await this.stores.setLiveMode(user, id, dto.liveMode);
    await this.audit.record({
      storeId: id,
      actorUserId: user.userId,
      action: 'store.live_mode.update',
      entity: `store:${id}`,
      afterValue: { liveMode: dto.liveMode },
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }
}
