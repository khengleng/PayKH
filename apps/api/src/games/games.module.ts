import { Module } from '@nestjs/common';
import { GamesService } from './games.service';
import { GamesController, GamesDashboardController } from './games.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [GamesDashboardController, GamesController],
  providers: [GamesService],
  exports: [GamesService],
})
export class GamesModule {}
