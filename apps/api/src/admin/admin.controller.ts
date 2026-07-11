import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminService, UpsertPlanDto } from './admin.service';
import { VerificationService } from '../verification/verification.service';
import { RejectVerificationDto } from '../verification/dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { AuditService } from '../audit/audit.service';
import { getRequestId } from '../common/request-context';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly verification: VerificationService,
    private readonly audit: AuditService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Whether the caller is a platform admin' })
  me(@CurrentUser() user: AuthUser) {
    return this.admin.whoami(user);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Platform-wide metrics' })
  metrics(@CurrentUser() user: AuthUser) {
    return this.admin.platformMetrics(user);
  }

  @Get('support/search')
  @ApiOperation({ summary: 'Universal support lookup (payments/customers/stores/orgs)' })
  supportSearch(@CurrentUser() user: AuthUser, @Query('q') q: string) {
    return this.admin.supportSearch(user, q);
  }

  @Get('queues')
  @ApiOperation({ summary: 'BullMQ queue depths' })
  queues(@CurrentUser() user: AuthUser) {
    return this.admin.queueStats(user);
  }

  @Get('orgs')
  @ApiOperation({ summary: 'List all organizations (merchants)' })
  orgs(@CurrentUser() user: AuthUser, @Query('search') search?: string) {
    return this.admin.listOrgs(user, search);
  }

  @Get('orgs/:id')
  @ApiOperation({ summary: 'Organization detail' })
  org(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.getOrg(user, id);
  }

  @Post('orgs/:id/suspend')
  @ApiOperation({ summary: 'Suspend a merchant' })
  async suspend(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const result = await this.admin.setSuspended(user, id, true);
    await this.audit.record({
      organizationId: id, actorUserId: user.userId, action: 'admin.org.suspend', entity: `org:${id}`,
      ipAddress: req.ip, userAgent: req.header('user-agent'), requestId: getRequestId(req),
    });
    return result;
  }

  @Post('orgs/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a merchant' })
  async reactivate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const result = await this.admin.setSuspended(user, id, false);
    await this.audit.record({
      organizationId: id, actorUserId: user.userId, action: 'admin.org.reactivate', entity: `org:${id}`,
      ipAddress: req.ip, userAgent: req.header('user-agent'), requestId: getRequestId(req),
    });
    return result;
  }

  @Get('verifications')
  @ApiOperation({ summary: 'List merchant verifications pending review' })
  async verifications(@CurrentUser() user: AuthUser) {
    await this.admin.assertAdmin(user.userId);
    return this.verification.listForReview();
  }

  @Post('verifications/:orgId/approve')
  @ApiOperation({ summary: 'Approve a merchant verification' })
  async approve(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string, @Req() req: Request) {
    await this.admin.assertAdmin(user.userId);
    const result = await this.verification.review(orgId, true, user.userId);
    await this.audit.record({
      organizationId: orgId, actorUserId: user.userId, action: 'verification.approve', entity: `org:${orgId}`,
      ipAddress: req.ip, userAgent: req.header('user-agent'), requestId: getRequestId(req),
    });
    return result;
  }

  @Post('verifications/:orgId/reject')
  @ApiOperation({ summary: 'Reject a merchant verification' })
  async reject(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string, @Body() dto: RejectVerificationDto, @Req() req: Request) {
    await this.admin.assertAdmin(user.userId);
    const result = await this.verification.review(orgId, false, user.userId, dto.reason);
    await this.audit.record({
      organizationId: orgId, actorUserId: user.userId, action: 'verification.reject', entity: `org:${orgId}`,
      afterValue: { reason: dto.reason }, ipAddress: req.ip, userAgent: req.header('user-agent'), requestId: getRequestId(req),
    });
    return result;
  }

  @Get('plans')
  @ApiOperation({ summary: 'List plans' })
  plans(@CurrentUser() user: AuthUser) {
    return this.admin.listPlans(user);
  }

  @Post('plans')
  @ApiOperation({ summary: 'Create or update a plan' })
  async upsertPlan(@CurrentUser() user: AuthUser, @Body() dto: UpsertPlanDto, @Req() req: Request) {
    const result = await this.admin.upsertPlan(user, dto);
    await this.audit.record({
      actorUserId: user.userId, action: 'admin.plan.upsert', entity: `plan:${dto.id}`, afterValue: dto,
      ipAddress: req.ip, userAgent: req.header('user-agent'), requestId: getRequestId(req),
    });
    return result;
  }
}
