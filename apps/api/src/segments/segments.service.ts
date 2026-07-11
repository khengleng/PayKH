import { Injectable } from '@nestjs/common';
import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Segment, Prisma } from '@prisma/client';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { CustomerAgg, matchesAggregates, needsPaymentAggregates, SegmentRules } from './segment-rules';

export class CreateSegmentDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsObject() rules!: SegmentRules;
}

export class UpdateSegmentDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsObject() rules?: SegmentRules;
}

const MAX_CANDIDATES = 10_000;

@Injectable()
export class SegmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertStore(user: AuthUser, storeId: string, perm: 'payment:read' | 'store:write') {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }

  async create(user: AuthUser, storeId: string, dto: CreateSegmentDto) {
    await this.assertStore(user, storeId, 'store:write');
    const seg = await this.prisma.segment.create({
      data: { id: prefixedId('seg'), storeId, name: dto.name, description: dto.description ?? null, rules: (dto.rules ?? {}) as unknown as Prisma.InputJsonValue },
    });
    return this.serialize(seg);
  }

  async list(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const rows = await this.prisma.segment.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' } });
    return rows.map((s) => this.serialize(s));
  }

  async update(user: AuthUser, id: string, dto: UpdateSegmentDto) {
    const seg = await this.prisma.segment.findUnique({ where: { id } });
    if (!seg) throw ApiError.paymentNotFound('Segment not found');
    await this.assertStore(user, seg.storeId, 'store:write');
    const updated = await this.prisma.segment.update({ where: { id }, data: { name: dto.name, description: dto.description, rules: dto.rules ? (dto.rules as unknown as Prisma.InputJsonValue) : undefined } });
    return this.serialize(updated);
  }

  async remove(user: AuthUser, id: string) {
    const seg = await this.prisma.segment.findUnique({ where: { id } });
    if (!seg) throw ApiError.paymentNotFound('Segment not found');
    await this.assertStore(user, seg.storeId, 'store:write');
    await this.prisma.segment.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** Preview a segment by id (used from the dashboard). */
  async preview(user: AuthUser, id: string) {
    const seg = await this.prisma.segment.findUnique({ where: { id } });
    if (!seg) throw ApiError.paymentNotFound('Segment not found');
    await this.assertStore(user, seg.storeId, 'payment:read');
    const ids = await this.evaluate(seg.storeId, seg.rules as SegmentRules);
    const sample = await this.prisma.customer.findMany({ where: { id: { in: ids.slice(0, 20) } }, select: { id: true, name: true, email: true, pointsBalance: true } });
    return { segment_id: id, count: ids.length, sample: sample.map((c) => ({ id: c.id, name: c.name, email: c.email, points: c.pointsBalance })) };
  }

  /** Preview arbitrary rules (before saving). */
  async previewRules(user: AuthUser, storeId: string, rules: SegmentRules) {
    await this.assertStore(user, storeId, 'payment:read');
    const ids = await this.evaluate(storeId, rules);
    return { count: ids.length };
  }

  /**
   * Evaluate a segment to the set of matching customer ids. Direct fields are
   * filtered in the DB; payment-derived criteria use a grouped aggregate.
   */
  async evaluate(storeId: string, rules: SegmentRules): Promise<string[]> {
    const where: Prisma.CustomerWhereInput = { storeId };
    if (rules.min_lifetime_points != null) where.lifetimePoints = { gte: rules.min_lifetime_points };
    if (rules.min_points_balance != null) where.pointsBalance = { gte: rules.min_points_balance };
    if (rules.tier_id) where.tierId = rules.tier_id;
    if (rules.has_email) where.email = { not: null };

    const candidates = await this.prisma.customer.findMany({ where, select: { id: true }, take: MAX_CANDIDATES });
    let ids = candidates.map((c) => c.id);
    if (ids.length === 0 || !needsPaymentAggregates(rules)) return ids;

    const grouped = await this.prisma.payment.groupBy({
      by: ['customerId'],
      where: { storeId, status: 'PAID', customerId: { in: ids } },
      _count: { _all: true },
      _sum: { amount: true },
      _max: { paidAt: true },
    });
    const aggMap = new Map<string, CustomerAgg>();
    for (const g of grouped) {
      if (!g.customerId) continue;
      aggMap.set(g.customerId, { count: g._count._all, volume: g._sum.amount ?? new Prisma.Decimal(0), lastPaidAt: g._max.paidAt ?? null });
    }
    const now = new Date();
    ids = ids.filter((id) => matchesAggregates(aggMap.get(id), rules, now));
    return ids;
  }

  /** Does a single customer match a segment's rules? (used by campaigns.) */
  async customerMatches(segmentId: string, customerId: string): Promise<boolean> {
    const seg = await this.prisma.segment.findUnique({ where: { id: segmentId } });
    if (!seg) return false;
    const rules = seg.rules as SegmentRules;

    const where: Prisma.CustomerWhereInput = { id: customerId, storeId: seg.storeId };
    if (rules.min_lifetime_points != null) where.lifetimePoints = { gte: rules.min_lifetime_points };
    if (rules.min_points_balance != null) where.pointsBalance = { gte: rules.min_points_balance };
    if (rules.tier_id) where.tierId = rules.tier_id;
    if (rules.has_email) where.email = { not: null };
    const direct = await this.prisma.customer.count({ where });
    if (direct === 0) return false;
    if (!needsPaymentAggregates(rules)) return true;

    const grouped = await this.prisma.payment.groupBy({
      by: ['customerId'],
      where: { storeId: seg.storeId, status: 'PAID', customerId },
      _count: { _all: true },
      _sum: { amount: true },
      _max: { paidAt: true },
    });
    const g = grouped[0];
    const agg = g ? { count: g._count._all, volume: g._sum.amount ?? new Prisma.Decimal(0), lastPaidAt: g._max.paidAt ?? null } : undefined;
    return matchesAggregates(agg, rules, new Date());
  }

  private serialize(s: Segment) {
    return { id: s.id, store_id: s.storeId, name: s.name, description: s.description, rules: s.rules, created_at: s.createdAt.toISOString() };
  }
}
