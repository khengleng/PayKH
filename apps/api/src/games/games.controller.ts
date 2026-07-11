import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { IsOptional, IsString } from 'class-validator';
import { CreateGameDto, GamesService, PrizeDto, UpdateGameDto } from './games.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { ApiKeyGuard, getApiKeyContext } from '../auth/api-key.guard';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

/** Dashboard game & prize management (JWT). */
@ApiTags('games')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class GamesDashboardController {
  constructor(private readonly games: GamesService) {}

  @Get('stores/:storeId/games')
  @ApiOperation({ summary: 'List promotional games' })
  list(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.games.listGames(user, storeId);
  }

  @Post('stores/:storeId/games')
  @ApiOperation({ summary: 'Create a promotional game' })
  create(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: CreateGameDto) {
    return this.games.createGame(user, storeId, dto);
  }

  @Get('games/:gameId')
  @ApiOperation({ summary: 'Get a game with its prizes' })
  get(@CurrentUser() user: AuthUser, @Param('gameId') gameId: string) {
    return this.games.getGame(user, gameId);
  }

  @Put('games/:gameId')
  @ApiOperation({ summary: 'Update a game' })
  update(@CurrentUser() user: AuthUser, @Param('gameId') gameId: string, @Body() dto: UpdateGameDto) {
    return this.games.updateGame(user, gameId, dto);
  }

  @Delete('games/:gameId')
  @ApiOperation({ summary: 'Delete a game' })
  remove(@CurrentUser() user: AuthUser, @Param('gameId') gameId: string) {
    return this.games.deleteGame(user, gameId);
  }

  @Post('games/:gameId/prizes')
  @ApiOperation({ summary: 'Add a prize to a game' })
  addPrize(@CurrentUser() user: AuthUser, @Param('gameId') gameId: string, @Body() dto: PrizeDto) {
    return this.games.addPrize(user, gameId, dto);
  }

  @Put('prizes/:prizeId')
  @ApiOperation({ summary: 'Update a prize' })
  updatePrize(@CurrentUser() user: AuthUser, @Param('prizeId') prizeId: string, @Body() dto: PrizeDto) {
    return this.games.updatePrize(user, prizeId, dto);
  }

  @Delete('prizes/:prizeId')
  @ApiOperation({ summary: 'Delete a prize' })
  removePrize(@CurrentUser() user: AuthUser, @Param('prizeId') prizeId: string) {
    return this.games.deletePrize(user, prizeId);
  }

  @Get('games/:gameId/plays')
  @ApiOperation({ summary: 'Recent plays' })
  plays(@CurrentUser() user: AuthUser, @Param('gameId') gameId: string) {
    return this.games.listPlays(user, gameId);
  }

  @Get('games/:gameId/stats')
  @ApiOperation({ summary: 'Play/win stats + prize distribution' })
  stats(@CurrentUser() user: AuthUser, @Param('gameId') gameId: string) {
    return this.games.stats(user, gameId);
  }
}

class PlayDto {
  @IsOptional() @IsString() customer_id?: string;
}

/** Public play API (API key). */
@ApiTags('games')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, RateLimitGuard)
@RateLimit({ limit: 60, windowSec: 10, by: 'apiKey' })
@Controller({ path: 'games', version: '1' })
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Post(':id/play')
  @ApiOperation({ summary: 'Play a game once — draws a weighted prize honoring inventory' })
  play(@Req() req: Request, @Param('id') id: string, @Body() dto: PlayDto) {
    return this.games.play(getApiKeyContext(req).storeId, id, dto?.customer_id);
  }
}
