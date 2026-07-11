import { Injectable, Logger } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Payment, Prisma, RiskCase, RiskCaseStatus } from '@prisma/client';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';

export class UpdateCaseDto {
  @IsIn(['OPEN', 'INVESTIGATING', 'RESOLVED', 'ESCALATED']) status!: RiskCaseStatus;
  @IsOptional() @IsString() @MaxLength(500) resolution?: string;
}

/** Score at/above which a payment auto-opens a risk case. */
const CASE_THRESHOLD = 50;

@Injectable()
export class RiskService {
  private readonly logger = new Logger('Risk');

  constructor(private readonly prisma: PrismaService) {}

  private async assertStore(user: AuthUser, storeId: string, perm: 'payment:read' | 'store:write') {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }

  /**
   * Heuristic fraud/risk score (0-100) for a paid payment. Combines transaction
   * size, customer velocity, account age, and anonymity signals. When the score
   * crosses the threshold a RiskCase is opened (idempotent per payment). Called
   * from the paid transition; best-effort — never blocks the payment.
   */
  async scorePayment(payment: Payment): Promise<void> {
    try {
      const reasons: string[] = [];
      let score = 0;
      const amount = Number(payment.amount);

      if (amount >= 1000) { score += 30; reasons.push('high_amount'); }
      else if (amount >= 500) { score += 15; reasons.push('elevated_amount'); }

      if (!payment.customerId) {
        if (amount >= 300) { score += 15; reasons.push('anonymous_large'); }
      } else {
        const [recentCount, customer] = await Promise.all([
          this.prisma.payment.count({ where: { customerId: payment.customerId, status: 'PAID', paidAt: { gte: new Date(Date.now() - 3_600_000) } } }),
          this.prisma.customer.findUnique({ where: { id: payment.customerId } }),
        ]);
        if (recentCount >= 5) { score += 25; reasons.push('velocity'); }
        if (customer && customer.createdAt.getTime() > Date.now() - 3_600_000 && amount >= 200) { score += 20; reasons.push('new_customer_large'); }
      }

      // Repeated identical amounts can indicate card-testing.
      const sameAmount = await this.prisma.payment.count({ where: { storeId: payment.storeId, amount: payment.amount, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
      if (sameAmount >= 6) { score += 15; reasons.push('repeated_amount'); }

      score = Math.min(100, score);
      if (score < CASE_THRESHOLD) return;

      // Idempotent: one open case per payment.
      const existing = await this.prisma.riskCase.findFirst({ where: { paymentId: payment.id } });
      if (existing) return;
      await this.prisma.riskCase.create({
        data: { id: prefixedId('risk'), storeId: payment.storeId, paymentId: payment.id, customerId: payment.customerId, score, reasons, status: 'OPEN' },
      });
      this.logger.warn(`risk case opened for ${payment.id}: score ${score} [${reasons.join(',')}]`);
    } catch (err) {
      this.logger.warn(`risk scoring failed for ${payment.id}: ${err}`);
    }
  }

  // -------------------------------------------------------------- case mgmt
  async listCases(user: AuthUser, storeId: string, status?: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const where: Prisma.RiskCaseWhereInput = { storeId };
    const s = status?.toUpperCase();
    if (s && ['OPEN', 'INVESTIGATING', 'RESOLVED', 'ESCALATED'].includes(s)) where.status = s as RiskCaseStatus;
    const rows = await this.prisma.riskCase.findMany({ where, orderBy: [{ status: 'asc' }, { score: 'desc' }], take: 200 });
    return rows.map((r) => this.serialize(r));
  }

  async updateCase(user: AuthUser, caseId: string, dto: UpdateCaseDto) {
    const c = await this.prisma.riskCase.findUnique({ where: { id: caseId } });
    if (!c) throw ApiError.paymentNotFound('Case not found');
    await this.assertStore(user, c.storeId, 'store:write');
    const updated = await this.prisma.riskCase.update({ where: { id: caseId }, data: { status: dto.status, resolution: dto.resolution } });
    return this.serialize(updated);
  }

  async summary(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const grouped = await this.prisma.riskCase.groupBy({ by: ['status'], where: { storeId }, _count: { _all: true } });
    const counts = Object.fromEntries(grouped.map((g) => [g.status.toLowerCase(), g._count._all]));
    return { store_id: storeId, open: counts.open ?? 0, investigating: counts.investigating ?? 0, escalated: counts.escalated ?? 0, resolved: counts.resolved ?? 0 };
  }

  private serialize(c: RiskCase) {
    return {
      id: c.id,
      payment_id: c.paymentId,
      customer_id: c.customerId,
      score: c.score,
      reasons: c.reasons,
      status: c.status.toLowerCase(),
      resolution: c.resolution,
      created_at: c.createdAt.toISOString(),
    };
  }
}
