import { Controller, Get, Injectable, Logger, Module, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Payment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { EmailService } from '../email/email.service';
import { formatAmount } from '../payments/amount.util';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger('Receipts');

  constructor(private readonly prisma: PrismaService, private readonly email: EmailService) {}

  private receiptNumber(p: { id: string }) {
    return `RCP-${p.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase()}`;
  }

  /** Public receipt view (payment id is the bearer, like the checkout page). */
  async publicReceipt(paymentId: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { store: { include: { branding: true } } } });
    if (!p) throw ApiError.paymentNotFound('Receipt not found');
    return {
      id: p.id,
      receipt_number: this.receiptNumber(p),
      store_name: p.store.branding?.displayName ?? p.store.name,
      support_email: p.store.branding?.supportEmail ?? null,
      amount: p.amount.toFixed(2),
      currency: p.currency,
      status: p.status.toLowerCase(),
      reference: p.referenceId,
      description: p.description,
      paid_at: p.paidAt?.toISOString() ?? null,
      created_at: p.createdAt.toISOString(),
      refunded_amount: p.refundedAmount.toFixed(2),
    };
  }

  /** Email a receipt to the payer on a paid payment (best-effort). */
  async onPaid(payment: Payment): Promise<void> {
    try {
      const meta = payment.metadata as Record<string, unknown> | null;
      let to = (meta?.customer_email as string | undefined) ?? undefined;
      if (!to && payment.customerId) {
        const c = await this.prisma.customer.findUnique({ where: { id: payment.customerId } });
        to = c?.email ?? undefined;
      }
      if (!to) return; // no payer email — public receipt link still available

      const store = await this.prisma.store.findUnique({ where: { id: payment.storeId }, include: { branding: true } });
      const storeName = store?.branding?.displayName ?? store?.name ?? 'the merchant';
      const url = `${process.env.CHECKOUT_BASE_URL ?? ''}/r/${payment.id}`;
      const amount = formatAmount(payment.amount, payment.currency);
      const rcp = this.receiptNumber(payment);
      await this.email.send({
        to,
        subject: `Receipt ${rcp} — ${storeName}`,
        html: `<div style="font-family:sans-serif;max-width:480px;margin:auto">
          <h2 style="color:#1E5BD6">Payment received ✓</h2>
          <p>Thank you for your payment to <b>${storeName}</b>.</p>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#64748b">Receipt</td><td style="text-align:right"><b>${rcp}</b></td></tr>
            <tr><td style="padding:6px 0;color:#64748b">Amount</td><td style="text-align:right"><b>${amount} ${payment.currency}</b></td></tr>
            ${payment.referenceId ? `<tr><td style="padding:6px 0;color:#64748b">Reference</td><td style="text-align:right">${payment.referenceId}</td></tr>` : ''}
            <tr><td style="padding:6px 0;color:#64748b">Date</td><td style="text-align:right">${(payment.paidAt ?? new Date()).toISOString().slice(0, 10)}</td></tr>
          </table>
          <p><a href="${url}" style="color:#1E5BD6">View your receipt online →</a></p>
          <p style="color:#94a3b8;font-size:12px">Powered by PayKH · Bakong KHQR</p>
        </div>`,
        text: `Payment received. Receipt ${rcp}: ${amount} ${payment.currency} to ${storeName}. View: ${url}`,
      });
      this.logger.log(`receipt emailed to ${to} for ${payment.id}`);
    } catch (e) {
      this.logger.warn(`receipt send failed for ${payment.id}: ${e}`);
    }
  }
}

@ApiTags('receipts')
@UseGuards(RateLimitGuard)
@RateLimit({ limit: 30, windowSec: 10, by: 'ip' })
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Public payment receipt' })
  get(@Param('id') id: string) {
    return this.receipts.publicReceipt(id);
  }
}

@Module({
  controllers: [ReceiptsController],
  providers: [ReceiptsService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
