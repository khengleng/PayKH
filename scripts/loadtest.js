// k6 load test for the PayKH payment API.
//   BASE_URL=https://api.paykh.cambobia.com API_KEY=bk_test_xxx k6 run scripts/loadtest.js
//
// Exercises the hot path: create payment -> retrieve. Uses a test key so no
// live funds move. Tune the stages to your target throughput.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:4000';
const KEY = __ENV.API_KEY;

const createLatency = new Trend('create_latency_ms');

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // <1% errors
    http_req_duration: ['p(95)<800'], // 95% under 800ms
  },
};

export default function () {
  if (!KEY) throw new Error('Set API_KEY (a bk_test_ key)');
  const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  const create = http.post(
    `${BASE}/v1/payments`,
    JSON.stringify({ amount: '1.50', currency: 'USD', reference_id: `load_${__VU}_${__ITER}` }),
    { headers },
  );
  createLatency.add(create.timings.duration);
  const ok = check(create, { 'create 201': (r) => r.status === 201 });

  if (ok) {
    const id = create.json('id');
    const get = http.get(`${BASE}/v1/payments/${id}`, { headers });
    check(get, { 'retrieve 200': (r) => r.status === 200 });
  }
  sleep(0.5);
}
