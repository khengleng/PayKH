import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { QuotaService } from './quota.service';
import { currentPeriodStart, nextPeriodStart } from './period.util';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
  ) {}

  async overview(user: AuthUser, organizationId: string) {
    requirePermission(user, organizationId, 'billing:manage');
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { plan: true },
    });
    if (!org) throw ApiError.paymentNotFound('Organization not found');
    const usage = await this.quota.snapshot(organizationId);
    return {
      organization_id: org.id,
      status: org.status.toLowerCase(),
      plan: org.plan
        ? { id: org.plan.id, name: org.plan.name, monthly_quota: org.plan.monthlyPaidQuota, price_usd_cents: org.plan.priceUsdCents }
        : null,
      usage,
    };
  }

  async listPlans() {
    const plans = await this.prisma.plan.findMany({ orderBy: { priceUsdCents: 'asc' } });
    return plans.map((p) => ({
      id: p.id,
      name: p.name,
      monthly_quota: p.monthlyPaidQuota,
      price_usd_cents: p.priceUsdCents,
    }));
  }

  /**
   * Change plan (MVP: manual/self-serve, no charge collected). Records a
   * Subscription row as plan history and issues an invoice for the plan price.
   */
  async changePlan(user: AuthUser, organizationId: string, planId: string) {
    requirePermission(user, organizationId, 'billing:manage');
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw ApiError.invalidRequest('Unknown plan');

    const periodStart = currentPeriodStart();
    const periodEnd = nextPeriodStart();

    await this.prisma.$transaction([
      this.prisma.subscription.updateMany({
        where: { organizationId, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      }),
      this.prisma.subscription.create({
        data: { organizationId, planId, status: 'ACTIVE', periodStart, periodEnd },
      }),
      this.prisma.organization.update({
        where: { id: organizationId },
        data: { planId },
      }),
      ...(plan.priceUsdCents > 0
        ? [
            this.prisma.invoice.create({
              data: {
                organizationId,
                amountUsdCents: plan.priceUsdCents,
                status: 'issued',
                periodStart,
                periodEnd,
              },
            }),
          ]
        : []),
    ]);
    return this.overview(user, organizationId);
  }

  async planHistory(user: AuthUser, organizationId: string) {
    requirePermission(user, organizationId, 'billing:manage');
    const subs = await this.prisma.subscription.findMany({
      where: { organizationId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    return subs.map((s) => ({
      id: s.id,
      plan: s.plan.name,
      status: s.status.toLowerCase(),
      period_start: s.periodStart.toISOString(),
      period_end: s.periodEnd.toISOString(),
      created_at: s.createdAt.toISOString(),
    }));
  }

  async listInvoices(user: AuthUser, organizationId: string) {
    requirePermission(user, organizationId, 'billing:manage');
    const invoices = await this.prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return invoices.map((i) => ({
      id: i.id,
      amount_usd_cents: i.amountUsdCents,
      status: i.status,
      period_start: i.periodStart.toISOString(),
      period_end: i.periodEnd.toISOString(),
      created_at: i.createdAt.toISOString(),
    }));
  }
}
