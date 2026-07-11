import { Injectable, Logger } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { Payment, Referral } from '@prisma/client';
import { prefixedId, randomBase58 } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';

export class UpdateReferralProgramDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) referrerPoints?: number;
  @IsOptional() @IsInt() @Min(0) refereePoints?: number;
}

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger('Referrals');

  constructor(private readonly prisma: PrismaService) {}

  private async assertStore(user: AuthUser, storeId: string, perm: 'payment:read' | 'store:write') {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }

  // ---------------------------------------------------------------- program
  async getProgram(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const p = await this.prisma.referralProgram.findUnique({ where: { storeId } });
    return { store_id: storeId, active: p?.active ?? false, referrer_points: p?.referrerPoints ?? 0, referee_points: p?.refereePoints ?? 0 };
  }

  async updateProgram(user: AuthUser, storeId: string, dto: UpdateReferralProgramDto) {
    await this.assertStore(user, storeId, 'store:write');
    const p = await this.prisma.referralProgram.upsert({
      where: { storeId },
      create: { storeId, active: dto.active ?? false, referrerPoints: dto.referrerPoints ?? 0, refereePoints: dto.refereePoints ?? 0 },
      update: { active: dto.active, referrerPoints: dto.referrerPoints, refereePoints: dto.refereePoints },
    });
    return { store_id: storeId, active: p.active, referrer_points: p.referrerPoints, referee_points: p.refereePoints };
  }

  // ------------------------------------------------------------------- code
  /** Get (or lazily generate) a customer's referral code. Called via API key. */
  async getOrCreateCode(storeId: string, customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.storeId !== storeId) throw ApiError.paymentNotFound('Customer not found');
    if (customer.referralCode) return this.codeResponse(customer.referralCode);
    // Generate a unique code (retry on the rare collision).
    for (let i = 0; i < 5; i++) {
      const code = `REF-${randomBase58(6).toUpperCase()}`;
      try {
        const updated = await this.prisma.customer.update({ where: { id: customerId }, data: { referralCode: code } });
        return this.codeResponse(updated.referralCode as string);
      } catch {
        /* unique collision — retry */
      }
    }
    throw ApiError.internal('Could not allocate a referral code');
  }

  private codeResponse(code: string) {
    return { referral_code: code, share_url: `${process.env.CHECKOUT_BASE_URL ?? ''}/?ref=${encodeURIComponent(code)}` };
  }

  // --------------------------------------------------------------- linking
  /** Link a newly-created referee to a referrer by code. Best-effort. */
  async linkReferral(storeId: string, refereeId: string, code: string): Promise<void> {
    const program = await this.prisma.referralProgram.findUnique({ where: { storeId } });
    if (!program?.active) return;
    const referrer = await this.prisma.customer.findFirst({ where: { storeId, referralCode: code } });
    if (!referrer || referrer.id === refereeId) return; // unknown code or self-referral
    const existing = await this.prisma.referral.findUnique({ where: { refereeCustomerId: refereeId } });
    if (existing) return; // already referred
    await this.prisma.$transaction([
      this.prisma.referral.create({
        data: { id: prefixedId('ref'), storeId, referrerCustomerId: referrer.id, refereeCustomerId: refereeId, code, status: 'PENDING' },
      }),
      this.prisma.customer.update({ where: { id: refereeId }, data: { referredByCustomerId: referrer.id } }),
    ]);
    this.logger.log(`referral linked: ${referrer.id} -> ${refereeId}`);
  }

  // ---------------------------------------------------- reward on first pay
  /**
   * On a referee's first paid payment, qualify + reward both parties. Called
   * from the paid transition. Idempotent (referral moves to REWARDED once).
   */
  async onPaidPayment(payment: Payment): Promise<void> {
    if (!payment.customerId) return;
    const referral = await this.prisma.referral.findUnique({ where: { refereeCustomerId: payment.customerId } });
    if (!referral || referral.status === 'REWARDED') return;
    const program = await this.prisma.referralProgram.findUnique({ where: { storeId: payment.storeId } });
    if (!program?.active) return;

    const referrerPts = program.referrerPoints;
    const refereePts = program.refereePoints;

    await this.prisma.$transaction(async (tx) => {
      // Re-check inside the tx for idempotency.
      const fresh = await tx.referral.findUnique({ where: { id: referral.id } });
      if (!fresh || fresh.status === 'REWARDED') return;

      if (referrerPts > 0) {
        await tx.pointsTransaction.create({ data: { id: prefixedId('pts'), storeId: payment.storeId, customerId: referral.referrerCustomerId, type: 'EARN', points: referrerPts, reason: 'referral (referrer)' } });
        await tx.customer.update({ where: { id: referral.referrerCustomerId }, data: { pointsBalance: { increment: referrerPts }, lifetimePoints: { increment: referrerPts } } });
      }
      if (refereePts > 0) {
        await tx.pointsTransaction.create({ data: { id: prefixedId('pts'), storeId: payment.storeId, customerId: referral.refereeCustomerId, type: 'EARN', points: refereePts, paymentId: payment.id, reason: 'referral (referee)' } });
        await tx.customer.update({ where: { id: referral.refereeCustomerId }, data: { pointsBalance: { increment: refereePts }, lifetimePoints: { increment: refereePts } } });
      }
      await tx.referral.update({ where: { id: referral.id }, data: { status: 'REWARDED', rewardedAt: new Date(), rewardPointsReferrer: referrerPts, rewardPointsReferee: refereePts } });
    });
    this.logger.log(`referral ${referral.id} rewarded (referrer +${referrerPts}, referee +${refereePts})`);
  }

  // ---------------------------------------------------------------- reads
  async list(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const rows = await this.prisma.referral.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' }, take: 200 });
    const customerIds = [...new Set(rows.flatMap((r) => [r.referrerCustomerId, r.refereeCustomerId]))];
    const customers = await this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, email: true } });
    const nameOf = new Map(customers.map((c) => [c.id, c.name ?? c.email ?? c.id]));
    return rows.map((r) => this.serialize(r, nameOf));
  }

  private serialize(r: Referral, nameOf: Map<string, string>) {
    return {
      id: r.id,
      referrer: nameOf.get(r.referrerCustomerId) ?? r.referrerCustomerId,
      referee: nameOf.get(r.refereeCustomerId) ?? r.refereeCustomerId,
      code: r.code,
      status: r.status.toLowerCase(),
      reward_referrer: r.rewardPointsReferrer,
      reward_referee: r.rewardPointsReferee,
      created_at: r.createdAt.toISOString(),
      rewarded_at: r.rewardedAt?.toISOString() ?? null,
    };
  }
}
