export interface CreateKhqrInput {
  paymentId: string;
  storeId: string;
  mode: 'test' | 'live';
  amount: string; // decimal string
  currency: 'USD' | 'KHR';
  referenceId?: string | null;
  description?: string | null;
  merchantName: string;
  merchantCity?: string;
  expiresAt: Date;
}

export interface CreateKhqrResult {
  qrString: string;
  /** MD5 of the QR payload — used by Bakong to poll payment status. */
  md5: string;
  billNumber?: string;
  raw?: Record<string, unknown>;
}

export type ProviderPaymentState = 'pending' | 'paid' | 'failed' | 'unknown';

export interface ProviderStatusResult {
  state: ProviderPaymentState;
  providerTxnId?: string;
  raw?: Record<string, unknown>;
}

export interface ProviderReference {
  md5?: string | null;
  billNumber?: string | null;
}

export interface ProviderHealth {
  healthy: boolean;
  latencyMs?: number;
  detail?: string;
}

/**
 * All payment-provider interactions go through this interface. Controllers and
 * services must never call a provider SDK directly.
 */
export interface PaymentProvider {
  readonly name: string;
  createKhqr(input: CreateKhqrInput): Promise<CreateKhqrResult>;
  checkPaymentStatus(ref: ProviderReference): Promise<ProviderStatusResult>;
  verifyPayment(ref: ProviderReference): Promise<boolean>;
  cancelPayment(ref: ProviderReference): Promise<void>;
  getProviderHealth(): Promise<ProviderHealth>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
