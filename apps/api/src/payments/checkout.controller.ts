import { Controller, Get, Inject, Param, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import IORedis from 'ioredis';
import { PaymentsService } from './payments.service';
import { PaymentEventsService } from './payment-events.service';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ApiError } from '../common/api-error';

/** SSE connection ceilings — a live stream is a socket + listener + timer, so
 *  they must be bounded per source and in total lifetime, or a single host can
 *  exhaust file descriptors / heap. */
const SSE_MAX_PER_IP = 40;
const SSE_MAX_LIFETIME_MS = 15 * 60 * 1000;

/**
 * Public, unauthenticated endpoints for the hosted checkout page. These expose
 * only secret-free payment data + merchant branding. No API key or provider
 * credential is ever returned here. IP rate-limited like the other public
 * surfaces (wallet/shop/links) — the SSE stream also holds an open connection.
 */
@ApiTags('checkout')
@UseGuards(RateLimitGuard)
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly events: PaymentEventsService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}

  @Get(':id')
  @RateLimit({ limit: 60, windowSec: 10, by: 'ip' })
  @ApiOperation({ summary: 'Public checkout view for a payment (no secrets)' })
  view(@Param('id') id: string) {
    return this.payments.publicView(id);
  }

  @Get(':id/events')
  @RateLimit({ limit: 20, windowSec: 10, by: 'ip' })
  @ApiOperation({ summary: 'Server-Sent Events stream of live payment status' })
  async stream(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    // Validate the payment exists (and lazily expire) before opening the stream.
    const initial = await this.payments.publicView(id);

    // Per-IP concurrent-connection cap. Best-effort: fails open if Redis is
    // down (never take checkout offline over a cache blip). The safety TTL means
    // a crashed connection's slot is reclaimed even if `close` never fired.
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const ipKey = `sse:${ip}`;
    let counted = false;
    try {
      const n = await this.redis.incr(ipKey);
      await this.redis.expire(ipKey, Math.ceil(SSE_MAX_LIFETIME_MS / 1000) + 60);
      if (n > SSE_MAX_PER_IP) {
        await this.redis.decr(ipKey).catch(() => undefined);
        throw new ApiError('rate_limit_exceeded', 'Too many live connections from your network — retry shortly');
      }
      counted = true;
    } catch (err) {
      if (err instanceof ApiError) throw err; // over the cap → 429 before any stream opens
      // Redis unavailable → fail open, continue without the cap.
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const timers: { heartbeat?: ReturnType<typeof setInterval>; lifetime?: ReturnType<typeof setTimeout> } = {};
    let unsubscribe: () => void = () => undefined;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (timers.heartbeat) clearInterval(timers.heartbeat);
      if (timers.lifetime) clearTimeout(timers.lifetime);
      unsubscribe();
      if (counted) this.redis.decr(ipKey).catch(() => undefined);
    };

    send('status', { id, status: initial.status, at: initial.created_at });

    const terminal = new Set(['paid', 'expired', 'failed', 'cancelled']);
    if (terminal.has(initial.status)) {
      send('done', { id, status: initial.status });
      cleanup();
      res.end();
      return;
    }

    unsubscribe = this.events.subscribe(id, (evt) => {
      send('status', evt);
      if (terminal.has(evt.status)) {
        send('done', { id, status: evt.status });
        cleanup();
        res.end();
      }
    });

    // Heartbeat so proxies keep the connection open.
    timers.heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    // Hard lifetime cap — a stream never lives forever even if the client never
    // disconnects and the payment never settles.
    timers.lifetime = setTimeout(() => {
      send('done', { id, status: 'timeout' });
      cleanup();
      res.end();
    }, SSE_MAX_LIFETIME_MS);

    req.on('close', cleanup);
  }
}
