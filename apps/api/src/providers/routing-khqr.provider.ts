import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
import { MockKhqrProvider } from './mock-khqr.provider';
import { BakongKhqrProvider } from './bakong-khqr.provider';

/**
 * Per-store KHQR routing.
 *
 * A store that has uploaded its own bank KHQR (an encrypted `bakong`
 * ProviderCredential) gets a real, bank-routable QR paying THAT account. Every
 * other store falls back to the mock, so nothing breaks for stores that have
 * not connected an account yet.
 *
 * This is what makes the imported account actually reach POS, payment links and
 * checkout — they all create payments through this one boundary, so routing
 * here covers all of them at once rather than each surface wiring it up.
 *
 * Only `createKhqr` needs a token-free path, and the Bakong builder is offline
 * (EMVCo TLV + CRC), so a store can accept a scan the moment it imports —
 * detection of the incoming payment is a separate concern handled elsewhere.
 */
@Injectable()
export class RoutingKhqrProvider implements PaymentProvider {
  readonly name = 'routing';
  private readonly logger = new Logger('RoutingKhqr');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mock: MockKhqrProvider,
    private readonly bakong: BakongKhqrProvider,
  ) {}

  private async hasImportedAccount(storeId: string, mode: 'test' | 'live'): Promise<boolean> {
    const row = await this.prisma.providerCredential.findUnique({
      where: { storeId_provider_mode: { storeId, provider: 'bakong', mode: mode === 'live' ? 'LIVE' : 'TEST' } },
      select: { id: true },
    });
    return !!row;
  }

  async createKhqr(input: CreateKhqrInput): Promise<CreateKhqrResult> {
    if (await this.hasImportedAccount(input.storeId, input.mode)) {
      this.logger.debug(`store ${input.storeId} (${input.mode}) → imported bakong account`);
      return this.bakong.createKhqr(input);
    }
    return this.mock.createKhqr(input);
  }

  // Status/verify/cancel go through the mock's behaviour: the imported flow does
  // not yet detect the incoming payment (deferred), and in test mode the
  // simulate endpoint remains the source of truth. Routing these to a real
  // provider without a working detection path would leave payments stuck
  // pending, which is worse than the current explicit behaviour.
  checkPaymentStatus(ref: ProviderReference): Promise<ProviderStatusResult> {
    return this.mock.checkPaymentStatus(ref);
  }

  verifyPayment(ref: ProviderReference): Promise<boolean> {
    return this.mock.verifyPayment(ref);
  }

  cancelPayment(ref: ProviderReference): Promise<void> {
    return this.mock.cancelPayment(ref);
  }

  refundPayment(input: RefundInput): Promise<RefundResult> {
    return this.mock.refundPayment(input);
  }

  async getProviderHealth(): Promise<ProviderHealth> {
    return { healthy: true, detail: 'routing (per-store: imported bakong account, else mock)' };
  }
}
