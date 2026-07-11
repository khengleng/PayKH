import { Injectable, Logger } from '@nestjs/common';
import { IsBoolean, IsEnum, IsInt, IsNumberString, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { GamePlay, GameType, Payment, Prisma, Prize, PrizeType } from '@prisma/client';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';

export class CreateGameDto {
  @IsString() @MaxLength(120) name!: string;
  @IsEnum(GameType) type!: GameType;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() autoIssue?: boolean;
  @IsOptional() @IsNumberString() minPaymentAmount?: string;
}

export class UpdateGameDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() autoIssue?: boolean;
  @IsOptional() @IsNumberString() minPaymentAmount?: string;
}

export class PrizeDto {
  @IsString() @MaxLength(120) label!: string;
  @IsOptional() @IsEnum(PrizeType) type?: PrizeType;
  @IsOptional() @IsInt() @Min(0) pointsValue?: number;
  @IsOptional() @IsString() rewardId?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) weight?: number;
  @IsOptional() @IsInt() @Min(-1) stock?: number;
}

@Injectable()
export class GamesService {
  private readonly logger = new Logger('Games');

  constructor(private readonly prisma: PrismaService) {}

  private async assertStore(user: AuthUser, storeId: string, perm: 'payment:read' | 'store:write') {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }

  private async assertGame(user: AuthUser, gameId: string, perm: 'payment:read' | 'store:write') {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game) throw ApiError.paymentNotFound('Game not found');
    await this.assertStore(user, game.storeId, perm);
    return game;
  }

  // ------------------------------------------------------------------ games
  async createGame(user: AuthUser, storeId: string, dto: CreateGameDto) {
    await this.assertStore(user, storeId, 'store:write');
    const game = await this.prisma.game.create({
      data: {
        id: prefixedId('game'),
        storeId,
        name: dto.name,
        type: dto.type,
        active: dto.active ?? false,
        autoIssue: dto.autoIssue ?? false,
        minPaymentAmount: dto.minPaymentAmount ?? null,
      },
    });
    return this.getGame(user, game.id);
  }

  async listGames(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const games = await this.prisma.game.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { prizes: true, plays: true } } } });
    return games.map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type.toLowerCase(),
      active: g.active,
      auto_issue: g.autoIssue,
      min_payment_amount: g.minPaymentAmount?.toFixed(2) ?? null,
      prize_count: g._count.prizes,
      play_count: g._count.plays,
      created_at: g.createdAt.toISOString(),
    }));
  }

  async getGame(user: AuthUser, gameId: string) {
    const game = await this.assertGame(user, gameId, 'payment:read');
    const prizes = await this.prisma.prize.findMany({ where: { gameId }, orderBy: { createdAt: 'asc' } });
    const totalWeight = prizes.reduce((a, p) => a + (this.prizeAvailable(p) ? p.weight : 0), 0);
    return {
      id: game.id,
      store_id: game.storeId,
      name: game.name,
      type: game.type.toLowerCase(),
      active: game.active,
      auto_issue: game.autoIssue,
      min_payment_amount: game.minPaymentAmount?.toFixed(2) ?? null,
      prizes: prizes.map((p) => this.serializePrize(p, totalWeight)),
      created_at: game.createdAt.toISOString(),
    };
  }

  async updateGame(user: AuthUser, gameId: string, dto: UpdateGameDto) {
    await this.assertGame(user, gameId, 'store:write');
    await this.prisma.game.update({
      where: { id: gameId },
      data: {
        name: dto.name,
        active: dto.active,
        autoIssue: dto.autoIssue,
        minPaymentAmount: dto.minPaymentAmount === undefined ? undefined : dto.minPaymentAmount || null,
      },
    });
    return this.getGame(user, gameId);
  }

  async deleteGame(user: AuthUser, gameId: string) {
    await this.assertGame(user, gameId, 'store:write');
    await this.prisma.game.delete({ where: { id: gameId } });
    return { deleted: true };
  }

  // ----------------------------------------------------------------- prizes
  async addPrize(user: AuthUser, gameId: string, dto: PrizeDto) {
    await this.assertGame(user, gameId, 'store:write');
    const prize = await this.prisma.prize.create({
      data: {
        id: prefixedId('prz'),
        gameId,
        label: dto.label,
        type: dto.type ?? 'NONE',
        pointsValue: dto.pointsValue ?? 0,
        rewardId: dto.rewardId ?? null,
        weight: dto.weight ?? 1,
        stock: dto.stock ?? -1,
      },
    });
    return this.serializePrize(prize, 0);
  }

  async updatePrize(user: AuthUser, prizeId: string, dto: PrizeDto) {
    const prize = await this.prisma.prize.findUnique({ where: { id: prizeId } });
    if (!prize) throw ApiError.paymentNotFound('Prize not found');
    await this.assertGame(user, prize.gameId, 'store:write');
    const updated = await this.prisma.prize.update({
      where: { id: prizeId },
      data: { label: dto.label, type: dto.type, pointsValue: dto.pointsValue, rewardId: dto.rewardId, weight: dto.weight, stock: dto.stock },
    });
    return this.serializePrize(updated, 0);
  }

  async deletePrize(user: AuthUser, prizeId: string) {
    const prize = await this.prisma.prize.findUnique({ where: { id: prizeId } });
    if (!prize) throw ApiError.paymentNotFound('Prize not found');
    await this.assertGame(user, prize.gameId, 'store:write');
    await this.prisma.prize.delete({ where: { id: prizeId } });
    return { deleted: true };
  }

  // ------------------------------------------------------------- play/draw
  /**
   * Play a game once (API key): draw a weighted prize honoring inventory,
   * record the outcome, and — for POINTS prizes with a customer attached —
   * credit loyalty points. Returns the revealed outcome.
   */
  async play(storeId: string, gameId: string, customerId?: string) {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game || game.storeId !== storeId) throw ApiError.paymentNotFound('Game not found');
    if (!game.active) throw ApiError.invalidRequest('Game is not active');
    if (customerId) {
      const c = await this.prisma.customer.findUnique({ where: { id: customerId } });
      if (!c || c.storeId !== storeId) throw ApiError.invalidRequest('Unknown customer');
    }
    const play = await this.drawAndRecord(game.id, storeId, customerId ?? null, null);
    return this.serializePlay(play.play, play.prize);
  }

  /**
   * Core engine: pick a weighted prize whose stock is available, atomically
   * claim one unit (guarding against over-award under concurrency), record a
   * GamePlay, and credit points for POINTS prizes. `paymentId` makes an
   * auto-issued play idempotent per payment.
   */
  async drawAndRecord(gameId: string, storeId: string, customerId: string | null, paymentId: string | null) {
    const prize = await this.claimPrize(gameId);
    const won = !!prize && prize.type !== 'NONE';

    const play = await this.prisma.gamePlay.create({
      data: {
        id: prefixedId('play'),
        gameId,
        storeId,
        customerId,
        prizeId: prize?.id ?? null,
        status: 'REVEALED',
        won,
        paymentId,
        revealedAt: new Date(),
      },
    });

    await this.creditPrize(storeId, customerId, prize);
    this.logger.log(`play ${play.id} on game ${gameId}: ${prize ? prize.label : 'no prize'}${won ? ' (WON)' : ''}`);
    return { play, prize };
  }

  /** Credit loyalty points for a POINTS prize (best-effort; no-op otherwise). */
  private async creditPrize(storeId: string, customerId: string | null, prize: Prize | null) {
    if (!prize || prize.type !== 'POINTS' || prize.pointsValue <= 0 || !customerId) return;
    await this.prisma.$transaction([
      this.prisma.pointsTransaction.create({ data: { id: prefixedId('pts'), storeId, customerId, type: 'EARN', points: prize.pointsValue, reason: `game prize: ${prize.label}` } }),
      this.prisma.customer.update({ where: { id: customerId }, data: { pointsBalance: { increment: prize.pointsValue }, lifetimePoints: { increment: prize.pointsValue } } }),
    ]);
  }

  // -------------------------------------------------- scratch-card lifecycle
  /**
   * Auto-issue a scratch-card play for each active auto-issue game in the store
   * when a qualifying paid payment lands. The play is ISSUED (a card the
   * customer holds) — the prize is drawn later on reveal. Idempotent per
   * payment (unique gameId+paymentId). Best-effort; never blocks the payment.
   */
  async issueForPayment(payment: Payment): Promise<void> {
    if (!payment.customerId) return; // need a customer to hold + reveal the card
    const games = await this.prisma.game.findMany({ where: { storeId: payment.storeId, active: true, autoIssue: true } });
    for (const game of games) {
      if (game.minPaymentAmount && Number(payment.amount) < Number(game.minPaymentAmount)) continue;
      try {
        await this.prisma.gamePlay.create({
          data: { id: prefixedId('play'), gameId: game.id, storeId: payment.storeId, customerId: payment.customerId, status: 'ISSUED', paymentId: payment.id },
        });
        this.logger.log(`scratch card issued: game ${game.id} to ${payment.customerId} (payment ${payment.id})`);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue; // already issued
        this.logger.warn(`scratch-card issue failed for ${payment.id}: ${String(e)}`);
      }
    }
  }

  /** Manually grant a play (scratch card) to a customer (dashboard). */
  async issuePlay(user: AuthUser, gameId: string, customerId: string) {
    const game = await this.assertGame(user, gameId, 'store:write');
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.storeId !== game.storeId) throw ApiError.invalidRequest('Unknown customer');
    const play = await this.prisma.gamePlay.create({
      data: { id: prefixedId('play'), gameId, storeId: game.storeId, customerId, status: 'ISSUED' },
    });
    return this.serializePlay(play, null);
  }

  /** A customer's scratch cards (API key). `status` filters ISSUED (unrevealed) / REVEALED. */
  async listCustomerPlays(storeId: string, customerId: string, status?: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.storeId !== storeId) throw ApiError.paymentNotFound('Customer not found');
    const where: Prisma.GamePlayWhereInput = { storeId, customerId };
    const s = status?.toUpperCase();
    if (s === 'ISSUED' || s === 'REVEALED') where.status = s;
    const plays = await this.prisma.gamePlay.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100, include: { prize: true } });
    return plays.map((p) => this.serializePlay(p, p.prize ?? null));
  }

  /**
   * Reveal (scratch) an ISSUED play: draw a weighted prize honoring inventory,
   * transition to REVEALED, and credit points. Idempotent — revealing an
   * already-revealed play returns its stored outcome.
   */
  async reveal(storeId: string, playId: string) {
    const play = await this.prisma.gamePlay.findUnique({ where: { id: playId }, include: { prize: true } });
    if (!play || play.storeId !== storeId) throw ApiError.paymentNotFound('Play not found');
    if (play.status === 'REVEALED') return this.serializePlay(play, play.prize ?? null);

    const prize = await this.claimPrize(play.gameId);
    const won = !!prize && prize.type !== 'NONE';
    const updated = await this.prisma.gamePlay.update({
      where: { id: playId },
      data: { status: 'REVEALED', won, prizeId: prize?.id ?? null, revealedAt: new Date() },
    });
    await this.creditPrize(storeId, play.customerId, prize);
    this.logger.log(`play ${playId} revealed: ${prize ? prize.label : 'no prize'}${won ? ' (WON)' : ''}`);
    return this.serializePlay(updated, prize);
  }

  private prizeAvailable(p: Prize) {
    return p.weight > 0 && (p.stock === -1 || p.stock > 0);
  }

  /**
   * Weighted-random prize selection with atomic inventory claim. Retries on a
   * lost race (another concurrent play took the last unit), excluding the
   * contested prize each round. Returns null when nothing is claimable.
   */
  private async claimPrize(gameId: string): Promise<Prize | null> {
    const excluded = new Set<string>();
    for (let attempt = 0; attempt < 10; attempt++) {
      const prizes = (await this.prisma.prize.findMany({ where: { gameId } })).filter((p) => this.prizeAvailable(p) && !excluded.has(p.id));
      if (prizes.length === 0) return null;

      const totalWeight = prizes.reduce((a, p) => a + p.weight, 0);
      let roll = Math.random() * totalWeight;
      let chosen = prizes[prizes.length - 1];
      for (const p of prizes) {
        roll -= p.weight;
        if (roll < 0) { chosen = p; break; }
      }

      if (chosen.stock === -1) {
        await this.prisma.prize.update({ where: { id: chosen.id }, data: { awarded: { increment: 1 } } });
        return chosen;
      }
      // Conditional decrement — only succeeds if a unit is still in stock.
      const claimed = await this.prisma.prize.updateMany({ where: { id: chosen.id, stock: { gt: 0 } }, data: { stock: { decrement: 1 }, awarded: { increment: 1 } } });
      if (claimed.count === 1) return { ...chosen, stock: chosen.stock - 1, awarded: chosen.awarded + 1 };
      excluded.add(chosen.id); // lost the race — try again without this prize
    }
    return null;
  }

  // ------------------------------------------------------------------ reads
  async listPlays(user: AuthUser, gameId: string) {
    await this.assertGame(user, gameId, 'payment:read');
    const plays = await this.prisma.gamePlay.findMany({ where: { gameId }, orderBy: { createdAt: 'desc' }, take: 100, include: { prize: true } });
    return plays.map((p) => this.serializePlay(p, p.prize ?? null));
  }

  async stats(user: AuthUser, gameId: string) {
    await this.assertGame(user, gameId, 'payment:read');
    const [total, wins, prizes] = await Promise.all([
      this.prisma.gamePlay.count({ where: { gameId, status: 'REVEALED' } }),
      this.prisma.gamePlay.count({ where: { gameId, status: 'REVEALED', won: true } }),
      this.prisma.prize.findMany({ where: { gameId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      game_id: gameId,
      plays: total,
      wins,
      win_rate: total > 0 ? Number((wins / total).toFixed(4)) : 0,
      prizes: prizes.map((p) => ({ id: p.id, label: p.label, type: p.type.toLowerCase(), awarded: p.awarded, stock: p.stock, remaining: p.stock === -1 ? null : p.stock })),
    };
  }

  // ------------------------------------------------------------ serializers
  private serializePrize(p: Prize, totalWeight: number) {
    return {
      id: p.id,
      label: p.label,
      type: p.type.toLowerCase(),
      points_value: p.pointsValue,
      reward_id: p.rewardId,
      weight: p.weight,
      stock: p.stock,
      remaining: p.stock === -1 ? null : p.stock,
      awarded: p.awarded,
      probability: totalWeight > 0 && this.prizeAvailable(p) ? Number((p.weight / totalWeight).toFixed(4)) : 0,
    };
  }

  private serializePlay(play: GamePlay, prize: Prize | null) {
    return {
      id: play.id,
      customer_id: play.customerId,
      won: play.won,
      status: play.status.toLowerCase(),
      prize: prize ? { id: prize.id, label: prize.label, type: prize.type.toLowerCase(), points_value: prize.pointsValue } : null,
      created_at: play.createdAt.toISOString(),
    };
  }
}
