import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import IORedis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ApiError } from '../common/api-error';
import { ApiKeyContext } from '../auth/api-key.guard';

export interface RateLimitOptions {
  limit: number;
  windowSec: number;
  by: 'ip' | 'apiKey';
}

export const RATE_LIMIT_KEY = 'rate_limit_options';
/** Decorator to configure rate limiting on a route/controller. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

/**
 * Atomic fixed-window counter. INCR and EXPIRE happen in one server-side script
 * so a crash/failover between them can never leave a key without a TTL (which
 * would wedge the subject into a permanent 429). Also re-arms the TTL if the key
 * somehow lost it (ttl < 0). Returns [count, ttlSeconds].
 */
export const FIXED_WINDOW_LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 or redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return {c, redis.call('TTL', KEYS[1])}
`;

/**
 * Redis-backed fixed-window rate limiter. Fails open if Redis is unavailable so
 * a Redis outage never takes down the API. Emits standard RateLimit headers and
 * a structured 429 (`rate_limit_exceeded`).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger('RateLimit');

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const subject = this.subject(req, options.by);
    const key = `rl:${options.by}:${subject}:${req.path}`;

    try {
      const [count, ttlRaw] = (await this.redis.eval(
        FIXED_WINDOW_LUA,
        1,
        key,
        options.windowSec,
      )) as [number, number];
      const ttl = ttlRaw < 0 ? options.windowSec : ttlRaw;
      const remaining = Math.max(0, options.limit - count);

      res.setHeader('RateLimit-Limit', options.limit);
      res.setHeader('RateLimit-Remaining', remaining);
      res.setHeader('RateLimit-Reset', Math.max(0, ttl));

      if (count > options.limit) {
        res.setHeader('Retry-After', Math.max(1, ttl));
        throw new ApiError('rate_limit_exceeded', 'Too many requests, slow down');
      }
      return true;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      // Redis error -> fail open.
      this.logger.warn(`rate limiter unavailable, allowing request: ${err}`);
      return true;
    }
  }

  private subject(req: Request, by: 'ip' | 'apiKey'): string {
    if (by === 'apiKey') {
      const ctx = (req as Request & { apiKey?: ApiKeyContext }).apiKey;
      if (ctx) return ctx.apiKeyId;
    }
    return req.ip ?? req.socket.remoteAddress ?? 'unknown';
  }
}

/**
 * Global per-IP anti-flood backstop, registered as an APP_GUARD so it runs on
 * EVERY request — including the authenticated dashboard routes that carry no
 * per-route `@RateLimit`. Its bucket is per-IP across ALL paths (not per-path),
 * so a broad sweep of many endpoints from one source is caught, not just a
 * hammer on a single route.
 *
 * The ceiling is deliberately generous (a burst limit, not a fair-use quota):
 * it sits above the busiest legitimate client — the /v1 API's 100/10s per-key —
 * so real integrations and dashboard users never see it, while a single-source
 * flood is capped. Per-route limits (login, checkout, …) stay tighter and bite
 * first. Health/ready/metrics are skipped so a probe can never be throttled into
 * a restart loop. Fails open on any Redis error, exactly like RateLimitGuard.
 */
@Injectable()
export class GlobalThrottleGuard implements CanActivate {
  private readonly logger = new Logger('GlobalThrottle');
  private static readonly LIMIT = 200; // requests
  private static readonly WINDOW = 10; // seconds  (200/10s = 20 rps per IP)
  private static readonly SKIP = /^\/(health|ready|metrics)\b/;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: IORedis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (GlobalThrottleGuard.SKIP.test(req.path)) return true;
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const key = `rl:global:${ip}`;
    try {
      const [count, ttlRaw] = (await this.redis.eval(
        FIXED_WINDOW_LUA,
        1,
        key,
        GlobalThrottleGuard.WINDOW,
      )) as [number, number];
      if (count > GlobalThrottleGuard.LIMIT) {
        const res = context.switchToHttp().getResponse<Response>();
        const ttl = ttlRaw < 0 ? GlobalThrottleGuard.WINDOW : ttlRaw;
        res.setHeader('Retry-After', Math.max(1, ttl));
        throw new ApiError('rate_limit_exceeded', 'Too many requests, slow down');
      }
      return true;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      this.logger.warn(`global throttle unavailable, allowing request: ${err}`);
      return true;
    }
  }
}
