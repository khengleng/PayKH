import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { TeamService } from './team.service';
import { AcceptInviteDto, ChangeRoleDto, InviteDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { AuditService } from '../audit/audit.service';
import { getRequestId } from '../common/request-context';
import { ApiError } from '../common/api-error';

@ApiTags('team')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('team')
export class TeamController {
  constructor(
    private readonly team: TeamService,
    private readonly audit: AuditService,
  ) {}

  @Get('members')
  @ApiOperation({ summary: 'List organization members' })
  members(@CurrentUser() user: AuthUser, @Query('org_id') orgId: string) {
    if (!orgId) throw ApiError.invalidRequest('org_id is required');
    return this.team.listMembers(user, orgId);
  }

  @Post('invitations')
  @ApiOperation({ summary: 'Invite a user to the organization' })
  async invite(@CurrentUser() user: AuthUser, @Body() dto: InviteDto, @Req() req: Request) {
    const result = await this.team.invite(user, dto.organizationId, dto.email, dto.role);
    await this.audit.record({
      organizationId: dto.organizationId,
      actorUserId: user.userId,
      action: 'team.invite',
      entity: `invite:${result.id}`,
      afterValue: { email: dto.email, role: dto.role },
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }

  @Get('invitations')
  @ApiOperation({ summary: 'List pending invitations' })
  invitations(@CurrentUser() user: AuthUser, @Query('org_id') orgId: string) {
    if (!orgId) throw ApiError.invalidRequest('org_id is required');
    return this.team.listInvitations(user, orgId);
  }

  @Post('invitations/:id/revoke')
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.team.revokeInvitation(user, id);
  }

  @Post('invitations/accept')
  @ApiOperation({ summary: 'Accept an invitation (as the invited, logged-in user)' })
  accept(@CurrentUser() user: AuthUser, @Body() dto: AcceptInviteDto) {
    return this.team.accept(user, dto.token);
  }

  @Post('members/:userId/role')
  @ApiOperation({ summary: 'Change a member role' })
  async changeRole(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Query('org_id') orgId: string,
    @Body() dto: ChangeRoleDto,
    @Req() req: Request,
  ) {
    if (!orgId) throw ApiError.invalidRequest('org_id is required');
    const result = await this.team.changeRole(user, orgId, userId, dto.role);
    await this.audit.record({
      organizationId: orgId,
      actorUserId: user.userId,
      action: 'team.role.change',
      entity: `user:${userId}`,
      afterValue: { role: dto.role },
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }

  @Delete('members/:userId')
  @ApiOperation({ summary: 'Remove a member' })
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Query('org_id') orgId: string,
    @Req() req: Request,
  ) {
    if (!orgId) throw ApiError.invalidRequest('org_id is required');
    const result = await this.team.removeMember(user, orgId, userId);
    await this.audit.record({
      organizationId: orgId,
      actorUserId: user.userId,
      action: 'team.member.remove',
      entity: `user:${userId}`,
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }
}
