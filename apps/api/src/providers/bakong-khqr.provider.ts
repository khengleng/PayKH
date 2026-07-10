import { Injectable, Logger } from '@nestjs/common';
import {
  CreateKhqrInput,
  CreateKhqrResult,
  PaymentProvider,
  ProviderHealth,
  ProviderReference,
  ProviderStatusResult,
} from './payment-provider.interface';
import { CircuitBreaker } from './resilience';

/**
 * Real Bakong KHQR provider — PLACEHOLDER for Phase 2.
 *
 * The full implementation will:
 *  - Build production KHQR via the NBC/Bakong SDK using encrypted credentials.
 *  - Poll `check_transaction_by_md5` for status.
 *  - Wrap all HTTP calls in withResilience(this.breaker, …).
 *
 * It is registered only when PAYMENT_PROVIDER=bakong. In Phase 1 it throws to
 * make the "not yet wired" state explicit rather than silently mis-behaving.
 */
@Injectable()
export class BakongKhqrProvider implements PaymentProvider {
  readonly name = 'bakong';
  private readonly logger = new Logger('BakongKhqrProvider');
  protected readonly breaker = new CircuitBreaker('bakong-khqr');

  private notImplemented(): never {
    throw new Error(
      'BakongKhqrProvider is not implemented in Phase 1. Set PAYMENT_PROVIDER=mock.',
    );
  }

  async createKhqr(_input: CreateKhqrInput): Promise<CreateKhqrResult> {
    this.notImplemented();
  }

  async checkPaymentStatus(_ref: ProviderReference): Promise<ProviderStatusResult> {
    this.notImplemented();
  }

  async verifyPayment(_ref: ProviderReference): Promise<boolean> {
    this.notImplemented();
  }

  async cancelPayment(_ref: ProviderReference): Promise<void> {
    this.notImplemented();
  }

  async getProviderHealth(): Promise<ProviderHealth> {
    return { healthy: false, detail: 'bakong provider not implemented in Phase 1' };
  }
}
