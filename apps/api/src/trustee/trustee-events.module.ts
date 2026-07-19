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
import { createHash } from 'crypto';
import { Request } from 'express';
import { verifyEd25519 } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.module';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

const DEFAULT_KEY_ID = 'webhook-v1';
const RECEIVER_PATH = '/api/v1/trustee/events';

/**
 * Canonical JSON: object keys sorted (recursively), no whitespace. Values are
 * encoded with standard JSON semantics. This must match the trustee's
 * `canonical(...)` exactly — it is the subject both signature schemes cover.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
    .join(',')}}`;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Receiver for events the trustee delivers to PayKH (POST /api/v1/trustee/events).
 *
 * Verifies an Ed25519 signature (key `webhook-v1`, base64) against the trustee's
 * published public key, over a CANONICAL-JSON subject (keys sorted, no
 * whitespace). Two schemes are accepted — a delivery verifies if EITHER matches:
 *
 *   B) body signature `body.signature` over canonical:
 *        { eventType, targetPlatform, payload }
 *
 *   A) header signature `X-Signature` over canonical:
 *        { method:"POST", path:"/api/v1/trustee/events",
 *          clientId, timestamp, nonce, bodyHash }
 *      where bodyHash = sha256_hex(canonical(payload)).
 *
 * Verified events are stored idempotently on their id and acked 200. Public but
 * signature-authenticated. Configure the verification key via
 * `TRUSTEE_EVENTS_ED25519_PUBLIC_KEY` (env; PEM, `\n`-escaped/base64 accepted) or
 * the encrypted `trustee_events_ed25519_public_key` setting; unconfigured → 503.
 */
@Injectable()
export class TrusteeEventsService {
  private readonly logger = new Logger('TrusteeEvents');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async publicKeyPem(): Promise<string | undefined> {
    const raw =
      (await this.settings.resolve('trustee_events_ed25519_public_key')) ??
      process.env.TRUSTEE_EVENTS_ED25519_PUBLIC_KEY;
    if (!raw) return undefined;
    const s = raw.trim();
    if (s.includes('BEGIN')) return s.replace(/\\n/g, '\n');
    try {
      const decoded = Buffer.from(s, 'base64').toString('utf8');
      return decoded.includes('BEGIN') ? decoded : s;
    } catch {
      return s;
    }
  }

  private tryVerify(pem: string, subject: string, signatureBase64: string): boolean {
    try {
      return verifyEd25519(pem, subject, signatureBase64);
    } catch {
      return false;
    }
  }

  async ingest(
    rawBody: string,
    headerSignature: string | undefined,
    headers: { clientId?: string; timestamp?: string; nonce?: string; keyId?: string },
  ): Promise<{ ok: true; id: string; type: string; scheme: 'A' | 'B'; duplicate: boolean }> {
    const pem = await this.publicKeyPem();
    if (!pem) {
      this.logger.error('trustee events receiver has no verification key configured — rejecting delivery');
      throw new ServiceUnavailableException('trustee events receiver is not configured');
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('body is not valid JSON');
    }

    const attempted: string[] = [];
    let scheme: 'A' | 'B' | undefined;

    // ---- Scheme B: body.signature over { eventType, targetPlatform, payload } ----
    const bodySig = typeof body.signature === 'string' ? body.signature : undefined;
    if (bodySig && body.eventType !== undefined && body.payload !== undefined) {
      const subject = canonicalize({
        eventType: body.eventType,
        targetPlatform: body.targetPlatform,
        payload: body.payload,
      });
      attempted.push(`B:${subject}`);
      if (this.tryVerify(pem, subject, bodySig)) scheme = 'B';
    }

    // ---- Scheme A: X-Signature over { method, path, clientId, timestamp, nonce, bodyHash } ----
    if (!scheme && headerSignature && body.payload !== undefined) {
      const bodyHash = sha256Hex(canonicalize(body.payload));
      const clientId = headers.clientId ?? (body.clientId as string | undefined);
      const nonce = headers.nonce ?? (body.nonce as string | undefined);
      const tsRaw = headers.timestamp ?? (body.timestamp as string | number | undefined);
      // timestamp type is ambiguous over the wire (string header vs numeric body
      // field); try both so canonicalization matches whichever the trustee used.
      const tsCandidates: Array<string | number> = [];
      if (tsRaw !== undefined) {
        tsCandidates.push(tsRaw);
        const asNum = Number(tsRaw);
        if (Number.isFinite(asNum) && String(asNum) !== String(tsRaw)) tsCandidates.push(asNum);
        if (typeof tsRaw === 'number') tsCandidates.push(String(tsRaw));
      }
      for (const timestamp of tsCandidates.length ? tsCandidates : [undefined]) {
        const subject = canonicalize({
          method: 'POST',
          path: RECEIVER_PATH,
          clientId,
          timestamp,
          nonce,
          bodyHash,
        });
        attempted.push(`A:${subject}`);
        if (this.tryVerify(pem, subject, headerSignature)) {
          scheme = 'A';
          break;
        }
      }
    }

    if (!scheme) {
      // Log the exact subject(s) we tried so a mismatch is diagnosable against a
      // real delivery without guessing.
      this.logger.warn(`trustee event signature mismatch; subjects tried: ${attempted.map((a) => a.slice(0, 300)).join(' | ')}`);
      throw new UnauthorizedException('signature mismatch');
    }

    const payload = body.payload as Record<string, unknown> | undefined;
    const id =
      (body.id as string) || (body.eventId as string) || (payload?.id as string) || (body.nonce as string);
    const type = (body.eventType as string) || (payload?.type as string);
    if (!id || !type) throw new BadRequestException('event id and type are required');

    let duplicate = false;
    try {
      await this.prisma.trusteeInboundEvent.create({
        data: { id, type, payload: JSON.parse(rawBody) as Prisma.InputJsonValue },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        duplicate = true;
      } else {
        throw e;
      }
    }
    this.logger.log(`trustee event ${type} ${id} verified via scheme ${scheme}${duplicate ? ' (duplicate)' : ''}`);
    return { ok: true, id, type, scheme, duplicate };
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
  @ApiOperation({ summary: 'Receiver for trustee-delivered events (Ed25519, canonical-JSON subject)' })
  async events(
    @Req() req: Request,
    @Headers('x-signature') signature: string | undefined,
    @Headers('x-client-id') clientId: string | undefined,
    @Headers('x-timestamp') timestamp: string | undefined,
    @Headers('x-nonce') nonce: string | undefined,
    @Headers('x-key-id') keyId: string | undefined,
    @Body() _body: unknown,
  ) {
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? '';
    return this.svc.ingest(rawBody, signature, { clientId, timestamp, nonce, keyId });
  }
}

@Module({
  controllers: [TrusteeEventsController],
  providers: [TrusteeEventsService],
})
export class TrusteeEventsModule {}
