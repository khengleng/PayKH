import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { IsOptional, IsString } from 'class-validator';
import { CreateGameDto, GamesService, PrizeDto, UpdateGameDto } from './games.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { ApiKeyGuard, getApiKeyContext } from '../auth/api-key.guard';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

class PlayDto {
  @IsOptional() @IsString() customer_id?: string;
}

class IssuePlayDto {
  @IsString() customerId!: string;
}

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

  @Post('games/:gameId/issue')
  @ApiOperation({ summary: 'Manually grant a play (scratch card) to a customer' })
  issue(@CurrentUser() user: AuthUser, @Param('gameId') gameId: string, @Body() dto: IssuePlayDto) {
    return this.games.issuePlay(user, gameId, dto.customerId);
  }
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

/** Hosted play page API — NO auth; the play/game id is the bearer. IP rate-limited. */
@ApiTags('games')
@UseGuards(RateLimitGuard)
@RateLimit({ limit: 30, windowSec: 10, by: 'ip' })
@Controller('play')
export class HostedPlayController {
  constructor(private readonly games: GamesService) {}

  @Get('game/:gameId')
  @ApiOperation({ summary: 'Hosted game metadata (public)' })
  game(@Param('gameId') gameId: string) {
    return this.games.publicGetGame(gameId);
  }

  @Post('game/:gameId/play')
  @ApiOperation({ summary: 'Instant play a spin/lucky-draw game (public)' })
  instant(@Param('gameId') gameId: string, @Query('c') customerId?: string) {
    return this.games.publicInstantPlay(gameId, customerId);
  }

  @Get(':playId')
  @ApiOperation({ summary: 'Hosted play/scratch-card state (public)' })
  play(@Param('playId') playId: string) {
    return this.games.publicGetPlay(playId);
  }

  @Post(':playId/reveal')
  @ApiOperation({ summary: 'Reveal a scratch card (public)' })
  reveal(@Param('playId') playId: string) {
    return this.games.publicReveal(playId);
  }
}

/** Public scratch-card API (API key): reveal a play, list a customer's cards. */
@ApiTags('games')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, RateLimitGuard)
@RateLimit({ limit: 60, windowSec: 10, by: 'apiKey' })
@Controller({ version: '1' })
export class PlaysController {
  constructor(private readonly games: GamesService) {}

  @Post('plays/:id/reveal')
  @ApiOperation({ summary: 'Reveal (scratch) an issued play — draws the prize' })
  reveal(@Req() req: Request, @Param('id') id: string) {
    return this.games.reveal(getApiKeyContext(req).storeId, id);
  }

  @Get('customers/:id/plays')
  @ApiOperation({ summary: 'List a customer’s plays / scratch cards (filter by status)' })
  customerPlays(@Req() req: Request, @Param('id') id: string, @Query('status') status?: string) {
    return this.games.listCustomerPlays(getApiKeyContext(req).storeId, id, status);
  }
}
