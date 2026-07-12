import { Body, Controller, Get, Module, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsObject, IsString } from 'class-validator';
import { AccessService } from './access.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { AbacResource } from '../auth/abac';
import { AuthModule } from '../auth/auth.module';

class CheckDto {
  @IsString() action!: string;
  @IsObject() resource!: AbacResource;
}

@ApiTags('access')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('orgs/:orgId/access/matrix')
  @ApiOperation({ summary: 'RBAC role×permission matrix + ABAC policy catalogue' })
  matrix(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string) {
    return this.access.matrix(user, orgId);
  }

  @Post('orgs/:orgId/access/check')
  @ApiOperation({ summary: 'Simulate an ABAC decision for the current user' })
  check(@CurrentUser() user: AuthUser, @Param('orgId') orgId: string, @Body() dto: CheckDto) {
    return this.access.check(user, orgId, dto.action, dto.resource);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [AccessController],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
