import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { LlmService } from './llm.service';
import { AiController } from './ai.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AiController],
  providers: [AiService, LlmService],
  exports: [AiService, LlmService],
})
export class AiModule {}
