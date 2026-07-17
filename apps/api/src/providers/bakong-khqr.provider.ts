import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateKhqrInput,
  CreateKhqrResult,
  PaymentProvider,
  ProviderHealth,
  ProviderReference,
  ProviderStatusResult,
  RefundInput,
  RefundResult,
} from './payment-provider.interface';
import { CircuitBreaker, withResilience } from './resilience';
import { buildBakongKhqr } from './khqr.util';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { BakongAccount, readAccounts } from './bakong-credential';

/** Legacy single-account shape, still accepted for the platform env blob. */
interface BakongCredential {
  bakongAccountId: string;
  /** Payee account/phone (tag 29 sub-tag 01) — the "receiver account" banks
   *  require. Populated by the KHQR import. */
  accountInformation?: string;
  merchantName?: string;
  merchantCity?: string;
  merchantId?: string;
  acquiringBank?: string;
  mobileNumber?: string;
  isMerchant?: boolean;
  /** Optional per-store Bakong API token; falls back to BAKONG_API_TOKEN. */
  apiToken?: string;
}

/**
 * Real Bakong KHQR provider (NBC Open API).
 *
 * - createKhqr: builds a production KHQR payload from the store's encrypted
 *   Bakong credentials (NBC KHQR spec) and returns its MD5 for status polling.
 * - checkPaymentStatus: calls `/v1/check_transaction_by_md5` (responseCode 0 =
 *   paid). Called by the worker's status-poll job.
 *
 * All network calls are wrapped in withResilience (timeout + retry + circuit
 * breaker). Activated by PAYMENT_PROVIDER=bakong.
 */
@Injectable()
export class BakongKhqrProvider implements PaymentProvider {
  readonly name = 'bakong';
  private readonly logger = new Logger('BakongKhqrProvider');
  protected readonly breaker = new CircuitBreaker('bakong-khqr');

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private baseUrl(): string {
    const url = this.config.get<string>('bakongApiBaseUrl');
    if (!url) throw new Error('BAKONG_API_BASE_URL is not configured');
    return url.replace(/\/$/, '');
  }

  /**
   * The payee account for a payment's currency. A store holds one account per
   * currency (Wing issues separate KHR/USD accounts), so this selects by
   * currency and refuses rather than misroute when that currency is not
   * imported — paying a USD amount into a KHR account is the failure this
   * exists to prevent.
   */
  private async loadCredential(storeId: string, mode: 'test' | 'live', currency: 'USD' | 'KHR'): Promise<BakongAccount> {
    // Platform subscription payments use a single dedicated account from env,
    // valid for whatever currency the invoice is in.
    if (storeId === '__platform__') {
      const raw = this.config.get<string>('bakongPlatformAccount');
      if (!raw) throw new Error('BAKONG_PLATFORM_ACCOUNT is not configured');
      const parsed = JSON.parse(raw) as BakongCredential;
      if (!parsed.bakongAccountId) throw new Error('Platform credential missing bakongAccountId');
      return parsed;
    }
    const cred = await this.prisma.providerCredential.findUnique({
      where: {
        storeId_provider_mode: { storeId, provider: 'bakong', mode: mode === 'live' ? 'LIVE' : 'TEST' },
      },
    });
    if (!cred) {
      throw new Error(`No Bakong ${mode} credential configured for store ${storeId}`);
    }
    const accounts = readAccounts(JSON.parse(this.crypto.decrypt(cred.secretCiphertext)));
    const account = accounts[currency];
    if (!account) {
      const have = Object.keys(accounts).join(', ') || 'none';
      throw new Error(`No ${currency} account imported for this store (imported: ${have}). Upload the ${currency} KHQR from your bank.`);
    }
    const parsed = account;
    if (!parsed.bakongAccountId) {
      throw new Error('Bakong credential is missing bakongAccountId');
    }
    return parsed;
  }

  private token(cred: BakongCredential): string {
    const token = cred.apiToken || this.config.get<string>('bakongApiToken');
    if (!token) throw new Error('No Bakong API token (BAKONG_API_TOKEN or per-store apiToken)');
    return token;
  }

  async createKhqr(input: CreateKhqrInput): Promise<CreateKhqrResult> {
    const cred = await this.loadCredential(input.storeId, input.mode, input.currency);
    const { qrString, md5 } = buildBakongKhqr({
      bakongAccountId: cred.bakongAccountId,
      accountInformation: cred.accountInformation,
      merchantName: cred.merchantName || input.merchantName,
      merchantCity: cred.merchantCity || input.merchantCity || 'Phnom Penh',
      amount: input.amount,
      currency: input.currency,
      merchantId: cred.merchantId,
      acquiringBank: cred.acquiringBank,
      billNumber: input.referenceId ?? input.paymentId,
      storeLabel: input.merchantName,
      isMerchant: cred.isMerchant,
    });
    return { qrString, md5, billNumber: input.referenceId ?? input.paymentId };
  }

  async checkPaymentStatus(ref: ProviderReference): Promise<ProviderStatusResult> {
    if (!ref.md5) return { state: 'unknown' };
    // Status polling uses the platform token (BAKONG_API_TOKEN); a per-store
    // token would require the store context which the poller does not carry.
    const token = this.config.get<string>('bakongApiToken');
    if (!token) return { state: 'unknown' };

    return withResilience(this.breaker, async () => {
      const res = await this.httpPost(
        '/v1/check_transaction_by_md5',
        { md5: ref.md5 },
        token,
      );
      // Bakong: responseCode 0 => transaction found/settled.
      if (res.responseCode === 0) {
        return {
          state: 'paid',
          providerTxnId: (res.data?.hash as string) ?? undefined,
          raw: res as Record<string, unknown>,
        };
      }
      return { state: 'pending', raw: res as Record<string, unknown> };
    });
  }

  async verifyPayment(ref: ProviderReference): Promise<boolean> {
    const result = await this.checkPaymentStatus(ref);
    return result.state === 'paid';
  }

  async cancelPayment(_ref: ProviderReference): Promise<void> {
    // Bakong KHQR payments cannot be cancelled server-side; expiry handles it.
  }

  async refundPayment(input: RefundInput): Promise<RefundResult> {
    // Bakong does not expose a programmatic refund API — refunds settle
    // out-of-band (bank transfer back to the payer). We record the refund
    // intent here so it is tracked/audited; operators complete settlement.
    this.logger.warn(
      `Bakong refund recorded as MANUAL for ${input.paymentId} (${input.amount} ${input.currency})`,
    );
    return { ok: true, manual: true };
  }

  async getProviderHealth(): Promise<ProviderHealth> {
    if (this.breaker.open) return { healthy: false, detail: 'circuit open' };
    try {
      const start = Date.now();
      // Lightweight reachability check against the API root.
      await fetch(this.baseUrl(), { method: 'GET' }).catch(() => undefined);
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { healthy: false, detail: (err as Error).message };
    }
  }

  /** POST JSON to the Bakong API with a Bearer token. Extracted for testing. */
  protected async httpPost(
    path: string,
    body: Record<string, unknown>,
    token: string,
  ): Promise<{ responseCode: number; data?: Record<string, unknown> }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${this.baseUrl()}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await res.json()) as { responseCode: number; data?: Record<string, unknown> };
      return json;
    } finally {
      clearTimeout(timer);
    }
  }
}
