import { Injectable } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { LlmService } from './llm.service';
import { GovernanceService } from './governance.service';
import { scrubOutput, screenInput } from './guardrails';

export class MarketingCopyDto {
  @IsString() @MaxLength(200) product!: string;
  @IsOptional() @IsIn(['friendly', 'professional', 'playful', 'urgent']) tone?: string;
  @IsOptional() @IsIn(['sms', 'telegram', 'email', 'social']) channel?: string;
}

export class AssistantDto {
  @IsString() @MaxLength(500) question!: string;
}

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly governance: GovernanceService,
  ) {}

  /**
   * Governed generation: screen the input (guardrails), call the model, scrub
   * the output, and record usage/cost — falling back to a deterministic
   * computed response. Returns the text plus its source (ai | computed |
   * blocked) so the UI can label it.
   */
  private async generate(feature: string, storeId: string | undefined, system: string, user: string, fallback: string, maxTokens = 400): Promise<{ text: string; source: 'ai' | 'computed' | 'blocked' }> {
    const screen = screenInput(user);
    if (!screen.allowed) {
      await this.governance.record({ storeId, feature, model: this.llm.modelName, source: 'blocked', inputTokens: 0, outputTokens: 0, blockedFor: screen.reason });
      return { text: `Request blocked by AI guardrails (${screen.reason}). ${fallback}`, source: 'blocked' };
    }
    const res = await this.llm.complete(system, screen.text, maxTokens);
    if (!res.text) {
      await this.governance.record({ storeId, feature, model: res.model, source: 'fallback', inputTokens: res.inputTokens, outputTokens: res.outputTokens });
      return { text: fallback, source: 'computed' };
    }
    await this.governance.record({ storeId, feature, model: res.model, source: 'ai', inputTokens: res.inputTokens, outputTokens: res.outputTokens });
    return { text: scrubOutput(res.text.trim()), source: 'ai' };
  }

  private async assertStore(user: AuthUser, storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, 'payment:read');
    return store;
  }

  /** Gather a compact, grounded snapshot of a store for prompt context. */
  private async storeContext(storeId: string) {
    const from = new Date(Date.now() - 30 * 86_400_000);
    const [store, paidAgg, allCount, customers, topCust, program] = await Promise.all([
      this.prisma.store.findUnique({ where: { id: storeId } }),
      this.prisma.payment.aggregate({ where: { storeId, status: 'PAID', paidAt: { gte: from } }, _sum: { amount: true }, _count: { _all: true }, _avg: { amount: true } }),
      this.prisma.payment.count({ where: { storeId, createdAt: { gte: from } } }),
      this.prisma.customer.count({ where: { storeId } }),
      this.prisma.customer.findMany({ where: { storeId }, orderBy: { pointsBalance: 'desc' }, take: 3, select: { name: true, pointsBalance: true } }),
      this.prisma.loyaltyProgram.findUnique({ where: { storeId } }),
    ]);
    const revenue = Number(paidAgg._sum.amount ?? 0);
    return {
      name: store?.name ?? 'the store',
      revenue_30d: revenue.toFixed(2),
      paid_count: paidAgg._count._all,
      avg_order_value: Number(paidAgg._avg.amount ?? 0).toFixed(2),
      success_rate: allCount > 0 ? Math.round((paidAgg._count._all / allCount) * 100) : 0,
      customers,
      loyalty_active: !!program?.active,
      top_customers: topCust.map((c) => `${c.name ?? 'anon'} (${c.pointsBalance} pts)`),
    };
  }

  // ---------------------------------------------------------- marketing copy
  async marketingCopy(user: AuthUser, storeId: string, dto: MarketingCopyDto) {
    const store = await this.assertStore(user, storeId);
    const tone = dto.tone ?? 'friendly';
    const channel = dto.channel ?? 'sms';
    const fallback = `🎉 ${dto.product} at ${store.name}! Pay fast & secure with KHQR and earn rewards. Don't miss out — visit us today!`;
    const out = await this.generate('marketing_copy', storeId,
      `You are a marketing copywriter for "${store.name}", a Cambodian merchant using the PayKH payment platform. Write concise, conversion-focused ${channel} copy in a ${tone} tone. Keep SMS under 160 characters. No markdown.`,
      `Write promotional copy for: ${dto.product}`, fallback, 300);
    return { ...out, tone, channel };
  }

  // -------------------------------------------------------- campaign suggest
  async suggestCampaign(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId);
    const ctx = await this.storeContext(storeId);
    const aov = Number(ctx.avg_order_value);
    const fallback = `Run a "Double Points Weekend" for customers who spend above $${(aov * 1.5).toFixed(0)} (1.5× your ${ctx.avg_order_value} average order). ${ctx.loyalty_active ? 'Your loyalty program is already active, so' : 'Activate the loyalty program first, then'} target lapsed customers to lift repeat rate. With ${ctx.paid_count} paid orders/month, even a 10% repeat lift adds ~${Math.round(ctx.paid_count * 0.1)} orders.`;
    const out = await this.generate('campaign', storeId,
      'You are a loyalty/CRM strategist for small merchants. Given the store snapshot, propose ONE specific, actionable promotion. Respond in 3-4 short sentences: the offer, the target audience, and the expected impact. Be concrete with numbers.',
      `Store snapshot (last 30 days):\n${JSON.stringify(ctx, null, 2)}`, fallback, 400);
    return { ...out, context: ctx };
  }

  // -------------------------------------------------------- analytics summary
  async analyticsSummary(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId);
    const ctx = await this.storeContext(storeId);
    const fallback = `${ctx.name} took $${ctx.revenue_30d} across ${ctx.paid_count} paid orders in the last 30 days (avg $${ctx.avg_order_value}, ${ctx.success_rate}% success rate) from ${ctx.customers} customers. ${ctx.success_rate < 80 ? 'Payment success is below 80% — investigate abandoned/expired checkouts.' : 'Payment success is healthy.'} ${ctx.loyalty_active ? 'Loyalty is active — consider a tier promo to lift AOV.' : 'Loyalty is off — turning it on is the fastest lever for repeat business.'}`;
    const out = await this.generate('analytics_summary', storeId,
      'You are a business analyst. Summarize this store\'s last-30-day performance in 2-3 plain-English sentences a busy shop owner can act on. Highlight one strength and one opportunity.',
      `Metrics:\n${JSON.stringify(ctx, null, 2)}`, fallback, 300);
    return { ...out, metrics: ctx };
  }

  // ----------------------------------------------------------- fraud insights
  async fraudInsights(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId);
    const cases = await this.prisma.riskCase.findMany({ where: { storeId, status: { in: ['OPEN', 'INVESTIGATING', 'ESCALATED'] } }, orderBy: { score: 'desc' }, take: 20 });
    const reasonCounts: Record<string, number> = {};
    for (const c of cases) for (const r of c.reasons) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
    const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];
    const fallback = cases.length === 0
      ? 'No open risk cases — nothing needs attention right now.'
      : `${cases.length} open risk case(s), the most common signal being "${topReason?.[0] ?? 'n/a'}" (${topReason?.[1] ?? 0}×). ${cases[0].score >= 70 ? 'At least one high-severity case (score ≥70) needs immediate review.' : 'Severities are moderate.'} Recommended: review the highest-scoring case and confirm the customer's identity before settlement.`;
    const out = await this.generate('fraud_insights', storeId,
      'You are a fraud analyst. Given the open risk cases, summarize the threat picture in 2-3 sentences and recommend one concrete next action. No markdown.',
      `Open cases: ${cases.length}. Reason frequency: ${JSON.stringify(reasonCounts)}. Top scores: ${cases.slice(0, 5).map((c) => c.score).join(', ')}.`, fallback, 300);
    return { ...out, open_cases: cases.length, reason_counts: reasonCounts };
  }

  // -------------------------------------------------------- merchant assistant
  async assistant(user: AuthUser, storeId: string, dto: AssistantDto) {
    await this.assertStore(user, storeId);
    const ctx = await this.storeContext(storeId);
    const fallback = `I can't reach the AI service right now, but here's your data: $${ctx.revenue_30d} revenue over ${ctx.paid_count} paid orders (avg $${ctx.avg_order_value}, ${ctx.success_rate}% success) from ${ctx.customers} customers in the last 30 days. For deeper questions, check the Analytics and Reports pages.`;
    const out = await this.generate('assistant', storeId,
      `You are the PayKH merchant assistant for "${ctx.name}". Answer the owner's question using ONLY the store data provided. Be concise and practical. If the data can't answer it, say so and suggest where to look in the dashboard.`,
      `Store data:\n${JSON.stringify(ctx, null, 2)}\n\nQuestion: ${dto.question}`, fallback, 400);
    return { ...out, question: dto.question };
  }
}
