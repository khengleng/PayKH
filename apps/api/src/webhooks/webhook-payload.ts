import { Payment } from '@prisma/client';
import { WebhookEventPayload, WebhookEventType } from '@paykh/shared-types';
import { formatAmount } from '../payments/amount.util';

/** Build the signed webhook payload for a payment event. */
export function buildWebhookPayload(
  eventId: string,
  type: WebhookEventType,
  payment: Payment,
  createdIso: string,
): WebhookEventPayload {
  return {
    id: eventId,
    type,
    created: createdIso,
    data: {
      payment: {
        id: payment.id,
        status: payment.status.toLowerCase() as WebhookEventPayload['data']['payment']['status'],
        amount: formatAmount(payment.amount, payment.currency),
        currency: payment.currency,
        reference_id: payment.referenceId,
        metadata: (payment.metadata as Record<string, unknown>) ?? {},
        approved_at: payment.paidAt?.toISOString() ?? null,
      },
    },
  };
}
