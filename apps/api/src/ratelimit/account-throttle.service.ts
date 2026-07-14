import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import IORedis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ApiError } from '../common/api-error';
import { FIXED_WINDOW_LUA } from './rate-limit';

/**
 * Account-scoped brute-force throttle, independent of the per-IP rate limiter.
 * The per-IP limit alone lets a credential-stuffing attacker rotate source IPs
 * and get a fresh budget against the same account each time; this keys the
 * counter on the target account (hashed email) so failed attempts against one
 * account are capped no matter where they come from.
 *
 * Fails OPEN on a Redis outage (consistent with RateLimitGuard) so auth never
 * hard-depends on Redis availability.
 */
@Injectable()
export class AccountThrottleService {
  private readonly logger = new Logger('AccountThrottle');
  /** Max failed attempts per account within the window before a 429. */
  private readonly LIMIT = 10;
  private readonly WINDOW_SEC = 15 * 60;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: IORedis) {}

  private key(scope: string, account: string): string {
    const h = createHash('sha256').update(account.toLowerCase().trim()).digest('hex').slice(0, 32);
    return `rl:acct:${scope}:${h}`;
  }

  /**
   * Reject with 429 if this account already has too many recent failures. Call
   * BEFORE verifying the credential so a locked account short-circuits.
   */
  async assertNotLocked(scope: string, account: string): Promise<void> {
    try {
      const count = Number(await this.redis.get(this.key(scope, account)));
      if (count >= this.LIMIT) {
        throw new ApiError('rate_limit_exceeded', 'Too many attempts for this account. Try again later.');
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      this.logger.warn(`account throttle unavailable, allowing: ${err}`);
    }
  }

  /** Record a failed attempt (atomic INCR+EXPIRE). */
  async recordFailure(scope: string, account: string): Promise<void> {
    try {
      await this.redis.eval(FIXED_WINDOW_LUA, 1, this.key(scope, account), this.WINDOW_SEC);
    } catch (err) {
      this.logger.warn(`account throttle record failed: ${err}`);
    }
  }

  /** Clear the counter after a successful auth. */
  async clear(scope: string, account: string): Promise<void> {
    try {
      await this.redis.del(this.key(scope, account));
    } catch {
      /* best-effort */
    }
  }
}
