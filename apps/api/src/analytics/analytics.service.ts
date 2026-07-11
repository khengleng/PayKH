import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';

interface DailyPoint { date: string; revenue: number; count: number }

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertStore(user: AuthUser, storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, 'payment:read');
    return store;
  }

  /** Daily paid revenue/count time-series for a store over a window (default 30d). */
  private async dailySeries(storeId: string, from: Date, to: Date): Promise<DailyPoint[]> {
    const rows = await this.prisma.$queryRaw<{ day: Date; count: bigint; volume: Prisma.Decimal | null }[]>`
      SELECT date_trunc('day', "paidAt") AS day, count(*)::bigint AS count, sum("amount") AS volume
      FROM "Payment"
      WHERE "storeId" = ${storeId} AND "status" = 'PAID' AND "paidAt" BETWEEN ${from} AND ${to}
      GROUP BY 1 ORDER BY 1 ASC`;
    return rows.map((r) => ({ date: r.day.toISOString().slice(0, 10), revenue: Number(r.volume ?? 0), count: Number(r.count) }));
  }

  async timeseries(user: AuthUser, storeId: string, fromIso?: string, toIso?: string) {
    await this.assertStore(user, storeId);
    const to = toIso ? new Date(toIso) : new Date();
    const from = fromIso ? new Date(fromIso) : new Date(to.getTime() - 30 * 86_400_000);
    const daily = await this.dailySeries(storeId, from, to);
    const revenue = daily.reduce((a, d) => a + d.revenue, 0);
    const count = daily.reduce((a, d) => a + d.count, 0);
    return {
      store_id: storeId,
      from: from.toISOString(),
      to: to.toISOString(),
      total_revenue: revenue.toFixed(2),
      total_count: count,
      avg_order_value: count > 0 ? (revenue / count).toFixed(2) : '0.00',
      daily,
    };
  }

  /**
   * Forecast the next `days` of daily revenue from the trailing 30 days using
   * ordinary-least-squares linear regression (with a 7-day moving-average
   * fallback for confidence). Fills gap days with 0 so the trend reflects reality.
   */
  async forecast(user: AuthUser, storeId: string, days = 7) {
    await this.assertStore(user, storeId);
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    const daily = await this.dailySeries(storeId, from, to);

    // Build a dense 30-slot vector (missing days = 0).
    const byDate = new Map(daily.map((d) => [d.date, d.revenue]));
    const series: number[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(to.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      series.push(byDate.get(d) ?? 0);
    }

    const n = series.length;
    const meanX = (n - 1) / 2;
    const meanY = series.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (i - meanX) * (series[i] - meanY); den += (i - meanX) ** 2; }
    const slope = den === 0 ? 0 : num / den;
    const intercept = meanY - slope * meanX;
    const movingAvg7 = series.slice(-7).reduce((a, b) => a + b, 0) / 7;

    const forecast: { date: string; projected_revenue: string }[] = [];
    for (let k = 1; k <= days; k++) {
      const trend = intercept + slope * (n - 1 + k);
      // Blend trend with the recent moving average, floor at 0.
      const projected = Math.max(0, 0.6 * trend + 0.4 * movingAvg7);
      forecast.push({ date: new Date(to.getTime() + k * 86_400_000).toISOString().slice(0, 10), projected_revenue: projected.toFixed(2) });
    }
    return {
      store_id: storeId,
      trailing_30d_revenue: series.reduce((a, b) => a + b, 0).toFixed(2),
      daily_trend: slope.toFixed(2), // + growing, - shrinking
      moving_avg_7d: movingAvg7.toFixed(2),
      projected_next_period: forecast.reduce((a, f) => a + Number(f.projected_revenue), 0).toFixed(2),
      forecast,
    };
  }

  /**
   * Org-level executive summary across all stores: 30-day revenue, success rate,
   * customer/loyalty/referral/game rollups, and a top-stores leaderboard.
   */
  async executiveSummary(user: AuthUser, orgId: string) {
    requirePermission(user, orgId, 'payment:read');
    const stores = await this.prisma.store.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
    const storeIds = stores.map((s) => s.id);
    if (storeIds.length === 0) return { organization_id: orgId, stores: 0, empty: true };

    const from = new Date(Date.now() - 30 * 86_400_000);
    const [paidAgg, allCount, prevPaid, customers, pointsAgg, commissions, plays, byStore] = await Promise.all([
      this.prisma.payment.aggregate({ where: { storeId: { in: storeIds }, status: 'PAID', paidAt: { gte: from } }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.payment.count({ where: { storeId: { in: storeIds }, createdAt: { gte: from } } }),
      this.prisma.payment.aggregate({ where: { storeId: { in: storeIds }, status: 'PAID', paidAt: { gte: new Date(Date.now() - 60 * 86_400_000), lt: from } }, _sum: { amount: true } }),
      this.prisma.customer.count({ where: { storeId: { in: storeIds } } }),
      this.prisma.customer.aggregate({ where: { storeId: { in: storeIds } }, _sum: { pointsBalance: true } }),
      this.prisma.referralCommission.aggregate({ where: { storeId: { in: storeIds }, status: { in: ['ACCRUED', 'PAID'] } }, _sum: { amount: true } }),
      this.prisma.gamePlay.count({ where: { storeId: { in: storeIds }, status: 'REVEALED' } }),
      this.prisma.payment.groupBy({ by: ['storeId'], where: { storeId: { in: storeIds }, status: 'PAID', paidAt: { gte: from } }, _sum: { amount: true }, _count: { _all: true } }),
    ]);

    const revenue = Number(paidAgg._sum.amount ?? 0);
    const prevRevenue = Number(prevPaid._sum.amount ?? 0);
    const nameOf = new Map(stores.map((s) => [s.id, s.name]));
    const topStores = byStore
      .map((b) => ({ store: nameOf.get(b.storeId) ?? b.storeId, revenue: Number(b._sum.amount ?? 0).toFixed(2), count: b._count._all }))
      .sort((a, b) => Number(b.revenue) - Number(a.revenue))
      .slice(0, 5);

    return {
      organization_id: orgId,
      period_days: 30,
      stores: stores.length,
      revenue: revenue.toFixed(2),
      revenue_prev_period: prevRevenue.toFixed(2),
      revenue_growth_pct: prevRevenue > 0 ? Number((((revenue - prevRevenue) / prevRevenue) * 100).toFixed(1)) : null,
      paid_count: paidAgg._count._all,
      total_payments: allCount,
      success_rate: allCount > 0 ? Number(((paidAgg._count._all / allCount) * 100).toFixed(1)) : 0,
      customers,
      outstanding_points: pointsAgg._sum.pointsBalance ?? 0,
      referral_commissions: Number(commissions._sum.amount ?? 0).toFixed(2),
      game_plays: plays,
      top_stores: topStores,
    };
  }
}
