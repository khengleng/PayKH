/**
 * PayKH background worker.
 *
 * Phase 1: this is a keep-alive stub that exposes a health line and does no
 * work. Phase 2 wires up BullMQ (Redis) consumers for:
 *   - webhook delivery with exponential backoff + max retries
 *   - payment-expiry sweeps
 *   - idempotency-record cleanup
 *
 * It is deployed as a separate Railway service so it can scale independently of
 * the API. Concurrency is controlled by WEBHOOK_WORKER_CONCURRENCY.
 */

const concurrency = Number(process.env.WEBHOOK_WORKER_CONCURRENCY ?? 5);

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: 'info', service: 'worker', msg, ts: new Date().toISOString() }));
}

async function main(): Promise<void> {
  log(`worker started (concurrency=${concurrency}) — Phase 1 stub, no jobs registered`);

  // Keep the process alive so Railway sees a running service.
  const heartbeat = setInterval(() => log('heartbeat'), 60_000);

  const shutdown = (signal: string) => {
    log(`received ${signal}, shutting down`);
    clearInterval(heartbeat);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
