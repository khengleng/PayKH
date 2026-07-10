import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { MockKhqrProvider } from './mock-khqr.provider';
import { BakongKhqrProvider } from './bakong-khqr.provider';

/**
 * Binds the PAYMENT_PROVIDER token to the concrete implementation selected by
 * the PAYMENT_PROVIDER env var. Controllers depend only on the interface token.
 */
@Global()
@Module({
  providers: [
    MockKhqrProvider,
    BakongKhqrProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, MockKhqrProvider, BakongKhqrProvider],
      useFactory: (
        config: ConfigService,
        mock: MockKhqrProvider,
        bakong: BakongKhqrProvider,
      ) => {
        const provider = config.get<string>('paymentProvider') ?? 'mock';
        return provider === 'bakong' ? bakong : mock;
      },
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class ProviderModule {}
