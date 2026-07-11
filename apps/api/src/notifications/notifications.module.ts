import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { TelegramService } from './telegram.service';
import { MessagingService } from './messaging.service';
import { NotificationsController } from './notifications.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, TelegramService, MessagingService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
