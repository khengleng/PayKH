import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiService, AssistantDto, MarketingCopyDto } from './ai.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RateLimitGuard)
@RateLimit({ limit: 20, windowSec: 60, by: 'ip' })
@Controller('dashboard')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('stores/:storeId/ai/marketing-copy')
  @ApiOperation({ summary: 'Generate promotional copy' })
  marketing(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: MarketingCopyDto) {
    return this.ai.marketingCopy(user, storeId, dto);
  }

  @Get('stores/:storeId/ai/campaign-suggest')
  @ApiOperation({ summary: 'Suggest a promotion from store data' })
  campaign(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.ai.suggestCampaign(user, storeId);
  }

  @Get('stores/:storeId/ai/analytics-summary')
  @ApiOperation({ summary: 'Natural-language performance summary' })
  summary(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.ai.analyticsSummary(user, storeId);
  }

  @Get('stores/:storeId/ai/fraud-insights')
  @ApiOperation({ summary: 'Fraud/risk narrative from open cases' })
  fraud(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.ai.fraudInsights(user, storeId);
  }

  @Post('stores/:storeId/ai/assistant')
  @ApiOperation({ summary: 'Ask the merchant assistant a question' })
  assistant(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: AssistantDto) {
    return this.ai.assistant(user, storeId, dto);
  }
}
