import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { CheckoutController } from './checkout.controller';
import { PaymentEventsService } from './payment-events.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [WebhooksModule],
  controllers: [PaymentsController, CheckoutController],
  providers: [PaymentsService, PaymentEventsService, ApiKeyGuard],
  exports: [PaymentsService],
})
export class PaymentsModule {}
