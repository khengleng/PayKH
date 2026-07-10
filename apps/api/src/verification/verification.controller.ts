import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { VerificationService } from './verification.service';
import { SubmitVerificationDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { AuditService } from '../audit/audit.service';
import { getRequestId } from '../common/request-context';
import { ApiError } from '../common/api-error';

@ApiTags('verification')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('verification')
export class VerificationController {
  constructor(
    private readonly verification: VerificationService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Submit merchant verification (KYC)' })
  async submit(@CurrentUser() user: AuthUser, @Body() dto: SubmitVerificationDto, @Req() req: Request) {
    const result = await this.verification.submit(user, dto);
    await this.audit.record({
      organizationId: dto.organizationId,
      actorUserId: user.userId,
      action: 'verification.submit',
      entity: `org:${dto.organizationId}`,
      afterValue: { legalName: dto.legalName, businessType: dto.businessType },
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }

  @Get()
  @ApiOperation({ summary: 'Get verification status for an organization' })
  get(@CurrentUser() user: AuthUser, @Query('org_id') orgId: string) {
    if (!orgId) throw ApiError.invalidRequest('org_id is required');
    return this.verification.get(user, orgId);
  }
}
