import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { LlmService } from './llm.service';
import { GovernanceService } from './governance.service';
import { AiController, AiGovernanceController } from './ai.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AiController, AiGovernanceController],
  providers: [AiService, LlmService, GovernanceService],
  exports: [AiService, LlmService, GovernanceService],
})
export class AiModule {}
