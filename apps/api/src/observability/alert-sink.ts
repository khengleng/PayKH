/**
 * Module-level bridge so DI-free code (the global exception filter) can hand an
 * alert to the DI-managed AlertService without importing it. AlertService
 * registers itself on init; emitAlert is a no-op until then and never throws.
 */
export interface AlertPayload {
  title: string;
  detail: string;
  context?: Record<string, unknown>;
}

let sink: ((p: AlertPayload) => void) | null = null;

export function registerAlertSink(fn: (p: AlertPayload) => void): void {
  sink = fn;
}

export function emitAlert(payload: AlertPayload): void {
  try {
    sink?.(payload);
  } catch {
    /* never throw from telemetry */
  }
}
