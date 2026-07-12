import { Global, Module } from '@nestjs/common';
import { AlertService } from './alert.service';

/**
 * Global operational alerting. Depends only on globally-provided services
 * (SettingsService, EmailService), so any module — including the worker's
 * separate Nest context — can inject AlertService without extra wiring.
 */
@Global()
@Module({
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertModule {}
