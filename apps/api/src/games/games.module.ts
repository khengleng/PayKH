import { Module } from '@nestjs/common';
import { GamesService } from './games.service';
import { GamesController, GamesDashboardController, PlaysController } from './games.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [GamesDashboardController, GamesController, PlaysController],
  providers: [GamesService],
  exports: [GamesService],
})
export class GamesModule {}
