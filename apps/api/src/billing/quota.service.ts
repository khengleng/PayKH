import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { currentPeriodStart, warningLevel } from './period.util';

export interface UsageSnapshot {
  period_start: string;
  paid_count: number;
  quota: number; // -1 = unlimited
  remaining: number | null;
  usage_percent: number | null;
  warning_level: 70 | 90 | 100 | null;
  plan_name: string;
}

const DEFAULT_PLAN_ID = 'plan_free';

/**
 * Quota accounting. Only successful (paid) transactions count toward the monthly
 * quota. Creation is rejected with HTTP 402 once the quota is reached; lookups
 * and webhooks remain operational.
 */
@Injectable()
export class QuotaService {
  private readonly logger = new Logger('Quota');

  constructor(private readonly prisma: PrismaService) {}

  private async planForOrg(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { plan: true },
    });
    if (!org) throw ApiError.internal('Organization not found');
    const plan =
      org.plan ??
      (await this.prisma.plan.findUnique({ where: { id: DEFAULT_PLAN_ID } }));
    return { org, plan };
  }

  async snapshot(organizationId: string): Promise<UsageSnapshot> {
    const { plan } = await this.planForOrg(organizationId);
    const periodStart = currentPeriodStart();
    const usage = await this.prisma.usageRecord.findUnique({
      where: { organizationId_periodStart: { organizationId, periodStart } },
    });
    const paidCount = usage?.paidCount ?? 0;
    const quota = plan?.monthlyPaidQuota ?? 100;
    return {
      period_start: periodStart.toISOString(),
      paid_count: paidCount,
      quota,
      remaining: quota < 0 ? null : Math.max(0, quota - paidCount),
      usage_percent: quota < 0 ? null : quota === 0 ? 100 : Number(((paidCount / quota) * 100).toFixed(1)),
      warning_level: warningLevel(paidCount, quota),
      plan_name: plan?.name ?? 'Free',
    };
  }

  /** Throw 402 if the org has reached its monthly paid quota. */
  async assertWithinQuota(organizationId: string): Promise<void> {
    const { org, plan } = await this.planForOrg(organizationId);
    if (org.status === 'SUSPENDED') {
      throw ApiError.forbidden('Organization is suspended');
    }
    const quota = plan?.monthlyPaidQuota ?? 100;
    if (quota < 0) return; // unlimited

    const periodStart = currentPeriodStart();
    const usage = await this.prisma.usageRecord.findUnique({
      where: { organizationId_periodStart: { organizationId, periodStart } },
    });
    if ((usage?.paidCount ?? 0) >= quota) {
      throw ApiError.quotaExceeded(
        `Monthly quota of ${quota} successful payments reached. Upgrade your plan to continue.`,
      );
    }
  }

  /** Increment the org's paid counter for the current period. */
  async recordPaid(organizationId: string, storeId?: string): Promise<void> {
    const periodStart = currentPeriodStart();
    await this.prisma.usageRecord.upsert({
      where: { organizationId_periodStart: { organizationId, periodStart } },
      create: { organizationId, storeId: storeId ?? null, periodStart, paidCount: 1 },
      update: { paidCount: { increment: 1 } },
    });
  }

  /** Resolve the org from a store and record a paid transaction. */
  async recordPaidForStore(storeId: string): Promise<void> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return;
    await this.recordPaid(store.organizationId, storeId);
  }
}
