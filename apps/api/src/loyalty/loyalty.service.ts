import { Injectable, Logger } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Payment, PointsTransaction, Prisma, Redemption, Reward } from '@prisma/client';
import { prefixedId, randomBase58 } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { CampaignsService } from '../campaigns/campaigns.service';
import { LedgerService } from '../ledger/ledger.service';
import { IdempotencyService } from '../idempotency/idempotency.module';

export class UpdateProgramDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() pointsPerUnit?: string; // decimal string
  /** Rolling expiry window in months. null clears it (points never expire). */
  @IsOptional() @IsInt() @Min(1) expiryMonths?: number | null;
}

export class AdjustDto {
  @IsInt() points!: number; // signed: + to grant, - to deduct
  @IsOptional() @IsString() reason?: string;
}

export class RedeemDto {
  @IsInt() @Min(1) points!: number;
  @IsOptional() @IsString() reason?: string;
}

export class CreateTierDto {
  @IsString() @MaxLength(60) name!: string;
  @IsInt() @Min(0) threshold!: number;
  @IsOptional() @IsString() earnMultiplier?: string; // decimal string, e.g. "1.5"
}

export class UpdateTierDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsInt() @Min(0) threshold?: number;
  @IsOptional() @IsString() earnMultiplier?: string;
}

export class CreateRewardDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsInt() @Min(1) pointsCost!: number;
  @IsOptional() @IsInt() stock?: number; // -1 = unlimited
}

export class UpdateRewardDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsInt() @Min(1) pointsCost?: number;
  @IsOptional() @IsInt() stock?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger('Loyalty');

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly ledgerService: LedgerService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ------------------------------------------------------------- program
  async getProgram(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'store:read');
    const p = await this.prisma.loyaltyProgram.findUnique({ where: { storeId } });
    return {
      store_id: storeId,
      active: p?.active ?? false,
      points_per_unit: (p?.pointsPerUnit ?? new Prisma.Decimal(1)).toString(),
      expiry_months: p?.expiryMonths ?? null,
    };
  }

  async updateProgram(user: AuthUser, storeId: string, dto: UpdateProgramDto) {
    await this.assertStore(user, storeId, 'store:write');
    const data = {
      active: dto.active,
      pointsPerUnit: dto.pointsPerUnit ? new Prisma.Decimal(dto.pointsPerUnit) : undefined,
      // `null` clears the window; `undefined` leaves it alone.
      expiryMonths: dto.expiryMonths === undefined ? undefined : dto.expiryMonths,
    };
    const p = await this.prisma.loyaltyProgram.upsert({
      where: { storeId },
      create: { storeId, active: dto.active ?? false, pointsPerUnit: data.pointsPerUnit ?? new Prisma.Decimal(1), expiryMonths: dto.expiryMonths ?? null },
      update: data,
    });
    return { store_id: storeId, active: p.active, points_per_unit: p.pointsPerUnit.toString(), expiry_months: p.expiryMonths };
  }

  /**
   * Outstanding points liability: the accounting cost of unredeemed points.
   * liability = Σ(customer balances) × pointValue (currency per point). Includes
   * lifetime earned/redeemed context and the largest holders. No schema change —
   * pointValue is supplied per query.
   */
  async liability(user: AuthUser, storeId: string, pointValue = 0.01) {
    await this.assertStore(user, storeId, 'payment:read');
    const [balAgg, holders, earned, redeemed, topHolders] = await Promise.all([
      this.prisma.customer.aggregate({ where: { storeId }, _sum: { pointsBalance: true } }),
      this.prisma.customer.count({ where: { storeId, pointsBalance: { gt: 0 } } }),
      this.prisma.pointsTransaction.aggregate({ where: { storeId, type: 'EARN' }, _sum: { points: true } }),
      this.prisma.pointsTransaction.aggregate({ where: { storeId, type: 'REDEEM' }, _sum: { points: true } }),
      this.prisma.customer.findMany({ where: { storeId, pointsBalance: { gt: 0 } }, orderBy: { pointsBalance: 'desc' }, take: 10, select: { id: true, name: true, email: true, pointsBalance: true } }),
    ]);
    const outstanding = balAgg._sum.pointsBalance ?? 0;
    const totalEarned = earned._sum.points ?? 0;
    const totalRedeemed = Math.abs(redeemed._sum.points ?? 0); // REDEEM points are negative
    return {
      store_id: storeId,
      point_value: pointValue,
      outstanding_points: outstanding,
      estimated_liability: (outstanding * pointValue).toFixed(2),
      customers_with_balance: holders,
      lifetime_earned: totalEarned,
      lifetime_redeemed: totalRedeemed,
      redemption_rate: totalEarned > 0 ? Number((totalRedeemed / totalEarned).toFixed(4)) : 0,
      top_holders: topHolders.map((c) => ({ id: c.id, name: c.name ?? c.email ?? c.id, points: c.pointsBalance, value: (c.pointsBalance * pointValue).toFixed(2) })),
    };
  }

  // -------------------------------------------------------------- earning
  /** Award points for a paid payment (idempotent per payment). Called on paid.
   *  Applies the customer's tier earn-multiplier, updates lifetime points, and
   *  re-assigns their tier if they cross a threshold. */
  async awardForPayment(payment: Payment): Promise<void> {
    if (!payment.customerId) return;
    const program = await this.prisma.loyaltyProgram.findUnique({ where: { storeId: payment.storeId } });
    if (!program?.active) return;

    const base = Math.floor(Number(payment.amount) * Number(program.pointsPerUnit));
    if (base <= 0) return;

    // Idempotency: never award twice for the same payment.
    const existing = await this.prisma.pointsTransaction.findFirst({ where: { paymentId: payment.id, type: 'EARN' } });
    if (existing) return;

    const customer = await this.prisma.customer.findUnique({ where: { id: payment.customerId }, include: { tier: true } });
    if (!customer) return;

    const multiplier = customer.tier ? Number(customer.tier.earnMultiplier) : 1;
    const earned = Math.floor(base * multiplier);
    if (earned <= 0) return;
    const newLifetime = customer.lifetimePoints + earned;
    const newTierId = await this.computeTierId(payment.storeId, newLifetime);

    // Narrowed above, but re-bound so it stays non-null inside the closure.
    const customerId = payment.customerId;
    const txnId = prefixedId('pts');
    await this.prisma.$transaction(async (tx) => {
      await tx.pointsTransaction.create({
        data: { id: txnId, storeId: payment.storeId, customerId, type: 'EARN', points: earned, paymentId: payment.id, reason: multiplier !== 1 ? `payment (x${multiplier})` : 'payment', confirmedAt: new Date() },
      });
      await tx.customer.update({
        where: { id: customerId },
        data: { pointsBalance: { increment: earned }, lifetimePoints: newLifetime, tierId: newTierId },
      });
      // Share the transaction: the sub-ledger row, the denormalised balance and
      // the journal commit together or not at all. Posting outside it would let
      // a rollback leave the ledger claiming an obligation that no points
      // transaction backs.
      await this.ledgerService.postPointsMovement('EARN', txnId, payment.storeId, customerId, earned, tx);
    });
    this.logger.log(`awarded ${earned} pts (base ${base} x${multiplier}) to ${payment.customerId}; lifetime ${newLifetime}`);

    // Apply any active campaign promotions (bonus points on top of base earn).
    await this.campaigns.applyToPayment(payment, base);
  }

  // ------------------------------------------------------------- expiry
  /**
   * Expire points older than the program's rolling window (spec §10).
   *
   * Until now `PointsTxnType.EXPIRE` had no writers at all: points never
   * expired, so loyalty liability could only ever grow. This closes that.
   *
   * FIFO without a lots table. A lot ledger would be the textbook model, but
   * the same answer falls out of the transaction log: under FIFO every
   * redemption consumes the oldest points first, so the points still alive from
   * before the cutoff are simply `(earned before cutoff) - (everything consumed
   * since)`, floored at zero. That avoids a schema migration that would have to
   * invent lot boundaries for historical rows it cannot actually reconstruct.
   *
   * Naturally idempotent: the EXPIRE row it writes is itself consumption, so a
   * second pass computes zero. Re-running cannot double-expire.
   */
  async expireForStore(storeId: string): Promise<{ customers: number; points: number }> {
    const program = await this.prisma.loyaltyProgram.findUnique({ where: { storeId } });
    if (!program?.active || !program.expiryMonths) return { customers: 0, points: 0 };

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - program.expiryMonths);

    const customers = await this.prisma.customer.findMany({
      where: { storeId, pointsBalance: { gt: 0 } },
      select: { id: true },
    });

    let touched = 0;
    let points = 0;
    for (const c of customers) {
      try {
        const n = await this.expireCustomer(storeId, c.id, cutoff, program.expiryMonths);
        if (n > 0) { touched++; points += n; }
      } catch (e) {
        // One customer's failure must not strand the rest of the store.
        this.logger.error(`expiry failed for ${c.id}: ${e}`);
      }
    }
    if (points > 0) this.logger.log(`expired ${points} pts across ${touched} customer(s) in ${storeId}`);
    return { customers: touched, points };
  }

  private async expireCustomer(storeId: string, customerId: string, cutoff: Date, months: number): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer || customer.pointsBalance <= 0) return 0;

      // Only CONFIRMED movements count — an unconfirmed earn is not yet the
      // customer's, and must not be aged out as though it were.
      const txns = await tx.pointsTransaction.findMany({
        where: { customerId, status: 'CONFIRMED' },
        select: { points: true, createdAt: true },
      });

      const earnedBeforeCutoff = txns
        .filter((t) => t.points > 0 && t.createdAt < cutoff)
        .reduce((s, t) => s + t.points, 0);
      const consumed = txns
        .filter((t) => t.points < 0)
        .reduce((s, t) => s + Math.abs(t.points), 0);

      const unconsumedOld = Math.max(0, earnedBeforeCutoff - consumed);
      // Never expire more than they actually hold: an adjust-down could already
      // have taken the balance below what the age arithmetic implies.
      const expirable = Math.min(unconsumedOld, customer.pointsBalance);
      if (expirable <= 0) return 0;

      const txnId = prefixedId('pts');
      await tx.pointsTransaction.create({
        data: {
          id: txnId,
          storeId,
          customerId,
          type: 'EXPIRE',
          points: -expirable,
          reason: `expired (earned over ${months} month(s) ago)`,
          confirmedAt: new Date(),
        },
      });
      await tx.customer.update({
        where: { id: customerId },
        // lifetimePoints is deliberately untouched: it is the tier basis, and
        // expiry must not silently demote someone for the passage of time.
        data: { pointsBalance: customer.pointsBalance - expirable },
      });
      await this.ledgerService.postPointsMovement('EXPIRE', txnId, storeId, customerId, -expirable, tx);
      return expirable;
    });
  }

  /** Highest tier whose threshold the lifetime points satisfy (or null). */
  private async computeTierId(storeId: string, lifetimePoints: number): Promise<string | null> {
    const tier = await this.prisma.loyaltyTier.findFirst({
      where: { storeId, threshold: { lte: lifetimePoints } },
      orderBy: { threshold: 'desc' },
    });
    return tier?.id ?? null;
  }

  // ---------------------------------------------------- redeem / adjust
  async redeem(storeId: string, customerId: string, points: number, reason?: string) {
    return this.mutate(storeId, customerId, 'REDEEM', -Math.abs(points), reason);
  }

  async adjust(user: AuthUser, customerId: string, points: number, reason?: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw ApiError.paymentNotFound('Customer not found');
    await this.assertStore(user, customer.storeId, 'store:write');
    return this.mutate(customer.storeId, customerId, 'ADJUST', points, reason);
  }

  /**
   * Redeem via the public API with replay protection (spec §25: write APIs that
   * issue or redeem value must be idempotent). A retried redeem returns the
   * original result instead of deducting the points twice.
   */
  async redeemIdempotent(
    storeId: string,
    mode: string,
    customerId: string,
    points: number,
    idempotencyKey: string | undefined,
    rawBody: string,
    reason?: string,
  ) {
    return this.idempotency.execute({
      scopeId: storeId,
      // Mode is part of the namespace so a test-mode key cannot replay a
      // live-mode redemption within one store.
      endpoint: `POST /v1/loyalty/redeem:${mode}`,
      key: idempotencyKey,
      rawBody,
      run: async (tx) => ({
        resource: await this.mutateIn(tx, storeId, customerId, 'REDEEM', -Math.abs(points), reason),
        status: 200,
      }),
    });
  }

  private async mutate(storeId: string, customerId: string, type: 'REDEEM' | 'ADJUST', delta: number, reason?: string) {
    return this.prisma.$transaction((tx) => this.mutateIn(tx, storeId, customerId, type, delta, reason));
  }

  /** The balance mutation itself, on a caller-supplied transaction so it can be
   *  composed with the idempotency record write in one atomic unit. */
  private async mutateIn(tx: Prisma.TransactionClient, storeId: string, customerId: string, type: 'REDEEM' | 'ADJUST', delta: number, reason?: string) {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.storeId !== storeId) throw ApiError.invalidRequest('Unknown customer for this store');
    const newBalance = customer.pointsBalance + delta;
    if (newBalance < 0) throw ApiError.invalidRequest('Insufficient points balance');
    const txnId = prefixedId('pts');
    await tx.pointsTransaction.create({
      data: { id: txnId, storeId, customerId, type, points: delta, reason: reason ?? null, confirmedAt: new Date() },
    });
    const updated = await tx.customer.update({ where: { id: customerId }, data: { pointsBalance: newBalance } });
    await this.ledgerService.postPointsMovement(type, txnId, storeId, customerId, delta, tx);
    return { customer_id: customerId, type: type.toLowerCase(), points: delta, balance: updated.pointsBalance };
  }

  // --------------------------------------------------------------- reads
  async ledger(user: AuthUser, customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw ApiError.paymentNotFound('Customer not found');
    await this.assertStore(user, customer.storeId, 'payment:read');
    const txns = await this.prisma.pointsTransaction.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { customer_id: customerId, balance: customer.pointsBalance, transactions: txns.map((t) => this.serialize(t)) };
  }

  private serialize(t: PointsTransaction) {
    return {
      id: t.id,
      type: t.type.toLowerCase(),
      points: t.points,
      payment_id: t.paymentId,
      reason: t.reason,
      created_at: t.createdAt.toISOString(),
    };
  }

  private async assertStore(user: AuthUser, storeId: string, perm: 'store:read' | 'store:write' | 'payment:read') {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }

  // ============================================================== tiers
  async listTiers(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'store:read');
    const tiers = await this.prisma.loyaltyTier.findMany({ where: { storeId }, orderBy: { threshold: 'asc' } });
    return tiers.map((t) => this.serializeTier(t));
  }

  async createTier(user: AuthUser, storeId: string, dto: CreateTierDto) {
    await this.assertStore(user, storeId, 'store:write');
    const tier = await this.prisma.loyaltyTier.create({
      data: { id: prefixedId('tier'), storeId, name: dto.name, threshold: dto.threshold, earnMultiplier: new Prisma.Decimal(dto.earnMultiplier ?? '1') },
    });
    return this.serializeTier(tier);
  }

  async updateTier(user: AuthUser, tierId: string, dto: UpdateTierDto) {
    const tier = await this.prisma.loyaltyTier.findUnique({ where: { id: tierId } });
    if (!tier) throw ApiError.paymentNotFound('Tier not found');
    await this.assertStore(user, tier.storeId, 'store:write');
    const updated = await this.prisma.loyaltyTier.update({
      where: { id: tierId },
      data: { name: dto.name, threshold: dto.threshold, earnMultiplier: dto.earnMultiplier ? new Prisma.Decimal(dto.earnMultiplier) : undefined },
    });
    return this.serializeTier(updated);
  }

  async deleteTier(user: AuthUser, tierId: string) {
    const tier = await this.prisma.loyaltyTier.findUnique({ where: { id: tierId } });
    if (!tier) throw ApiError.paymentNotFound('Tier not found');
    await this.assertStore(user, tier.storeId, 'store:write');
    // Detach customers currently on this tier (recompute lazily on next earn).
    await this.prisma.customer.updateMany({ where: { tierId }, data: { tierId: null } });
    await this.prisma.loyaltyTier.delete({ where: { id: tierId } });
    return { id: tierId, deleted: true };
  }

  private serializeTier(t: { id: string; name: string; threshold: number; earnMultiplier: Prisma.Decimal }) {
    return { id: t.id, name: t.name, threshold: t.threshold, earn_multiplier: t.earnMultiplier.toString() };
  }

  // ============================================================ rewards
  async createReward(user: AuthUser, storeId: string, dto: CreateRewardDto) {
    await this.assertStore(user, storeId, 'store:write');
    const reward = await this.prisma.reward.create({
      data: { id: prefixedId('rwd'), storeId, name: dto.name, description: dto.description ?? null, pointsCost: dto.pointsCost, stock: dto.stock ?? -1 },
    });
    return this.serializeReward(reward);
  }

  async updateReward(user: AuthUser, rewardId: string, dto: UpdateRewardDto) {
    const reward = await this.prisma.reward.findUnique({ where: { id: rewardId } });
    if (!reward) throw ApiError.paymentNotFound('Reward not found');
    await this.assertStore(user, reward.storeId, 'store:write');
    const updated = await this.prisma.reward.update({ where: { id: rewardId }, data: { name: dto.name, description: dto.description, pointsCost: dto.pointsCost, stock: dto.stock, active: dto.active } });
    return this.serializeReward(updated);
  }

  async deleteReward(user: AuthUser, rewardId: string) {
    const reward = await this.prisma.reward.findUnique({ where: { id: rewardId } });
    if (!reward) throw ApiError.paymentNotFound('Reward not found');
    await this.assertStore(user, reward.storeId, 'store:write');
    const used = await this.prisma.redemption.count({ where: { rewardId } });
    if (used > 0) {
      await this.prisma.reward.update({ where: { id: rewardId }, data: { active: false } });
      return { id: rewardId, deactivated: true };
    }
    await this.prisma.reward.delete({ where: { id: rewardId } });
    return { id: rewardId, deleted: true };
  }

  /** Dashboard list (all) or public list (active only). */
  async listRewards(storeId: string, activeOnly: boolean) {
    const rewards = await this.prisma.reward.findMany({
      where: { storeId, ...(activeOnly ? { active: true } : {}) },
      orderBy: { pointsCost: 'asc' },
    });
    return rewards.map((r) => this.serializeReward(r));
  }

  async listRewardsForUser(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'store:read');
    return this.listRewards(storeId, false);
  }

  // ======================================================== redemption
  /** Redeem points for a catalog reward: atomic points + stock + voucher. */
  async redeemReward(storeId: string, customerId: string, rewardId: string): Promise<ReturnType<LoyaltyService['serializeRedemption']>> {
    return this.prisma.$transaction(async (tx) => {
      const reward = await tx.reward.findUnique({ where: { id: rewardId } });
      if (!reward || reward.storeId !== storeId) throw ApiError.invalidRequest('Unknown reward for this store');
      if (!reward.active) throw ApiError.invalidRequest('Reward is not available');
      if (reward.stock === 0) throw ApiError.invalidRequest('Reward is out of stock');

      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer || customer.storeId !== storeId) throw ApiError.invalidRequest('Unknown customer for this store');
      if (customer.pointsBalance < reward.pointsCost) throw ApiError.invalidRequest('Insufficient points balance');

      // Deduct points.
      await tx.pointsTransaction.create({
        data: { id: prefixedId('pts'), storeId, customerId, type: 'REDEEM', points: -reward.pointsCost, reason: `reward:${reward.name}` },
      });
      await tx.customer.update({ where: { id: customerId }, data: { pointsBalance: customer.pointsBalance - reward.pointsCost } });
      // Decrement stock (unless unlimited).
      if (reward.stock > 0) await tx.reward.update({ where: { id: rewardId }, data: { stock: reward.stock - 1 } });

      const redemption = await tx.redemption.create({
        data: { id: prefixedId('rdm'), storeId, customerId, rewardId, pointsSpent: reward.pointsCost, code: `R${randomBase58(8).toUpperCase()}`, status: 'ISSUED' },
      });
      this.logger.log(`redemption ${redemption.id} (${reward.name}, ${reward.pointsCost}pts) for ${customerId}`);
      return this.serializeRedemption(redemption, reward);
    });
  }

  async getRedemption(user: AuthUser, id: string) {
    const r = await this.prisma.redemption.findUnique({ where: { id }, include: { reward: true } });
    if (!r) throw ApiError.paymentNotFound('Redemption not found');
    await this.assertStore(user, r.storeId, 'payment:read');
    return this.serializeRedemption(r, r.reward);
  }

  /** Store-scoped redemption fetch for the public API-key path. */
  async redemptionForStore(storeId: string, id: string) {
    const r = await this.prisma.redemption.findUnique({ where: { id }, include: { reward: true } });
    if (!r || r.storeId !== storeId) throw ApiError.paymentNotFound('Redemption not found');
    return this.serializeRedemption(r, r.reward);
  }

  async listRedemptions(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const rows = await this.prisma.redemption.findMany({ where: { storeId }, include: { reward: true, customer: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((r) => ({ ...this.serializeRedemption(r, r.reward), customer_name: r.customer.name, customer_email: r.customer.email }));
  }

  async fulfill(user: AuthUser, id: string) {
    const r = await this.prisma.redemption.findUnique({ where: { id } });
    if (!r) throw ApiError.paymentNotFound('Redemption not found');
    await this.assertStore(user, r.storeId, 'store:write');
    if (r.status !== 'ISSUED') throw ApiError.invalidRequest(`Cannot fulfill a ${r.status.toLowerCase()} redemption`);
    const updated = await this.prisma.redemption.update({ where: { id }, data: { status: 'FULFILLED', fulfilledAt: new Date() } });
    return this.serializeRedemption(updated);
  }

  /** Cancel an issued redemption: refund points + restore stock. */
  async cancel(user: AuthUser, id: string) {
    const r = await this.prisma.redemption.findUnique({ where: { id } });
    if (!r) throw ApiError.paymentNotFound('Redemption not found');
    await this.assertStore(user, r.storeId, 'store:write');
    if (r.status !== 'ISSUED') throw ApiError.invalidRequest(`Cannot cancel a ${r.status.toLowerCase()} redemption`);
    await this.prisma.$transaction(async (tx) => {
      await tx.pointsTransaction.create({ data: { id: prefixedId('pts'), storeId: r.storeId, customerId: r.customerId, type: 'ADJUST', points: r.pointsSpent, reason: 'redemption cancelled' } });
      await tx.customer.update({ where: { id: r.customerId }, data: { pointsBalance: { increment: r.pointsSpent } } });
      await tx.reward.updateMany({ where: { id: r.rewardId, stock: { gte: 0 } }, data: { stock: { increment: 1 } } });
      await tx.redemption.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    return { id, cancelled: true, refunded_points: r.pointsSpent };
  }

  private serializeReward(r: Reward) {
    return { id: r.id, store_id: r.storeId, name: r.name, description: r.description, points_cost: r.pointsCost, stock: r.stock, active: r.active };
  }

  private serializeRedemption(r: Redemption, reward?: Reward | null) {
    return {
      id: r.id,
      customer_id: r.customerId,
      reward_id: r.rewardId,
      reward_name: reward?.name ?? null,
      points_spent: r.pointsSpent,
      code: r.code,
      status: r.status.toLowerCase(),
      created_at: r.createdAt.toISOString(),
      fulfilled_at: r.fulfilledAt?.toISOString() ?? null,
    };
  }
}
