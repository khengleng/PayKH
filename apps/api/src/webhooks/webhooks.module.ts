import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { WebhookEventsService } from './webhook-events.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConnectorsModule } from '../connectors/connectors.module';

/**
 * Webhook management (endpoints, secrets, deliveries) + the event emitter used
 * by the payments service. The actual HTTP delivery is performed by the worker
 * (WorkerModule); this module only produces events and enqueues jobs.
 */
@Module({
  imports: [AuthModule, NotificationsModule, ConnectorsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookEventsService],
  exports: [WebhookEventsService],
})
export class WebhooksModule {}
