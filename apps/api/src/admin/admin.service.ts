import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { currentPeriodStart } from '../billing/period.util';
import { QUEUE_MAINTENANCE, QUEUE_WEBHOOK } from '../queue/queue.constants';

export class UpsertPlanDto {
  @IsString() id!: string;
  @IsString() name!: string;
  @IsInt() @Min(-1) monthlyPaidQuota!: number;
  @IsInt() @Min(0) priceUsdCents!: number;
}

export class AdminListQuery {
  @IsOptional() @IsString() search?: string;
}

/**
 * Platform-admin operations. Every method asserts the caller is a global
 * platform admin (User.isPlatformAdmin) — this is a separate authority from the
 * per-org RBAC roles.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_WEBHOOK) private readonly webhookQueue: Queue,
    @InjectQueue(QUEUE_MAINTENANCE) private readonly maintenanceQueue: Queue,
  ) {}

  async assertAdmin(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.isPlatformAdmin) throw ApiError.forbidden('Platform admin access required');
  }

  // -------------------------------------------------------- support console
  /**
   * Universal support lookup across payments, customers, stores, and orgs.
   * Matches an id/reference/email/name so support can jump straight to the
   * relevant record. Platform-admin only.
   */
  async supportSearch(user: AuthUser, q: string) {
    await this.assertAdmin(user.userId);
    const query = (q ?? '').trim();
    if (query.length < 2) throw ApiError.invalidRequest('Search query too short');

    const [payments, customers, stores, orgs] = await Promise.all([
      this.prisma.payment.findMany({ where: { OR: [{ id: query }, { referenceId: query }] }, take: 10, select: { id: true, storeId: true, status: true, amount: true, currency: true, referenceId: true, createdAt: true } }),
      this.prisma.customer.findMany({ where: { OR: [{ id: query }, { email: { equals: query, mode: 'insensitive' } }, { phone: query }] }, take: 10, select: { id: true, storeId: true, name: true, email: true, phone: true } }),
      this.prisma.store.findMany({ where: { OR: [{ id: query }, { name: { contains: query, mode: 'insensitive' } }] }, take: 10, select: { id: true, organizationId: true, name: true, liveMode: true } }),
      this.prisma.organization.findMany({ where: { OR: [{ id: query }, { name: { contains: query, mode: 'insensitive' } }] }, take: 10, select: { id: true, name: true, status: true } }),
    ]);
    return {
      query,
      payments: payments.map((p) => ({ id: p.id, store_id: p.storeId, status: p.status.toLowerCase(), amount: p.amount.toFixed(2), currency: p.currency, reference_id: p.referenceId, created_at: p.createdAt.toISOString() })),
      customers: customers.map((c) => ({ id: c.id, store_id: c.storeId, name: c.name, email: c.email, phone: c.phone })),
      stores: stores.map((s) => ({ id: s.id, organization_id: s.organizationId, name: s.name, live_mode: s.liveMode })),
      organizations: orgs.map((o) => ({ id: o.id, name: o.name, status: o.status.toLowerCase() })),
    };
  }

  // ------------------------------------------------------------ queue monitor
  /** BullMQ queue depths (waiting/active/completed/failed/delayed). Admin only. */
  async queueStats(user: AuthUser) {
    await this.assertAdmin(user.userId);
    const describe = async (name: string, queue: Queue) => {
      try {
        const c = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
        return { name, ...c, healthy: (c.failed ?? 0) < 100 };
      } catch (e) {
        return { name, error: String(e), healthy: false };
      }
    };
    return {
      queues: await Promise.all([
        describe('webhook-delivery', this.webhookQueue),
        describe('maintenance', this.maintenanceQueue),
      ]),
    };
  }

  async whoami(user: AuthUser) {
    const u = await this.prisma.user.findUnique({ where: { id: user.userId } });
    return { is_platform_admin: !!u?.isPlatformAdmin, email: u?.email };
  }

  async listOrgs(user: AuthUser, search?: string) {
    await this.assertAdmin(user.userId);
    const orgs = await this.prisma.organization.findMany({
      where: search ? { name: { contains: search, mode: 'insensitive' } } : {},
      include: {
        plan: true,
        _count: { select: { members: true, stores: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const period = currentPeriodStart();
    const usage = await this.prisma.usageRecord.findMany({
      where: { periodStart: period, organizationId: { in: orgs.map((o) => o.id) } },
    });
    const usageByOrg = new Map(usage.map((u) => [u.organizationId, u.paidCount]));
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      status: o.status.toLowerCase(),
      plan: o.plan?.name ?? 'Free',
      members: o._count.members,
      stores: o._count.stores,
      month_paid: usageByOrg.get(o.id) ?? 0,
      created_at: o.createdAt.toISOString(),
    }));
  }

  async getOrg(user: AuthUser, orgId: string) {
    await this.assertAdmin(user.userId);
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        plan: true,
        members: { include: { user: true } },
        stores: true,
      },
    });
    if (!org) throw ApiError.paymentNotFound('Organization not found');
    return {
      id: org.id,
      name: org.name,
      status: org.status.toLowerCase(),
      plan: org.plan?.name ?? 'Free',
      grace_until: org.graceUntil?.toISOString() ?? null,
      members: org.members.map((m) => ({ email: m.user.email, role: m.role.toLowerCase() })),
      stores: org.stores.map((s) => ({ id: s.id, name: s.name, live_mode: s.liveMode })),
    };
  }

  async setSuspended(user: AuthUser, orgId: string, suspended: boolean) {
    await this.assertAdmin(user.userId);
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw ApiError.paymentNotFound('Organization not found');
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { status: suspended ? 'SUSPENDED' : 'ACTIVE', graceUntil: suspended ? org.graceUntil : null },
    });
    return { id: orgId, status: suspended ? 'suspended' : 'active' };
  }

  async platformMetrics(user: AuthUser) {
    await this.assertAdmin(user.userId);
    const [orgs, suspended, stores, byStatus, paidAgg] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.store.count(),
      this.prisma.payment.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.payment.aggregate({ where: { status: 'PAID' }, _sum: { amount: true }, _count: { _all: true } }),
    ]);
    const counts: Record<string, number> = {};
    let total = 0;
    for (const r of byStatus) { counts[r.status.toLowerCase()] = r._count._all; total += r._count._all; }
    return {
      organizations: orgs,
      suspended,
      stores,
      total_payments: total,
      paid_count: paidAgg._count._all,
      paid_volume: paidAgg._sum.amount ? paidAgg._sum.amount.toFixed(2) : '0.00',
      success_rate: total > 0 ? Number(((paidAgg._count._all / total) * 100).toFixed(1)) : 0,
      by_status: counts,
    };
  }

  async listPlans(user: AuthUser) {
    await this.assertAdmin(user.userId);
    const plans = await this.prisma.plan.findMany({ orderBy: { priceUsdCents: 'asc' } });
    return plans.map((p) => ({ id: p.id, name: p.name, monthly_quota: p.monthlyPaidQuota, price_usd_cents: p.priceUsdCents }));
  }

  async upsertPlan(user: AuthUser, dto: UpsertPlanDto) {
    await this.assertAdmin(user.userId);
    const plan = await this.prisma.plan.upsert({
      where: { id: dto.id },
      create: { id: dto.id, name: dto.name, monthlyPaidQuota: dto.monthlyPaidQuota, priceUsdCents: dto.priceUsdCents },
      update: { name: dto.name, monthlyPaidQuota: dto.monthlyPaidQuota, priceUsdCents: dto.priceUsdCents },
    });
    return { id: plan.id, name: plan.name, monthly_quota: plan.monthlyPaidQuota, price_usd_cents: plan.priceUsdCents };
  }
}
