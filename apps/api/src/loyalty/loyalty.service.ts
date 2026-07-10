import { Injectable, Logger } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Payment, PointsTransaction, Prisma } from '@prisma/client';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';

export class UpdateProgramDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() pointsPerUnit?: string; // decimal string
}

export class AdjustDto {
  @IsInt() points!: number; // signed: + to grant, - to deduct
  @IsOptional() @IsString() reason?: string;
}

export class RedeemDto {
  @IsInt() @Min(1) points!: number;
  @IsOptional() @IsString() reason?: string;
}

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger('Loyalty');

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------- program
  async getProgram(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'store:read');
    const p = await this.prisma.loyaltyProgram.findUnique({ where: { storeId } });
    return {
      store_id: storeId,
      active: p?.active ?? false,
      points_per_unit: (p?.pointsPerUnit ?? new Prisma.Decimal(1)).toString(),
    };
  }

  async updateProgram(user: AuthUser, storeId: string, dto: UpdateProgramDto) {
    await this.assertStore(user, storeId, 'store:write');
    const data = {
      active: dto.active,
      pointsPerUnit: dto.pointsPerUnit ? new Prisma.Decimal(dto.pointsPerUnit) : undefined,
    };
    const p = await this.prisma.loyaltyProgram.upsert({
      where: { storeId },
      create: { storeId, active: dto.active ?? false, pointsPerUnit: data.pointsPerUnit ?? new Prisma.Decimal(1) },
      update: data,
    });
    return { store_id: storeId, active: p.active, points_per_unit: p.pointsPerUnit.toString() };
  }

  // -------------------------------------------------------------- earning
  /** Award points for a paid payment (idempotent per payment). Called on paid. */
  async awardForPayment(payment: Payment): Promise<void> {
    if (!payment.customerId) return;
    const program = await this.prisma.loyaltyProgram.findUnique({ where: { storeId: payment.storeId } });
    if (!program?.active) return;

    const points = Math.floor(Number(payment.amount) * Number(program.pointsPerUnit));
    if (points <= 0) return;

    // Idempotency: never award twice for the same payment.
    const existing = await this.prisma.pointsTransaction.findFirst({
      where: { paymentId: payment.id, type: 'EARN' },
    });
    if (existing) return;

    await this.prisma.$transaction([
      this.prisma.pointsTransaction.create({
        data: {
          id: prefixedId('pts'),
          storeId: payment.storeId,
          customerId: payment.customerId,
          type: 'EARN',
          points,
          paymentId: payment.id,
          reason: 'payment',
        },
      }),
      this.prisma.customer.update({
        where: { id: payment.customerId },
        data: { pointsBalance: { increment: points } },
      }),
    ]);
    this.logger.log(`awarded ${points} pts to ${payment.customerId} for ${payment.id}`);
  }

  // ---------------------------------------------------- redeem / adjust
  async redeem(storeId: string, customerId: string, points: number, reason?: string) {
    return this.mutate(storeId, customerId, 'REDEEM', -Math.abs(points), reason);
  }

  async adjust(user: AuthUser, customerId: string, points: number, reason?: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw ApiError.paymentNotFound('Customer not found');
    await this.assertStore(user, customer.storeId, 'store:write');
    return this.mutate(customer.storeId, customerId, 'ADJUST', points, reason);
  }

  private async mutate(storeId: string, customerId: string, type: 'REDEEM' | 'ADJUST', delta: number, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer || customer.storeId !== storeId) throw ApiError.invalidRequest('Unknown customer for this store');
      const newBalance = customer.pointsBalance + delta;
      if (newBalance < 0) throw ApiError.invalidRequest('Insufficient points balance');
      await tx.pointsTransaction.create({
        data: { id: prefixedId('pts'), storeId, customerId, type, points: delta, reason: reason ?? null },
      });
      const updated = await tx.customer.update({ where: { id: customerId }, data: { pointsBalance: newBalance } });
      return { customer_id: customerId, type: type.toLowerCase(), points: delta, balance: updated.pointsBalance };
    });
  }

  // --------------------------------------------------------------- reads
  async ledger(user: AuthUser, customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw ApiError.paymentNotFound('Customer not found');
    await this.assertStore(user, customer.storeId, 'payment:read');
    const txns = await this.prisma.pointsTransaction.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { customer_id: customerId, balance: customer.pointsBalance, transactions: txns.map((t) => this.serialize(t)) };
  }

  private serialize(t: PointsTransaction) {
    return {
      id: t.id,
      type: t.type.toLowerCase(),
      points: t.points,
      payment_id: t.paymentId,
      reason: t.reason,
      created_at: t.createdAt.toISOString(),
    };
  }

  private async assertStore(user: AuthUser, storeId: string, perm: 'store:read' | 'store:write' | 'payment:read') {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }
}
