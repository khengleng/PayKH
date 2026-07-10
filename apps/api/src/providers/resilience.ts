import { Logger } from '@nestjs/common';

/**
 * Lightweight timeout + retry + circuit-breaker wrapper for provider calls.
 * Phase 1 uses this around the mock provider; Phase 2 wraps the real Bakong
 * HTTP client. State is per-instance (per API process).
 */
export interface ResilienceOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private readonly logger = new Logger('CircuitBreaker');

  constructor(
    private readonly name: string,
    private readonly failureThreshold = 5,
    private readonly cooldownMs = 30_000,
  ) {}

  private isOpen(now: number): boolean {
    if (this.openedAt === null) return false;
    if (now - this.openedAt >= this.cooldownMs) {
      // half-open: allow a trial call
      this.openedAt = null;
      this.failures = 0;
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(now: number): void {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.openedAt = now;
      this.logger.warn(`Circuit "${this.name}" opened after ${this.failures} failures`);
    }
  }

  get open(): boolean {
    return this.isOpen(Date.now());
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Provider call timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withResilience<T>(
  breaker: CircuitBreaker,
  fn: () => Promise<T>,
  options: ResilienceOptions = {},
): Promise<T> {
  const { timeoutMs = 8000, retries = 2, retryDelayMs = 200 } = options;

  if (breaker.open) {
    throw new Error('Payment provider temporarily unavailable (circuit open)');
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await withTimeout(fn(), timeoutMs);
      breaker.recordSuccess();
      return result;
    } catch (err) {
      lastError = err;
      breaker.recordFailure(Date.now());
      if (attempt < retries) {
        await sleep(retryDelayMs * Math.pow(2, attempt)); // exponential backoff
      }
    }
  }
  throw lastError;
}
