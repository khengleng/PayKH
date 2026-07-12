import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, MfaCodeDto, RegisterDto, ResetPasswordDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, AuthUser } from './current-user';
import { AuditService } from '../audit/audit.service';
import { getRequestId } from '../common/request-context';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
  ) {}

  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Create a merchant account + organization' })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const result = await this.auth.register(dto);
    await this.audit.record({
      organizationId: result.organization.id,
      actorUserId: result.user.id,
      action: 'user.register',
      entity: `user:${result.user.id}`,
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }

  @Post('forgot-password')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 5, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Request a password-reset email (always 200)' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Set a new password with a reset token' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Post('login')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Log in with email + password' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const result = await this.auth.login(dto);
    await this.audit.record({
      organizationId: result.organization.id || null,
      actorUserId: result.user.id,
      action: 'user.login',
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get the current user + organizations' })
  async me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }

  @Post('change-password')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Change password (requires current password)' })
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.userId, dto.currentPassword, dto.newPassword);
  }

  @Post('mfa/setup')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Begin MFA setup (returns secret + otpauth URL)' })
  mfaSetup(@CurrentUser() user: AuthUser) {
    return this.mfa.setup(user.userId);
  }

  @Post('mfa/enable')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Confirm and enable MFA with a TOTP code' })
  async mfaEnable(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto, @Req() req: Request) {
    const result = await this.mfa.enable(user.userId, dto.code);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'mfa.enable',
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }

  @Post('mfa/disable')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Disable MFA (requires a valid code)' })
  async mfaDisable(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto, @Req() req: Request) {
    const result = await this.mfa.disable(user.userId, dto.code);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'mfa.disable',
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      requestId: getRequestId(req),
    });
    return result;
  }
}
