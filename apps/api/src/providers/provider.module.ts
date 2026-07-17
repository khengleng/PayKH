import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { MockKhqrProvider } from './mock-khqr.provider';
import { BakongKhqrProvider } from './bakong-khqr.provider';
import { RoutingKhqrProvider } from './routing-khqr.provider';
import { DIGITAL_VALUE_PROVIDER } from './digital-value-provider.interface';
import { MockDigitalValueProvider } from './mock-digital-value.provider';

/**
 * Binds the PAYMENT_PROVIDER token to the concrete implementation selected by
 * the PAYMENT_PROVIDER env var. Controllers depend only on the interface token.
 */
@Global()
@Module({
  providers: [
    MockKhqrProvider,
    BakongKhqrProvider,
    RoutingKhqrProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, MockKhqrProvider, BakongKhqrProvider, RoutingKhqrProvider],
      useFactory: (
        config: ConfigService,
        mock: MockKhqrProvider,
        bakong: BakongKhqrProvider,
        routing: RoutingKhqrProvider,
      ) => {
        // 'bakong' forces every store onto the platform Bakong account (the
        // original single-account behaviour). Anything else — including the
        // default 'mock' — routes per store: a store that imported its own bank
        // KHQR pays that account; the rest fall back to mock. So an imported
        // account reaches POS / links / checkout with no env change.
        const provider = config.get<string>('paymentProvider') ?? 'mock';
        if (provider === 'bakong') return bakong;
        if (provider === 'mock') return mock; // explicit escape hatch: force mock everywhere
        return routing;
      },
    },

    // Digital value (loyalty points today; cashback / gift-card balances later).
    // Selected by DIGITAL_VALUE_PROVIDER, defaulting to the mock — the same
    // shape as the payment provider above. `paychain` is not yet a valid choice:
    // the real implementation lands once credentials exist, and until then a
    // deploy that sets it must fail loudly at boot rather than silently fall
    // back to the mock and look like it is talking to PayChain.
    MockDigitalValueProvider,
    {
      provide: DIGITAL_VALUE_PROVIDER,
      inject: [ConfigService, MockDigitalValueProvider],
      useFactory: (config: ConfigService, mock: MockDigitalValueProvider) => {
        const provider = config.get<string>('digitalValueProvider') ?? 'mock';
        if (provider !== 'mock') {
          throw new Error(
            `DIGITAL_VALUE_PROVIDER="${provider}" is not implemented yet (only "mock"). ` +
              'The PayChain provider needs credentials — see docs/paychain.md.',
          );
        }
        return mock;
      },
    },
  ],
  exports: [PAYMENT_PROVIDER, DIGITAL_VALUE_PROVIDER],
})
export class ProviderModule {}
