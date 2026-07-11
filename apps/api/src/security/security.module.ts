import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SecurityService } from './security.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { AuthModule } from '../auth/auth.module';

@ApiTags('security')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/security')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get('posture')
  @ApiOperation({ summary: 'Security-posture self-assessment (platform admin)' })
  posture(@CurrentUser() user: AuthUser) {
    return this.security.posture(user);
  }

  @Get('monitoring')
  @ApiOperation({ summary: 'Synthetic monitoring — dependency health + throughput' })
  monitoring(@CurrentUser() user: AuthUser) {
    return this.security.monitoring(user);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [SecurityController],
  providers: [SecurityService],
})
export class SecurityModule {}
