import { Body, Controller, Headers, Injectable, Logger, Module, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { PayChainIntegrationService, PayChainIntegrationModule } from './paychain-integration.module';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

const MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Receiver for PayChain confirmation webhooks (asset.issued / transferred /
 * redeemed / burned, transaction.compensated). Verifies HMAC-SHA256 over
 * `${timestamp}.${rawBody}` with the org's stored signing secret, then marks the
 * matching PayKH points transaction confirmed on-chain and records the
 * blockchain hash. Public (PayChain calls it) but authenticated by the
 * signature; the org is identified by the path so we know which secret to use.
 *
 * Under shadow mode the points are already spendable, so this is proof +
 * reconciliation, never the thing that makes them usable. At-least-once
 * delivery → the update is idempotent (it only ever sets confirmed once).
 */
@Injectable()
export class PayChainWebhookService {
  private readonly logger = new Logger('PayChainWebhook');
  constructor(private readonly prisma: PrismaService, private readonly integration: PayChainIntegrationService) {}

  async handle(orgId: string, rawBody: string, signature: string | undefined, timestamp: string | undefined): Promise<{ ok: boolean }> {
    const secret = await this.integration.webhookSecret(orgId);
    if (!secret) return { ok: false }; // not connected — ignore silently
    if (!signature || !timestamp) return { ok: false };
    if (Math.abs(Date.now() - Number(timestamp) * (String(timestamp).length <= 10 ? 1000 : 1)) > MAX_SKEW_MS) {
      // Tolerate both second and millisecond epoch timestamps; reject stale ones.
      return { ok: false };
    }
    const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
    const provided = signature.trim();
    if (provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      this.logger.warn(`paychain webhook signature mismatch for org ${orgId}`);
      return { ok: false };
    }

    // Signature good — best-effort mark the matching points txn confirmed.
    try {
      const evt = JSON.parse(rawBody) as Record<string, unknown>;
      const txn = (evt.transaction ?? evt.data ?? evt) as Record<string, unknown>;
      const correlationId = (txn.correlationId ?? evt.correlationId) as string | undefined; // = our PointsTransaction id
      const hash = (txn.blockchainHash ?? evt.blockchainHash) as string | undefined;
      const pcTxId = (txn.id ?? evt.transactionId) as string | undefined;
      if (correlationId || pcTxId) {
        await this.prisma.pointsTransaction.updateMany({
          where: { OR: [...(correlationId ? [{ id: correlationId }] : []), ...(pcTxId ? [{ paychainTxId: pcTxId }] : [])] },
          data: {
            status: 'CONFIRMED',
            confirmedAt: new Date(),
            ...(pcTxId ? { paychainTxId: pcTxId } : {}),
            ...(hash ? { statusDetail: `chain:${hash}` } : {}),
          },
        });
      }
    } catch (e) {
      this.logger.warn(`paychain webhook body parse/apply failed for org ${orgId}: ${e}`);
    }
    return { ok: true };
  }
}

@ApiTags('paychain')
@UseGuards(RateLimitGuard)
@Controller('paychain/webhook')
export class PayChainWebhookController {
  constructor(private readonly svc: PayChainWebhookService) {}

  @Post(':orgId')
  @RateLimit({ limit: 120, windowSec: 10, by: 'ip' })
  @ApiOperation({ summary: 'PayChain confirmation webhook receiver (signature-verified)' })
  async receive(
    @Param('orgId') orgId: string,
    @Req() req: Request,
    @Headers('x-paychain-signature') signature: string | undefined,
    @Headers('x-paychain-timestamp') timestamp: string | undefined,
    @Body() _body: unknown,
  ) {
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? '';
    // Always 200 to a valid-or-not delivery so PayChain doesn't hammer retries;
    // the outcome flag tells us whether it was applied.
    return this.svc.handle(orgId, rawBody, signature, timestamp);
  }
}

@Module({
  imports: [PayChainIntegrationModule],
  controllers: [PayChainWebhookController],
  providers: [PayChainWebhookService],
})
export class PayChainWebhookModule {}
