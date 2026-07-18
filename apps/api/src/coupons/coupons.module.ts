import { Body, Controller, Delete, Get, Injectable, Logger, Module, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumberString, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { Prisma, Coupon, CouponType, Currency } from '@prisma/client';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthModule } from '../auth/auth.module';
import { requirePermission, Permission } from '../auth/rbac';
import { CustomersService } from '../customers/customers.service';
import { CustomersModule } from '../customers/customers.module';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

const DECIMALS: Record<Currency, number> = { USD: 2, KHR: 0 };

export interface CouponQuote {
  coupon_id: string;
  code: string;
  type: CouponType;
  discount: string;
  amount_before: string;
  amount_after: string;
  currency: Currency;
}

class CreateCouponDto {
  @IsString() @MaxLength(40) code!: string;
  @IsIn(['PERCENT', 'FIXED']) type!: CouponType;
  @IsNumberString() value!: string; // percent (1-100) or fixed amount
  @IsOptional() @IsIn(['USD', 'KHR']) currency?: Currency;
  @IsOptional() @IsNumberString() minSpend?: string;
  @IsOptional() @IsInt() @Min(1) maxRedemptions?: number;
  @IsOptional() @IsInt() @Min(1) perCustomerLimit?: number;
  @IsOptional() @IsBoolean() firstOrderOnly?: boolean;
  @IsOptional() @IsString() startsAt?: string;
  @IsOptional() @IsString() expiresAt?: string;
}
class UpdateCouponDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(1) maxRedemptions?: number;
  @IsOptional() @IsString() expiresAt?: string;
}
class QuoteCouponDto {
  @IsString() code!: string;
  @IsNumberString() amount!: string;
  @IsIn(['USD', 'KHR']) currency!: Currency;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
}

/**
 * Discount codes: merchant-issued codes that cut the amount due at checkout.
 * The money-critical part is `quote()` — it is the single authority on whether a
 * code applies and for how much, and it is always recomputed server-side from
 * the store's own coupon record, never from anything the client sends. The
 * redemption is only *counted* when the payment is actually captured (onPaid),
 * so abandoned discounted carts never burn a code.
 */
@Injectable()
export class CouponsService {
  private readonly logger = new Logger('Coupons');
  constructor(private readonly prisma: PrismaService, private readonly customers: CustomersService) {}

  private async assertStore(user: AuthUser, storeId: string, perm: Permission) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }

  // ---------------------------------------------------------------- dashboard
  async list(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'coupon:read');
    const rows = await this.prisma.coupon.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((c) => this.serialize(c));
  }

  async create(user: AuthUser, storeId: string, dto: CreateCouponDto) {
    await this.assertStore(user, storeId, 'coupon:write');
    const code = dto.code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw ApiError.invalidRequest('Code must be 3–40 chars: letters, numbers, - or _');
    const value = new Prisma.Decimal(dto.value);
    if (dto.type === 'PERCENT') {
      if (value.lte(0) || value.gt(100)) throw ApiError.invalidRequest('Percent must be between 1 and 100');
    } else {
      if (value.lte(0)) throw ApiError.invalidRequest('Fixed amount must be greater than 0');
      if (!dto.currency) throw ApiError.invalidRequest('A fixed-amount code needs a currency');
    }
    try {
      const created = await this.prisma.coupon.create({
        data: {
          id: prefixedId('cpn'),
          storeId,
          code,
          type: dto.type,
          value,
          currency: dto.type === 'FIXED' ? dto.currency : (dto.currency ?? null),
          minSpend: dto.minSpend ? new Prisma.Decimal(dto.minSpend) : null,
          maxRedemptions: dto.maxRedemptions ?? null,
          perCustomerLimit: dto.perCustomerLimit ?? null,
          firstOrderOnly: dto.firstOrderOnly ?? false,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
      });
      return this.serialize(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw ApiError.invalidRequest(`A coupon with code "${code}" already exists`);
      }
      throw e;
    }
  }

  async update(user: AuthUser, couponId: string, dto: UpdateCouponDto) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) throw ApiError.paymentNotFound('Coupon not found');
    await this.assertStore(user, coupon.storeId, 'coupon:write');
    const updated = await this.prisma.coupon.update({
      where: { id: couponId },
      data: {
        active: dto.active ?? undefined,
        maxRedemptions: dto.maxRedemptions ?? undefined,
        expiresAt: dto.expiresAt === undefined ? undefined : dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
    return this.serialize(updated);
  }

  async remove(user: AuthUser, couponId: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) throw ApiError.paymentNotFound('Coupon not found');
    await this.assertStore(user, coupon.storeId, 'coupon:write');
    await this.prisma.coupon.delete({ where: { id: couponId } });
    return { deleted: true };
  }

  // -------------------------------------------------------------------- quote
  /** Public quote — resolves the customer by contact (read-only) so per-customer
   *  and first-order rules can be checked without creating anyone. */
  async quotePublic(storeId: string, dto: QuoteCouponDto): Promise<CouponQuote> {
    const customerId = await this.customers.findByContact(storeId, { phone: dto.phone, email: dto.email });
    return this.quote(storeId, dto.code, { amount: dto.amount, currency: dto.currency, customerId });
  }

  /**
   * The authority on a coupon. Returns the discount + resulting amount, or throws
   * a clear ApiError explaining why the code does not apply. Pure read — never
   * mutates the coupon (that happens on capture).
   */
  async quote(
    storeId: string,
    rawCode: string,
    ctx: { amount: string | Prisma.Decimal; currency: Currency; customerId?: string | null },
  ): Promise<CouponQuote> {
    const code = (rawCode ?? '').trim().toUpperCase();
    if (!code) throw ApiError.invalidRequest('Enter a discount code');
    const coupon = await this.prisma.coupon.findUnique({ where: { storeId_code: { storeId, code } } });
    if (!coupon || !coupon.active) throw ApiError.invalidRequest('That code is not valid');

    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) throw ApiError.invalidRequest('That code is not active yet');
    if (coupon.expiresAt && coupon.expiresAt <= now) throw ApiError.invalidRequest('That code has expired');
    if (coupon.type === 'FIXED' && coupon.currency && coupon.currency !== ctx.currency) {
      throw ApiError.invalidRequest(`That code only applies to ${coupon.currency} orders`);
    }
    if (coupon.maxRedemptions != null && coupon.redemptionCount >= coupon.maxRedemptions) {
      throw ApiError.invalidRequest('That code has reached its redemption limit');
    }

    const amount = new Prisma.Decimal(ctx.amount);
    if (coupon.minSpend && amount.lt(coupon.minSpend)) {
      throw ApiError.invalidRequest(`Spend at least ${coupon.minSpend.toString()} ${ctx.currency} to use this code`);
    }

    if (coupon.firstOrderOnly) {
      if (!ctx.customerId) throw ApiError.invalidRequest('Add your phone to use this first-order code');
      const priorPaid = await this.prisma.payment.count({ where: { storeId, customerId: ctx.customerId, status: 'PAID' } });
      if (priorPaid > 0) throw ApiError.invalidRequest('That code is for first orders only');
    }
    if (coupon.perCustomerLimit != null && ctx.customerId) {
      const used = await this.prisma.couponRedemption.count({ where: { couponId: coupon.id, customerId: ctx.customerId } });
      if (used >= coupon.perCustomerLimit) throw ApiError.invalidRequest('You have already used that code');
    }

    const dp = DECIMALS[ctx.currency];
    let discount =
      coupon.type === 'PERCENT'
        ? amount.mul(coupon.value).div(100)
        : Prisma.Decimal.min(coupon.value, amount);
    discount = discount.toDecimalPlaces(dp, Prisma.Decimal.ROUND_DOWN);
    if (discount.gt(amount)) discount = amount;
    const after = amount.minus(discount);
    if (after.lte(0)) throw ApiError.invalidRequest('That code covers the whole order — nothing left to pay');

    return {
      coupon_id: coupon.id,
      code: coupon.code,
      type: coupon.type,
      discount: discount.toFixed(dp),
      amount_before: amount.toFixed(dp),
      amount_after: after.toFixed(dp),
      currency: ctx.currency,
    };
  }

  /**
   * Count the redemption once the payment is captured. Idempotent: the unique
   * (paymentId) constraint means a replayed `paid` transition can't double-count.
   * Reads the coupon snapshot the create step stored in payment metadata.
   */
  async onPaid(payment: { id: string; storeId: string; customerId: string | null; currency: Currency; amount: Prisma.Decimal; metadata: unknown }): Promise<void> {
    const meta = (payment.metadata ?? {}) as { coupon?: { id: string; discount: string; amount_before: string } };
    const c = meta.coupon;
    if (!c?.id) return;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.couponRedemption.create({
          data: {
            id: prefixedId('crd'),
            couponId: c.id,
            storeId: payment.storeId,
            customerId: payment.customerId,
            paymentId: payment.id,
            amountBefore: new Prisma.Decimal(c.amount_before),
            discount: new Prisma.Decimal(c.discount),
            amountAfter: payment.amount,
            currency: payment.currency,
          },
        });
        await tx.coupon.update({ where: { id: c.id }, data: { redemptionCount: { increment: 1 } } });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return; // already counted
      this.logger.warn(`coupon onPaid failed for ${payment.id}: ${e}`);
    }
  }

  private serialize(c: Coupon) {
    return {
      id: c.id,
      code: c.code,
      type: c.type,
      value: c.value.toString(),
      currency: c.currency,
      min_spend: c.minSpend?.toString() ?? null,
      max_redemptions: c.maxRedemptions,
      per_customer_limit: c.perCustomerLimit,
      first_order_only: c.firstOrderOnly,
      redemption_count: c.redemptionCount,
      active: c.active,
      starts_at: c.startsAt?.toISOString() ?? null,
      expires_at: c.expiresAt?.toISOString() ?? null,
      created_at: c.createdAt.toISOString(),
    };
  }
}

@ApiTags('coupons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class CouponsDashboardController {
  constructor(private readonly coupons: CouponsService) {}

  @Get('stores/:storeId/coupons')
  @ApiOperation({ summary: 'List discount codes' })
  list(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.coupons.list(user, storeId);
  }

  @Post('stores/:storeId/coupons')
  @ApiOperation({ summary: 'Create a discount code' })
  create(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: CreateCouponDto) {
    return this.coupons.create(user, storeId, dto);
  }

  @Patch('coupons/:id')
  @ApiOperation({ summary: 'Update a discount code (activate / limit / expiry)' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCouponDto) {
    return this.coupons.update(user, id, dto);
  }

  @Delete('coupons/:id')
  @ApiOperation({ summary: 'Delete a discount code' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.coupons.remove(user, id);
  }
}

/** Public: quote a code against a cart total (used by the shop/checkout). */
@ApiTags('coupons')
@UseGuards(RateLimitGuard)
@Controller('coupons')
export class CouponsPublicController {
  constructor(private readonly coupons: CouponsService) {}

  @Post(':storeId/quote')
  @RateLimit({ limit: 20, windowSec: 10, by: 'ip' })
  @ApiOperation({ summary: 'Check a discount code against a cart amount' })
  quote(@Param('storeId') storeId: string, @Body() dto: QuoteCouponDto) {
    return this.coupons.quotePublic(storeId, dto);
  }
}

@Module({
  imports: [AuthModule, CustomersModule],
  controllers: [CouponsDashboardController, CouponsPublicController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
