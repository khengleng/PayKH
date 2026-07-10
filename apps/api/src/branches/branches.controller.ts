import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { BranchesService, CreateBranchDto, UpdateBranchDto } from './branches.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { AuditService } from '../audit/audit.service';
import { getRequestId } from '../common/request-context';

@ApiTags('branches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class BranchesController {
  constructor(
    private readonly branches: BranchesService,
    private readonly audit: AuditService,
  ) {}

  @Post('stores/:storeId/branches')
  @ApiOperation({ summary: 'Create a branch under a store' })
  async create(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: CreateBranchDto, @Req() req: Request) {
    const result = await this.branches.create(user, storeId, dto);
    await this.audit.record({
      storeId, actorUserId: user.userId, action: 'branch.create', entity: `branch:${result.id}`,
      afterValue: { name: dto.name, code: dto.code }, ipAddress: req.ip, userAgent: req.header('user-agent'), requestId: getRequestId(req),
    });
    return result;
  }

  @Get('stores/:storeId/branches')
  @ApiOperation({ summary: 'List branches for a store' })
  list(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.branches.list(user, storeId);
  }

  @Patch('branches/:id')
  @ApiOperation({ summary: 'Update a branch' })
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateBranchDto, @Req() req: Request) {
    const result = await this.branches.update(user, id, dto);
    await this.audit.record({
      storeId: result.store_id, actorUserId: user.userId, action: 'branch.update', entity: `branch:${id}`,
      afterValue: dto, ipAddress: req.ip, userAgent: req.header('user-agent'), requestId: getRequestId(req),
    });
    return result;
  }

  @Delete('branches/:id')
  @ApiOperation({ summary: 'Delete or deactivate a branch' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const result = await this.branches.remove(user, id);
    await this.audit.record({
      actorUserId: user.userId, action: 'branch.remove', entity: `branch:${id}`,
      ipAddress: req.ip, userAgent: req.header('user-agent'), requestId: getRequestId(req),
    });
    return result;
  }
}
