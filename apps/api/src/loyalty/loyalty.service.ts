import { Injectable, Logger } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Payment, PointsTransaction, Prisma, Redemption, Reward } from '@prisma/client';
import { prefixedId, randomBase58 } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';

export class UpdateProgramDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() pointsPerUnit?: string; // decimal string
}

export class AdjustDto {
  @IsInt() points!: number; // signed: + to grant, - to deduct
  @IsOptional() @IsString() reason?: string;
}

export class RedeemDto {
  @IsInt() @Min(1) points!: number;
  @IsOptional() @IsString() reason?: string;
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

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------- program
  async getProgram(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'store:read');
    const p = await this.prisma.loyaltyProgram.findUnique({ where: { storeId } });
    return {
      store_id: storeId,
      active: p?.active ?? false,
      points_per_unit: (p?.pointsPerUnit ?? new Prisma.Decimal(1)).toString(),
    };
  }

  async updateProgram(user: AuthUser, storeId: string, dto: UpdateProgramDto) {
    await this.assertStore(user, storeId, 'store:write');
    const data = {
      active: dto.active,
      pointsPerUnit: dto.pointsPerUnit ? new Prisma.Decimal(dto.pointsPerUnit) : undefined,
    };
    const p = await this.prisma.loyaltyProgram.upsert({
      where: { storeId },
      create: { storeId, active: dto.active ?? false, pointsPerUnit: data.pointsPerUnit ?? new Prisma.Decimal(1) },
      update: data,
    });
    return { store_id: storeId, active: p.active, points_per_unit: p.pointsPerUnit.toString() };
  }

  // -------------------------------------------------------------- earning
  /** Award points for a paid payment (idempotent per payment). Called on paid. */
  async awardForPayment(payment: Payment): Promise<void> {
    if (!payment.customerId) return;
    const program = await this.prisma.loyaltyProgram.findUnique({ where: { storeId: payment.storeId } });
    if (!program?.active) return;

    const points = Math.floor(Number(payment.amount) * Number(program.pointsPerUnit));
    if (points <= 0) return;

    // Idempotency: never award twice for the same payment.
    const existing = await this.prisma.pointsTransaction.findFirst({
      where: { paymentId: payment.id, type: 'EARN' },
    });
    if (existing) return;

    await this.prisma.$transaction([
      this.prisma.pointsTransaction.create({
        data: {
          id: prefixedId('pts'),
          storeId: payment.storeId,
          customerId: payment.customerId,
          type: 'EARN',
          points,
          paymentId: payment.id,
          reason: 'payment',
        },
      }),
      this.prisma.customer.update({
        where: { id: payment.customerId },
        data: { pointsBalance: { increment: points } },
      }),
    ]);
    this.logger.log(`awarded ${points} pts to ${payment.customerId} for ${payment.id}`);
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

  private async mutate(storeId: string, customerId: string, type: 'REDEEM' | 'ADJUST', delta: number, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer || customer.storeId !== storeId) throw ApiError.invalidRequest('Unknown customer for this store');
      const newBalance = customer.pointsBalance + delta;
      if (newBalance < 0) throw ApiError.invalidRequest('Insufficient points balance');
      await tx.pointsTransaction.create({
        data: { id: prefixedId('pts'), storeId, customerId, type, points: delta, reason: reason ?? null },
      });
      const updated = await tx.customer.update({ where: { id: customerId }, data: { pointsBalance: newBalance } });
      return { customer_id: customerId, type: type.toLowerCase(), points: delta, balance: updated.pointsBalance };
    });
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
