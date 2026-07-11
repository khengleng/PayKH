import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import { CampaignsService, CreatePromotionDto, UpdatePromotionDto } from './campaigns.service';

class RejectDto {
  @IsOptional() @IsString() note?: string;
}
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

  @Get('promotions/:id/simulate')
  @ApiOperation({ summary: 'Dry-run: estimate reach + bonus-point cost (last 30d)' })
  simulate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.simulate(user, id);
  }

  @Post('promotions/:id/submit')
  @ApiOperation({ summary: 'Submit a promotion for approval' })
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.submit(user, id);
  }

  @Post('promotions/:id/approve')
  @ApiOperation({ summary: 'Approve a promotion (owner)' })
  async approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const result = await this.campaigns.approve(user, id);
    await this.audit.record({ actorUserId: user.userId, action: 'promotion.approve', entity: `promo:${id}`, ipAddress: req.ip, userAgent: req.header('user-agent'), requestId: getRequestId(req) });
    return result;
  }

  @Post('promotions/:id/reject')
  @ApiOperation({ summary: 'Reject a promotion (owner)' })
  async reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RejectDto, @Req() req: Request) {
    const result = await this.campaigns.reject(user, id, dto.note);
    await this.audit.record({ actorUserId: user.userId, action: 'promotion.reject', entity: `promo:${id}`, afterValue: { note: dto.note }, ipAddress: req.ip, userAgent: req.header('user-agent'), requestId: getRequestId(req) });
    return result;
  }

  @Post('promotions/:id/activate')
  @ApiOperation({ summary: 'Activate a promotion (requires approval)' })
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
