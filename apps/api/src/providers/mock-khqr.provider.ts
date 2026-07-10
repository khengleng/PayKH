import { Injectable, Logger } from '@nestjs/common';
import {
  CreateKhqrInput,
  CreateKhqrResult,
  PaymentProvider,
  ProviderHealth,
  ProviderReference,
  ProviderStatusResult,
} from './payment-provider.interface';
import { buildMockKhqr } from './khqr.util';
import { CircuitBreaker, withResilience } from './resilience';

/**
 * Mock KHQR provider for Phase 1. Generates a valid-looking KHQR payload but
 * does not talk to Bakong. Payment state is driven by the API's own simulate
 * endpoint (test mode) rather than by polling — so checkPaymentStatus returns
 * `unknown` and the payment service treats DB state as authoritative.
 */
@Injectable()
export class MockKhqrProvider implements PaymentProvider {
  readonly name = 'mock';
  private readonly logger = new Logger('MockKhqrProvider');
  private readonly breaker = new CircuitBreaker('mock-khqr');

  async createKhqr(input: CreateKhqrInput): Promise<CreateKhqrResult> {
    return withResilience(this.breaker, async () => {
      const { qrString, md5 } = buildMockKhqr({
        merchantName: input.merchantName || 'PayKH Merchant',
        merchantCity: input.merchantCity || 'Phnom Penh',
        amount: input.amount,
        currency: input.currency,
        billNumber: input.referenceId ?? input.paymentId,
        storeLabel: input.merchantName,
      });
      this.logger.debug(`Generated mock KHQR for ${input.paymentId} (md5=${md5.slice(0, 8)}…)`);
      return { qrString, md5, billNumber: input.referenceId ?? input.paymentId };
    });
  }

  async checkPaymentStatus(_ref: ProviderReference): Promise<ProviderStatusResult> {
    // Mock provider is not the source of truth for status in Phase 1.
    return { state: 'unknown' };
  }

  async verifyPayment(_ref: ProviderReference): Promise<boolean> {
    return true;
  }

  async cancelPayment(_ref: ProviderReference): Promise<void> {
    // no-op for the mock
  }

  async getProviderHealth(): Promise<ProviderHealth> {
    return { healthy: !this.breaker.open, latencyMs: 0, detail: 'mock provider' };
  }
}
