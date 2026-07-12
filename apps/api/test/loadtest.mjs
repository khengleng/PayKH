// Dependency-free load harness for PayKH. Fires a bounded pool of concurrent
// requests against the payment create+read path and reports throughput +
// latency percentiles. Usage:
//   node test/loadtest.mjs [baseUrl] [totalRequests] [concurrency]
// e.g. node test/loadtest.mjs http://127.0.0.1:4000 2000 50
const BASE = process.argv[2] ?? 'http://127.0.0.1:4000';
const TOTAL = Number(process.argv[3] ?? 1000);
const CONC = Number(process.argv[4] ?? 25);

const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t }; } };
const post = (p, b, a) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(a ? { Authorization: `Bearer ${a}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const getr = (p, a) => fetch(BASE + p, { headers: { Authorization: `Bearer ${a}` } });

function pct(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]; }

const OWNER = { email: 'owner@demo.paykh.dev', password: 'Password123!' };

const main = async () => {
  const token = (await j(await post('/auth/login', OWNER))).token;
  if (!token) throw new Error('login failed');
  const storeId = (await j(await getr('/stores', token)))[0].id;
  const apiKey = (await j(await post('/api-keys', { storeId, mode: 'test' }, token))).secret;

  console.log(`Load test → ${BASE}  total=${TOTAL} concurrency=${CONC}`);
  const latencies = [];
  // Buckets: ok (2xx), throttled (429 — the limiter shedding burst load, expected
  // and healthy), err (5xx / network — a real failure).
  let ok = 0, throttled = 0, err = 0, done = 0;
  const startedAt = performance.now();

  const worker = async () => {
    while (done < TOTAL) {
      const i = done++;
      if (i >= TOTAL) break;
      const t0 = performance.now();
      try {
        const create = await post('/v1/payments', { amount: '9.99', currency: 'USD', reference_id: `load_${i}` }, apiKey);
        if (create.ok) { const p = await j(create); await getr(`/v1/payments/${p.id}`, apiKey); ok++; }
        else if (create.status === 429) throttled++;
        else err++;
      } catch { err++; }
      latencies.push(performance.now() - t0);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));

  const elapsed = (performance.now() - startedAt) / 1000;
  latencies.sort((a, b) => a - b);
  const total = ok + throttled + err;
  console.log(`\nRequests : ${total}  (ok=${ok} throttled/429=${throttled} error=${err})`);
  console.log(`Duration : ${elapsed.toFixed(2)}s`);
  console.log(`Throughput: ${(total / elapsed).toFixed(0)} req/s attempted, ${(ok / elapsed).toFixed(0)} req/s served`);
  console.log(`Latency  : p50 ${pct(latencies, 50).toFixed(0)}ms  p95 ${pct(latencies, 95).toFixed(0)}ms  p99 ${pct(latencies, 99).toFixed(0)}ms  max ${latencies[latencies.length - 1].toFixed(0)}ms`);
  // Pass criterion: real errors (not throttling) must stay under 1%. Graceful
  // 429 shedding under burst is the limiter working as designed.
  const realErrRate = err / total;
  if (realErrRate > 0.01) { console.error(`\nFAIL: real-error rate ${(100 * realErrRate).toFixed(1)}% > 1%`); process.exit(1); }
  console.log(`\nPASS: ${err} real errors (${(100 * realErrRate).toFixed(2)}%); ${throttled} requests gracefully throttled (429).`);
};
main().catch((e) => { console.error(e); process.exit(1); });
