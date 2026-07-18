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
import { verifyEd25519 } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.module';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

const MAX_SKEW_SECONDS = 5 * 60;
const DEFAULT_KEY_ID = 'webhook-v1';

/**
 * Receiver for events the trustee delivers to PayKH
 * (POST /api/v1/trustee/events). The trustee signs each delivery with Ed25519:
 *
 *   X-Signature: <base64(ed25519_sign(privkey, `${X-Timestamp}.${rawBody}`))>
 *   X-Timestamp: <unix seconds>
 *   X-Key-Id:    webhook-v1
 *
 * PayKH verifies the raw body against the trustee's published Ed25519 public key
 * (asymmetric — PayKH only holds the public half), enforces a 5-minute timestamp
 * window against replay, then stores the event idempotently on its id and acks
 * 200. Public but signature-authenticated; a stored event is one that verified.
 *
 * Configure the public key (PEM) as `TRUSTEE_EVENTS_ED25519_PUBLIC_KEY` (env on
 * the api service, `\n`-escaped or base64-encoded is fine) or the encrypted
 * `trustee_events_ed25519_public_key` system setting. The expected key id
 * defaults to `webhook-v1` (override via `TRUSTEE_EVENTS_ED25519_KEY_ID`). Until
 * a key is configured the receiver replies 503 (so the trustee keeps events
 * queued rather than treating them as delivered).
 */
@Injectable()
export class TrusteeEventsService {
  private readonly logger = new Logger('TrusteeEvents');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Configured Ed25519 verification key (PEM), from setting or env. */
  private async publicKeyPem(): Promise<string | undefined> {
    const raw =
      (await this.settings.resolve('trustee_events_ed25519_public_key')) ??
      process.env.TRUSTEE_EVENTS_ED25519_PUBLIC_KEY;
    if (!raw) return undefined;
    const s = raw.trim();
    // Accept a real PEM, a `\n`-escaped PEM (common in env vars), or base64(PEM).
    if (s.includes('BEGIN')) return s.replace(/\\n/g, '\n');
    try {
      const decoded = Buffer.from(s, 'base64').toString('utf8');
      return decoded.includes('BEGIN') ? decoded : s;
    } catch {
      return s;
    }
  }

  private async expectedKeyId(): Promise<string> {
    return (
      (await this.settings.resolve('trustee_events_ed25519_key_id')) ??
      process.env.TRUSTEE_EVENTS_ED25519_KEY_ID ??
      DEFAULT_KEY_ID
    );
  }

  async ingest(
    rawBody: string,
    signature: string | undefined,
    timestamp: string | undefined,
    keyId: string | undefined,
    headerEventId: string | undefined,
    headerEventType: string | undefined,
  ): Promise<{ ok: true; id: string; type: string; duplicate: boolean }> {
    const pem = await this.publicKeyPem();
    if (!pem) {
      this.logger.error('trustee events receiver has no verification key configured — rejecting delivery');
      throw new ServiceUnavailableException('trustee events receiver is not configured');
    }
    if (!signature || !timestamp) throw new BadRequestException('missing X-Signature or X-Timestamp');

    // Reject a delivery signed by an unexpected key id (supports rotation: swap
    // the key + id together). A missing X-Key-Id is tolerated — the single
    // configured key still governs.
    const expectedKid = await this.expectedKeyId();
    if (keyId && keyId !== expectedKid) {
      this.logger.warn(`trustee event unknown key id ${keyId}`);
      throw new UnauthorizedException('unknown key id');
    }

    // Timestamp tolerance (replay protection). Accept second- or ms-epoch.
    const ts = Number(timestamp);
    const tsMs = timestamp.trim().length <= 10 ? ts * 1000 : ts;
    if (!Number.isFinite(ts) || Math.abs(Date.now() - tsMs) > MAX_SKEW_SECONDS * 1000) {
      throw new UnauthorizedException('timestamp outside tolerance');
    }

    // Verify Ed25519 over the exact signed string `${timestamp}.${rawBody}`,
    // using the raw header timestamp (not a reparsed value) and the raw body.
    const message = `${timestamp}.${rawBody}`;
    let valid = false;
    try {
      valid = verifyEd25519(pem, message, signature);
    } catch (e) {
      this.logger.warn(`trustee event verify error: ${e instanceof Error ? e.message : e}`);
      valid = false;
    }
    if (!valid) {
      this.logger.warn('trustee event signature mismatch');
      throw new UnauthorizedException('signature mismatch');
    }

    let parsed: { id?: string; type?: string };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('body is not valid JSON');
    }
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
  @ApiOperation({ summary: 'Receiver for trustee-delivered events (Ed25519 signature-verified)' })
  async events(
    @Req() req: Request,
    @Headers('x-signature') signature: string | undefined,
    @Headers('x-timestamp') timestamp: string | undefined,
    @Headers('x-key-id') keyId: string | undefined,
    @Headers('x-payment-id') eventId: string | undefined,
    @Headers('x-payment-event') eventType: string | undefined,
    @Body() _body: unknown,
  ) {
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? '';
    return this.svc.ingest(rawBody, signature, timestamp, keyId, eventId, eventType);
  }
}

@Module({
  controllers: [TrusteeEventsController],
  providers: [TrusteeEventsService],
})
export class TrusteeEventsModule {}
