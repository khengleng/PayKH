import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { prefixedId } from '@paykh/security';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { currentPeriodStart } from '../billing/period.util';
import { QUEUE_MAINTENANCE, QUEUE_WEBHOOK } from '../queue/queue.constants';
import { LedgerService } from '../ledger/ledger.service';

export class UpsertPlanDto {
  @IsString() id!: string;
  @IsString() name!: string;
  @IsInt() @Min(-1) monthlyPaidQuota!: number;
  @IsInt() @Min(0) priceUsdCents!: number;
  @IsOptional() @IsInt() @Min(0) defaultFeeBps?: number;
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
    private readonly ledger: LedgerService,
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
      plan_id: org.planId ?? null,
      members: org.members.map((m) => ({ email: m.user.email, role: m.role.toLowerCase() })),
      stores: org.stores.map((s) => ({ id: s.id, name: s.name, live_mode: s.liveMode, fee_bps: s.feeBps })),
    };
  }

  /** Assign a subscription plan to a merchant (monetization). */
  async setOrgPlan(user: AuthUser, orgId: string, planId: string) {
    await this.assertAdmin(user.userId);
    const [org, plan] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: orgId } }),
      this.prisma.plan.findUnique({ where: { id: planId } }),
    ]);
    if (!org) throw ApiError.paymentNotFound('Organization not found');
    if (!plan) throw ApiError.invalidRequest('Unknown plan');
    await this.prisma.organization.update({ where: { id: orgId }, data: { planId } });
    return { id: orgId, plan: plan.name };
  }

  /** Set a store's per-transaction platform fee in basis points (100 = 1%). */
  async setStoreFee(user: AuthUser, storeId: string, feeBps: number) {
    await this.assertAdmin(user.userId);
    if (feeBps < 0 || feeBps > 2000) throw ApiError.invalidRequest('Fee must be 0–2000 bps (0–20%)');
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    await this.prisma.store.update({ where: { id: storeId }, data: { feeBps } });
    return { id: storeId, fee_bps: feeBps };
  }

  /** Platform revenue: transaction fees (from the ledger) + subscription income. */
  async platformRevenue(user: AuthUser) {
    await this.assertAdmin(user.userId);
    const from = new Date(Date.now() - 30 * 86_400_000);
    const [feeCredit, feeDebit, subsPaid, activeSubs] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({ where: { accountCode: 'fee_revenue', direction: 'CREDIT' }, _sum: { amount: true } }),
      this.prisma.ledgerEntry.aggregate({ where: { accountCode: 'fee_revenue', direction: 'DEBIT' }, _sum: { amount: true } }),
      this.prisma.invoice.aggregate({ where: { status: 'paid', paidAt: { gte: from } }, _sum: { amountUsdCents: true }, _count: { _all: true } }),
      this.prisma.organization.count({ where: { planId: { not: null }, status: 'ACTIVE' } }),
    ]);
    const fees = Number(feeCredit._sum.amount ?? 0) - Number(feeDebit._sum.amount ?? 0);
    const subs = (subsPaid._sum.amountUsdCents ?? 0) / 100;
    return {
      transaction_fees_total: fees.toFixed(2),
      subscription_revenue_30d: subs.toFixed(2),
      subscription_invoices_30d: subsPaid._count._all,
      active_paid_subscriptions: activeSubs,
      total_revenue: (fees + subs).toFixed(2),
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
    return plans.map((p) => ({ id: p.id, name: p.name, monthly_quota: p.monthlyPaidQuota, price_usd_cents: p.priceUsdCents, default_fee_bps: p.defaultFeeBps }));
  }

  async upsertPlan(user: AuthUser, dto: UpsertPlanDto) {
    await this.assertAdmin(user.userId);
    const plan = await this.prisma.plan.upsert({
      where: { id: dto.id },
      create: { id: dto.id, name: dto.name, monthlyPaidQuota: dto.monthlyPaidQuota, priceUsdCents: dto.priceUsdCents, defaultFeeBps: dto.defaultFeeBps ?? 0 },
      update: { name: dto.name, monthlyPaidQuota: dto.monthlyPaidQuota, priceUsdCents: dto.priceUsdCents, defaultFeeBps: dto.defaultFeeBps },
    });
    return { id: plan.id, name: plan.name, monthly_quota: plan.monthlyPaidQuota, price_usd_cents: plan.priceUsdCents, default_fee_bps: plan.defaultFeeBps };
  }

  // ------------------------------------------------------------- payouts
  /** What the platform owes each merchant (merchant_payable ledger balance). */
  async payouts(user: AuthUser) {
    await this.assertAdmin(user.userId);
    const grouped = await this.prisma.ledgerEntry.groupBy({ by: ['storeId', 'direction', 'currency'], where: { accountCode: 'merchant_payable' }, _sum: { amount: true } });
    const byStore = new Map<string, { storeId: string; currency: string; credit: number; debit: number }>();
    for (const g of grouped) {
      if (!g.storeId) continue;
      const key = `${g.storeId}|${g.currency}`;
      const row = byStore.get(key) ?? { storeId: g.storeId, currency: g.currency, credit: 0, debit: 0 };
      if (g.direction === 'CREDIT') row.credit += Number(g._sum.amount ?? 0); else row.debit += Number(g._sum.amount ?? 0);
      byStore.set(key, row);
    }
    const storeIds = [...new Set([...byStore.values()].map((r) => r.storeId))];
    const stores = await this.prisma.store.findMany({ where: { id: { in: storeIds } }, include: { organization: true } });
    const nameOf = new Map(stores.map((s) => [s.id, { store: s.name, org: s.organization.name }]));
    return [...byStore.values()]
      .map((r) => ({ store_id: r.storeId, store: nameOf.get(r.storeId)?.store ?? r.storeId, merchant: nameOf.get(r.storeId)?.org ?? '', currency: r.currency, owed: (r.credit - r.debit).toFixed(2) }))
      .filter((r) => Number(r.owed) > 0.005)
      .sort((a, b) => Number(b.owed) - Number(a.owed));
  }

  /** Record a payout to a merchant — posts DR merchant_payable / CR clearing. */
  async payMerchant(user: AuthUser, storeId: string, currency: string, amount: string, ref?: string) {
    await this.assertAdmin(user.userId);
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    const value = new Prisma.Decimal(amount);
    if (value.lte(0)) throw ApiError.invalidRequest('Amount must be positive');
    await this.ledger.postPayout(storeId, currency, value, ref ?? prefixedId('payout'));
    return { store_id: storeId, currency, paid: value.toFixed(2) };
  }
}
