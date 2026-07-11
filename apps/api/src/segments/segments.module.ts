import { Module } from '@nestjs/common';
import { SegmentsService } from './segments.service';
import { SegmentsController } from './segments.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [SegmentsController],
  providers: [SegmentsService],
  exports: [SegmentsService],
})
export class SegmentsModule {}
