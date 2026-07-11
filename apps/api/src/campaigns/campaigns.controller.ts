import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CampaignsService, CreatePromotionDto, UpdatePromotionDto } from './campaigns.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { AuditService } from '../audit/audit.service';
import { getRequestId } from '../common/request-context';

@ApiTags('campaigns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly audit: AuditService,
  ) {}

  @Get('stores/:storeId/promotions')
  @ApiOperation({ summary: 'List promotions' })
  list(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.campaigns.list(user, storeId);
  }

  @Post('stores/:storeId/promotions')
  @ApiOperation({ summary: 'Create a promotion (targets a segment, awards bonus points)' })
  async create(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: CreatePromotionDto, @Req() req: Request) {
    const result = await this.campaigns.create(user, storeId, dto);
    await this.audit.record({ storeId, actorUserId: user.userId, action: 'promotion.create', entity: `promo:${result.id}`, afterValue: { name: dto.name, type: dto.type }, ipAddress: req.ip, userAgent: req.header('user-agent'), requestId: getRequestId(req) });
    return result;
  }

  @Patch('promotions/:id')
  @ApiOperation({ summary: 'Update a promotion' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdatePromotionDto) {
    return this.campaigns.update(user, id, dto);
  }

  @Post('promotions/:id/activate')
  @ApiOperation({ summary: 'Activate a promotion' })
  async activate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const result = await this.campaigns.setStatus(user, id, 'ACTIVE');
    await this.audit.record({ actorUserId: user.userId, action: 'promotion.activate', entity: `promo:${id}`, ipAddress: req.ip, userAgent: req.header('user-agent'), requestId: getRequestId(req) });
    return result;
  }

  @Post('promotions/:id/pause')
  @ApiOperation({ summary: 'Pause a promotion' })
  pause(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.setStatus(user, id, 'PAUSED');
  }

  @Post('promotions/:id/end')
  @ApiOperation({ summary: 'End a promotion' })
  end(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.setStatus(user, id, 'ENDED');
  }

  @Delete('promotions/:id')
  @ApiOperation({ summary: 'Delete a promotion' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.remove(user, id);
  }
}
