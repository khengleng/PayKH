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
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, options.windowSec);
      const ttl = count === 1 ? options.windowSec : await this.redis.ttl(key);
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
