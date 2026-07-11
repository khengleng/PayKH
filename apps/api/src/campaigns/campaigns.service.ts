import { Injectable, Logger } from '@nestjs/common';
import { IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Payment, Promotion, Prisma } from '@prisma/client';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { SegmentsService } from '../segments/segments.service';

interface PromoConfig {
  multiplier?: number; // for POINTS_MULTIPLIER (e.g. 2 = +100% of base)
  bonusPoints?: number; // for BONUS_POINTS (flat)
  minAmount?: number | string; // qualifying payment amount
}

export class CreatePromotionDto {
  @IsString() @MaxLength(80) name!: string;
  @IsIn(['POINTS_MULTIPLIER', 'BONUS_POINTS']) type!: 'POINTS_MULTIPLIER' | 'BONUS_POINTS';
  @IsOptional() @IsString() segmentId?: string;
  @IsObject() config!: PromoConfig;
  @IsOptional() @IsInt() @Min(1) budgetPoints?: number;
  @IsOptional() @IsString() startAt?: string;
  @IsOptional() @IsString() endAt?: string;
}

export class UpdatePromotionDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsObject() config?: PromoConfig;
  @IsOptional() @IsInt() @Min(1) budgetPoints?: number;
  @IsOptional() @IsString() startAt?: string;
  @IsOptional() @IsString() endAt?: string;
}

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger('Campaigns');

  constructor(
    private readonly prisma: PrismaService,
    private readonly segments: SegmentsService,
  ) {}

  private async assertStore(user: AuthUser, storeId: string, perm: 'payment:read' | 'store:write') {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }

  async create(user: AuthUser, storeId: string, dto: CreatePromotionDto) {
    await this.assertStore(user, storeId, 'store:write');
    if (dto.segmentId) {
      const seg = await this.prisma.segment.findUnique({ where: { id: dto.segmentId } });
      if (!seg || seg.storeId !== storeId) throw ApiError.invalidRequest('Unknown segment for this store');
    }
    const promo = await this.prisma.promotion.create({
      data: {
        id: prefixedId('promo'),
        storeId,
        name: dto.name,
        type: dto.type,
        segmentId: dto.segmentId ?? null,
        config: (dto.config ?? {}) as unknown as Prisma.InputJsonValue,
        budgetPoints: dto.budgetPoints ?? null,
        startAt: dto.startAt ? new Date(dto.startAt) : null,
        endAt: dto.endAt ? new Date(dto.endAt) : null,
      },
    });
    return this.serialize(promo);
  }

  async list(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const rows = await this.prisma.promotion.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' } });
    return rows.map((p) => this.serialize(p));
  }

  async update(user: AuthUser, id: string, dto: UpdatePromotionDto) {
    const promo = await this.load(id);
    await this.assertStore(user, promo.storeId, 'store:write');
    const updated = await this.prisma.promotion.update({
      where: { id },
      data: {
        name: dto.name,
        config: dto.config ? (dto.config as unknown as Prisma.InputJsonValue) : undefined,
        budgetPoints: dto.budgetPoints,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt: dto.endAt ? new Date(dto.endAt) : undefined,
      },
    });
    return this.serialize(updated);
  }

  async setStatus(user: AuthUser, id: string, status: 'ACTIVE' | 'PAUSED' | 'ENDED') {
    const promo = await this.load(id);
    await this.assertStore(user, promo.storeId, 'store:write');
    const updated = await this.prisma.promotion.update({ where: { id }, data: { status } });
    return this.serialize(updated);
  }

  async remove(user: AuthUser, id: string) {
    const promo = await this.load(id);
    await this.assertStore(user, promo.storeId, 'store:write');
    await this.prisma.promotion.delete({ where: { id } });
    return { id, deleted: true };
  }

  private async load(id: string): Promise<Promotion> {
    const promo = await this.prisma.promotion.findUnique({ where: { id } });
    if (!promo) throw ApiError.paymentNotFound('Promotion not found');
    return promo;
  }

  /**
   * Apply active promotions to a just-earned payment, awarding bonus loyalty
   * points to the customer. Called from the loyalty earn path. Honors segment
   * targeting, min-amount, schedule window, and budget cap. Returns total bonus.
   */
  async applyToPayment(payment: Payment, basePoints: number): Promise<number> {
    if (!payment.customerId) return 0;
    const now = new Date();
    const promos = await this.prisma.promotion.findMany({
      where: {
        storeId: payment.storeId,
        status: 'ACTIVE',
        OR: [{ startAt: null }, { startAt: { lte: now } }],
        AND: [{ OR: [{ endAt: null }, { endAt: { gte: now } }] }],
      },
    });

    let totalBonus = 0;
    for (const promo of promos) {
      const config = (promo.config as PromoConfig) ?? {};
      if (config.minAmount != null && payment.amount.lessThan(config.minAmount)) continue;
      if (promo.segmentId && !(await this.segments.customerMatches(promo.segmentId, payment.customerId))) continue;

      let bonus = 0;
      if (promo.type === 'POINTS_MULTIPLIER') bonus = Math.floor(basePoints * ((config.multiplier ?? 1) - 1));
      else if (promo.type === 'BONUS_POINTS') bonus = Math.floor(config.bonusPoints ?? 0);
      if (bonus <= 0) continue;

      // Budget cap.
      if (promo.budgetPoints != null) {
        const remaining = promo.budgetPoints - promo.spentPoints;
        if (remaining <= 0) continue;
        bonus = Math.min(bonus, remaining);
      }

      await this.prisma.$transaction([
        this.prisma.pointsTransaction.create({
          data: { id: prefixedId('pts'), storeId: payment.storeId, customerId: payment.customerId, type: 'EARN', points: bonus, paymentId: payment.id, reason: `promo:${promo.name}` },
        }),
        this.prisma.customer.update({ where: { id: payment.customerId }, data: { pointsBalance: { increment: bonus }, lifetimePoints: { increment: bonus } } }),
        this.prisma.promotion.update({ where: { id: promo.id }, data: { spentPoints: { increment: bonus }, ...(promo.budgetPoints != null && promo.spentPoints + bonus >= promo.budgetPoints ? { status: 'ENDED' } : {}) } }),
      ]);
      totalBonus += bonus;
      this.logger.log(`promo ${promo.name} awarded ${bonus} bonus pts to ${payment.customerId}`);
    }
    return totalBonus;
  }

  private serialize(p: Promotion) {
    return {
      id: p.id,
      store_id: p.storeId,
      name: p.name,
      type: p.type,
      status: p.status.toLowerCase(),
      segment_id: p.segmentId,
      config: p.config,
      budget_points: p.budgetPoints,
      spent_points: p.spentPoints,
      start_at: p.startAt?.toISOString() ?? null,
      end_at: p.endAt?.toISOString() ?? null,
      created_at: p.createdAt.toISOString(),
    };
  }
}
