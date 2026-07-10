import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import { PaymentStatus } from '@paykh/shared-types';

export interface PaymentStatusEvent {
  paymentId: string;
  status: PaymentStatus;
  at: string;
}

/**
 * In-process pub/sub for live checkout status (SSE). Single-instance only in
 * Phase 1; Phase 2 replaces this with a Redis pub/sub channel so SSE works
 * across horizontally-scaled API instances.
 */
@Injectable()
export class PaymentEventsService {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  private channel(paymentId: string): string {
    return `payment:${paymentId}`;
  }

  publish(event: PaymentStatusEvent): void {
    this.emitter.emit(this.channel(event.paymentId), event);
  }

  subscribe(paymentId: string, listener: (event: PaymentStatusEvent) => void): () => void {
    const channel = this.channel(paymentId);
    this.emitter.on(channel, listener);
    return () => this.emitter.off(channel, listener);
  }
}
