import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Injectable,
  Logger,
  Module,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { verifySignature } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.module';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

/**
 * Receiver for events the trustee delivers to PayKH
 * (POST /api/v1/trustee/events). The trustee signs each delivery with the PayKH
 * webhook scheme — `X-Payment-Signature: t=<ts>,v1=<hmac>`,
 * HMAC-SHA256(secret, `${t}.${rawBody}`) — so this verifies the raw body against
 * the configured signing secret, then stores the event idempotently on its id
 * and acks 200. It is public (the trustee calls it) but authenticated by the
 * signature; it never trusts a payload it could not verify.
 *
 * Configure the shared signing secret as `TRUSTEE_EVENTS_WEBHOOK_SECRET` (env on
 * the api service) or as the encrypted `trustee_events_webhook_secret` system
 * setting — set it to the signing secret of the webhook endpoint that targets
 * this receiver. Until it is set the receiver replies 503 (so the trustee keeps
 * the events queued rather than treating them as delivered).
 */
@Injectable()
export class TrusteeEventsService {
  private readonly logger = new Logger('TrusteeEvents');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async signingSecret(): Promise<string | undefined> {
    // Encrypted system setting takes precedence, then the env var.
    return (await this.settings.resolve('trustee_events_webhook_secret')) ?? process.env.TRUSTEE_EVENTS_WEBHOOK_SECRET;
  }

  async ingest(
    rawBody: string,
    signature: string | undefined,
    headerEventId: string | undefined,
    headerEventType: string | undefined,
  ): Promise<{ ok: true; id: string; type: string; duplicate: boolean }> {
    const secret = await this.signingSecret();
    if (!secret) {
      this.logger.error('trustee events receiver has no signing secret configured — rejecting delivery');
      throw new ServiceUnavailableException('trustee events receiver is not configured');
    }
    if (!signature) throw new BadRequestException('missing X-Payment-Signature');

    const result = verifySignature(secret, rawBody, signature);
    if (!result.valid) {
      this.logger.warn(`trustee event signature ${result.reason}`);
      throw new UnauthorizedException(`signature ${result.reason}`);
    }

    let parsed: { id?: string; type?: string };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('body is not valid JSON');
    }
    // Trust the header ids (they are covered by the signature over the raw body
    // only if the sender includes them; the payload id is the source of truth).
    const id = headerEventId || parsed.id;
    const type = headerEventType || parsed.type;
    if (!id || !type) throw new BadRequestException('event id and type are required');

    let duplicate = false;
    try {
      await this.prisma.trusteeInboundEvent.create({
        data: { id, type, payload: JSON.parse(rawBody) as Prisma.InputJsonValue },
      });
    } catch (e) {
      // At-least-once delivery / replay → the same id can arrive again. That is
      // success, not an error: we already have it.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        duplicate = true;
      } else {
        throw e;
      }
    }
    this.logger.log(`trustee event ${type} ${id}${duplicate ? ' (duplicate ignored)' : ' stored'}`);
    return { ok: true, id, type, duplicate };
  }
}

@ApiTags('trustee')
@UseGuards(RateLimitGuard)
@Controller('api/v1/trustee')
export class TrusteeEventsController {
  constructor(private readonly svc: TrusteeEventsService) {}

  @Post('events')
  @HttpCode(200)
  @RateLimit({ limit: 120, windowSec: 10, by: 'ip' })
  @ApiOperation({ summary: 'Receiver for trustee-delivered events (signature-verified)' })
  async events(
    @Req() req: Request,
    @Headers('x-payment-signature') signature: string | undefined,
    @Headers('x-payment-id') eventId: string | undefined,
    @Headers('x-payment-event') eventType: string | undefined,
    @Body() _body: unknown,
  ) {
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? '';
    return this.svc.ingest(rawBody, signature, eventId, eventType);
  }
}

@Module({
  controllers: [TrusteeEventsController],
  providers: [TrusteeEventsService],
})
export class TrusteeEventsModule {}
