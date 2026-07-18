import { Body, Controller, Get, Injectable, Module, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, Max, Min, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { PaymentsService } from '../payments/payments.service';
import { CustomersService } from '../customers/customers.service';
import { KhqrImportService } from '../khqr/khqr-import.module';
import { PaymentsModule } from '../payments/payments.module';
import { CustomersModule } from '../customers/customers.module';
import { KhqrImportModule } from '../khqr/khqr-import.module';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

type Currency = 'USD' | 'KHR';
interface Product { id: string; name: string; emoji: string; price: number }

/**
 * A fixed sample catalogue so any store can demo the full shopper journey —
 * browse → cart → pay with KHQR → earn points → redeem — without first building
 * a product catalogue. Prices are per currency so the figures read naturally in
 * each (a coffee is $2.50 or 10,000៛, not $2.50 shown as 10,000).
 */
const CATALOG: Record<Currency, Product[]> = {
  USD: [
    { id: 'coffee', name: 'Cappuccino', emoji: '☕', price: 2.5 },
    { id: 'croissant', name: 'Butter Croissant', emoji: '🥐', price: 1.8 },
    { id: 'cake', name: 'Chocolate Cake', emoji: '🍰', price: 3.2 },
    { id: 'sandwich', name: 'Club Sandwich', emoji: '🥪', price: 4.5 },
    { id: 'juice', name: 'Orange Juice', emoji: '🧃', price: 2.0 },
    { id: 'tea', name: 'Iced Milk Tea', emoji: '🧋', price: 1.75 },
  ],
  KHR: [
    { id: 'coffee', name: 'Cappuccino', emoji: '☕', price: 10000 },
    { id: 'croissant', name: 'Butter Croissant', emoji: '🥐', price: 7000 },
    { id: 'cake', name: 'Chocolate Cake', emoji: '🍰', price: 13000 },
    { id: 'sandwich', name: 'Club Sandwich', emoji: '🥪', price: 18000 },
    { id: 'juice', name: 'Orange Juice', emoji: '🧃', price: 8000 },
    { id: 'tea', name: 'Iced Milk Tea', emoji: '🧋', price: 7000 },
  ],
};

class ShopItemDto {
  @IsString() @MaxLength(40) id!: string;
  @IsInt() @Min(1) @Max(50) qty!: number;
}
class ShopCheckoutDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ShopItemDto) items!: ShopItemDto[];
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(80) name?: string;
}

@Injectable()
export class ShopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly customers: CustomersService,
    private readonly khqr: KhqrImportService,
  ) {}

  /** Pay in a currency the store can actually receive; USD wins, else KHR, else
   *  USD (mock provider) so the demo still runs before a bank QR is connected. */
  private async resolveCurrency(storeId: string, mode: 'test' | 'live'): Promise<Currency> {
    if (await this.khqr.payeeFor(storeId, 'USD', mode).catch(() => null)) return 'USD';
    if (await this.khqr.payeeFor(storeId, 'KHR', mode).catch(() => null)) return 'KHR';
    return 'USD';
  }

  async info(storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, include: { branding: true } });
    if (!store) throw ApiError.paymentNotFound('Shop not found');
    const mode = store.liveMode ? 'live' : 'test';
    const currency = await this.resolveCurrency(storeId, mode);
    const program = await this.prisma.loyaltyProgram.findUnique({ where: { storeId } });
    const payee = await this.khqr.payeeFor(storeId, currency, mode).catch(() => null);
    return {
      store_id: store.id,
      store_name: store.branding?.displayName || store.name,
      primary_color: store.branding?.primaryColor || '#1E5BD6',
      currency,
      loyalty_active: !!program?.active,
      points_per_unit: program?.pointsPerUnit?.toString() ?? '0',
      bank_connected: !!payee,
      products: CATALOG[currency],
    };
  }

  async checkout(storeId: string, dto: ShopCheckoutDto) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Shop not found');
    const mode = store.liveMode ? 'live' : 'test';
    const currency = await this.resolveCurrency(storeId, mode);
    const catalog = new Map(CATALOG[currency].map((p) => [p.id, p]));

    // Total is computed from the server's own prices — the client sends only
    // item ids + quantities, never a price, so a cart can't be under-charged.
    let total = 0;
    const lineItems: { name: string; qty: number; price: number }[] = [];
    for (const item of dto.items) {
      const product = catalog.get(item.id);
      if (!product) throw ApiError.invalidRequest(`Unknown product: ${item.id}`);
      total += product.price * item.qty;
      lineItems.push({ name: product.name, qty: item.qty, price: product.price });
    }
    if (total <= 0) throw ApiError.invalidRequest('Your cart is empty');

    const customerId = await this.customers.resolveOrCreateByContact(storeId, {
      phone: dto.phone, email: dto.email, name: dto.name,
    });

    const amount = currency === 'KHR' ? String(Math.round(total)) : total.toFixed(2);
    const ctx = { apiKeyId: '', storeId, organizationId: store.organizationId, mode: mode as 'live' | 'test' };
    const body = {
      amount,
      currency,
      description: `Online order · ${lineItems.reduce((n, l) => n + l.qty, 0)} item(s)`,
      metadata: { source: 'shop', items: lineItems },
      ...(customerId ? { customer_id: customerId } : {}),
    };
    const { resource } = await this.payments.create(ctx, body, undefined, JSON.stringify(body));
    return { payment_id: resource.id, checkout_url: `${process.env.CHECKOUT_BASE_URL ?? ''}/pay/${resource.id}` };
  }
}

/** Public demo storefront — no auth, IP rate-limited, like the wallet/checkout. */
@ApiTags('shop')
@UseGuards(RateLimitGuard)
@Controller('shop')
export class ShopController {
  constructor(private readonly shop: ShopService) {}

  @Get(':storeId')
  @RateLimit({ limit: 30, windowSec: 10, by: 'ip' })
  @ApiOperation({ summary: 'Demo storefront: store info + sample catalogue' })
  info(@Param('storeId') storeId: string) {
    return this.shop.info(storeId);
  }

  @Post(':storeId/checkout')
  @RateLimit({ limit: 10, windowSec: 10, by: 'ip' })
  @ApiOperation({ summary: 'Create a payment for a demo-shop cart' })
  checkout(@Param('storeId') storeId: string, @Body() dto: ShopCheckoutDto) {
    return this.shop.checkout(storeId, dto);
  }
}

@Module({
  imports: [PaymentsModule, CustomersModule, KhqrImportModule],
  controllers: [ShopController],
  providers: [ShopService],
})
export class ShopModule {}
