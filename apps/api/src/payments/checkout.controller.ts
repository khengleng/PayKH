import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { PaymentsService } from './payments.service';
import { PaymentEventsService } from './payment-events.service';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit';

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

    send('status', { id, status: initial.status, at: initial.created_at });

    const terminal = new Set(['paid', 'expired', 'failed', 'cancelled']);
    if (terminal.has(initial.status)) {
      send('done', { id, status: initial.status });
      res.end();
      return;
    }

    const unsubscribe = this.events.subscribe(id, (evt) => {
      send('status', evt);
      if (terminal.has(evt.status)) {
        send('done', { id, status: evt.status });
        res.end();
      }
    });

    // Heartbeat so proxies keep the connection open.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}
