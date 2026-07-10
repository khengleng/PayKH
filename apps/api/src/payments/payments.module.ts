import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { CheckoutController } from './checkout.controller';
import { PaymentEventsService } from './payment-events.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { BillingModule } from '../billing/billing.module';
import { BranchesModule } from '../branches/branches.module';

@Module({
  imports: [WebhooksModule, BillingModule, BranchesModule],
  controllers: [PaymentsController, CheckoutController],
  providers: [PaymentsService, PaymentEventsService, ApiKeyGuard],
  exports: [PaymentsService],
})
export class PaymentsModule {}
