import { Injectable } from '@nestjs/common';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';

/** Per-model USD price per 1M tokens (input, output). Used for cost estimates. */
const MODEL_PRICING: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5-20251001': { in: 1.0, out: 5.0 },
  'claude-sonnet-5': { in: 3.0, out: 15.0 },
  'claude-opus-4-8': { in: 15.0, out: 75.0 },
};

/** The model registry surfaced to platform admins. */
const REGISTRY = [
  { id: 'claude-haiku-4-5-20251001', family: 'Claude Haiku 4.5', tier: 'fast', status: 'default', use: 'copilot default — low-latency, low-cost' },
  { id: 'claude-sonnet-5', family: 'Claude Sonnet 5', tier: 'balanced', status: 'available', use: 'higher-quality generation' },
  { id: 'claude-opus-4-8', family: 'Claude Opus 4.8', tier: 'frontier', status: 'available', use: 'complex reasoning' },
];

@Injectable()
export class GovernanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** costCents is stored in hundredths of a cent (×100) for sub-cent precision. */
  estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
    const p = MODEL_PRICING[model] ?? { in: 1.0, out: 5.0 };
    const usd = (inputTokens / 1_000_000) * p.in + (outputTokens / 1_000_000) * p.out;
    return Math.round(usd * 100 * 100); // USD → hundredths-of-a-cent
  }

  async record(entry: { storeId?: string; feature: string; model: string; source: string; inputTokens: number; outputTokens: number; blockedFor?: string }) {
    const costCents = this.estimateCostCents(entry.model, entry.inputTokens, entry.outputTokens);
    await this.prisma.aiUsageLog.create({
      data: { id: prefixedId('ai'), storeId: entry.storeId ?? null, feature: entry.feature, model: entry.model, source: entry.source, inputTokens: entry.inputTokens, outputTokens: entry.outputTokens, costCents, blockedFor: entry.blockedFor ?? null },
    });
  }

  private fmtCost(hundredthsOfCent: number): string {
    return `$${(hundredthsOfCent / 10_000).toFixed(4)}`;
  }

  /** Store-scoped AI usage: 30-day totals by feature/source + recent calls. */
  async storeUsage(user: AuthUser, storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, 'payment:read');

    const from = new Date(Date.now() - 30 * 86_400_000);
    const [byFeature, bySource, totalAgg, recent] = await Promise.all([
      this.prisma.aiUsageLog.groupBy({ by: ['feature'], where: { storeId, createdAt: { gte: from } }, _count: { _all: true }, _sum: { costCents: true } }),
      this.prisma.aiUsageLog.groupBy({ by: ['source'], where: { storeId, createdAt: { gte: from } }, _count: { _all: true } }),
      this.prisma.aiUsageLog.aggregate({ where: { storeId, createdAt: { gte: from } }, _sum: { costCents: true, inputTokens: true, outputTokens: true }, _count: { _all: true } }),
      this.prisma.aiUsageLog.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    return {
      store_id: storeId,
      period_days: 30,
      total_calls: totalAgg._count._all,
      total_cost: this.fmtCost(totalAgg._sum.costCents ?? 0),
      total_input_tokens: totalAgg._sum.inputTokens ?? 0,
      total_output_tokens: totalAgg._sum.outputTokens ?? 0,
      by_feature: byFeature.map((f) => ({ feature: f.feature, calls: f._count._all, cost: this.fmtCost(f._sum.costCents ?? 0) })),
      by_source: Object.fromEntries(bySource.map((s) => [s.source, s._count._all])),
      recent: recent.map((r) => ({ feature: r.feature, model: r.model, source: r.source, cost: this.fmtCost(r.costCents), blocked_for: r.blockedFor, at: r.createdAt.toISOString() })),
    };
  }

  // ------------------------------------------------------------- platform admin
  private async assertAdmin(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u?.isPlatformAdmin) throw ApiError.forbidden('Platform admin access required');
  }

  async registry(user: AuthUser) {
    await this.assertAdmin(user.userId);
    return { models: REGISTRY.map((m) => ({ ...m, pricing_per_mtok: MODEL_PRICING[m.id] })) };
  }

  async platformUsage(user: AuthUser) {
    await this.assertAdmin(user.userId);
    const from = new Date(Date.now() - 30 * 86_400_000);
    const [agg, byModel, blocked] = await Promise.all([
      this.prisma.aiUsageLog.aggregate({ where: { createdAt: { gte: from } }, _sum: { costCents: true }, _count: { _all: true } }),
      this.prisma.aiUsageLog.groupBy({ by: ['model'], where: { createdAt: { gte: from } }, _count: { _all: true }, _sum: { costCents: true } }),
      this.prisma.aiUsageLog.count({ where: { createdAt: { gte: from }, source: 'blocked' } }),
    ]);
    return {
      period_days: 30,
      total_calls: agg._count._all,
      total_cost: this.fmtCost(agg._sum.costCents ?? 0),
      blocked_calls: blocked,
      by_model: byModel.map((m) => ({ model: m.model, calls: m._count._all, cost: this.fmtCost(m._sum.costCents ?? 0) })),
    };
  }
}
