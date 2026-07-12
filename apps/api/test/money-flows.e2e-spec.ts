import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp } from './setup-app';
import { randomBase58 } from '@paykh/security';

/**
 * Integration/E2E coverage of the critical money paths against a live app + DB:
 * payment lifecycle, idempotency, state-machine guards, refunds (incl.
 * over-refund), and double-entry ledger balance/reconciliation. Uses the seeded
 * demo owner. Run with `npm run test:e2e` (needs DATABASE_URL + REDIS_URL).
 */
describe('Money flows (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let storeId: string;
  let apiKey: string;

  beforeAll(async () => {
    app = await bootTestApp();
    http = request(app.getHttpServer());

    const login = await http.post('/auth/login').send({ email: 'owner@demo.paykh.dev', password: 'Password123!' }).expect(201);
    token = login.body.token;
    expect(token).toBeTruthy();

    const stores = await http.get('/stores').set('Authorization', `Bearer ${token}`).expect(200);
    storeId = stores.body[0].id;

    const key = await http.post('/api-keys').set('Authorization', `Bearer ${token}`).send({ storeId, mode: 'test' }).expect(201);
    apiKey = key.body.secret;
    expect(apiKey).toMatch(/^bk_test_/);
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  const createPayment = (body: Record<string, unknown>, idem?: string) => {
    const r = http.post('/v1/payments').set('Authorization', `Bearer ${apiKey}`);
    if (idem) r.set('Idempotency-Key', idem);
    return r.send(body);
  };

  it('creates a payment in pending state', async () => {
    const res = await createPayment({ amount: '25.00', currency: 'USD', reference_id: `e2e_${randomBase58(6)}` }).expect(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.amount).toBe('25.00');
  });

  it('is idempotent on the Idempotency-Key', async () => {
    const idem = `idem_${randomBase58(10)}`;
    const first = await createPayment({ amount: '10.00', currency: 'USD' }, idem).expect(201);
    const second = await createPayment({ amount: '10.00', currency: 'USD' }, idem).expect(201);
    expect(second.body.id).toBe(first.body.id);
  });

  it('rejects an illegal state transition (paid -> pending)', async () => {
    const p = await createPayment({ amount: '5.00', currency: 'USD' }).expect(201);
    await http.post(`/v1/payments/${p.body.id}/simulate`).set('Authorization', `Bearer ${apiKey}`).send({ status: 'paid' }).expect(201);
    const bad = await http.post(`/v1/payments/${p.body.id}/simulate`).set('Authorization', `Bearer ${apiKey}`).send({ status: 'pending' });
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });

  it('posts a balanced double-entry journal on capture', async () => {
    const p = await createPayment({ amount: '100.00', currency: 'USD', reference_id: `led_${randomBase58(6)}` }).expect(201);
    await http.post(`/v1/payments/${p.body.id}/simulate`).set('Authorization', `Bearer ${apiKey}`).send({ status: 'paid' }).expect(201);

    const journals = await http.get(`/dashboard/stores/${storeId}/ledger/journals`).set('Authorization', `Bearer ${token}`).expect(200);
    const journal = journals.body.find((j: any) => j.reference === p.body.id);
    expect(journal).toBeDefined();
    const dr = journal.lines.filter((l: any) => l.direction === 'debit').reduce((s: number, l: any) => s + Number(l.amount), 0);
    const cr = journal.lines.filter((l: any) => l.direction === 'credit').reduce((s: number, l: any) => s + Number(l.amount), 0);
    expect(dr).toBeCloseTo(cr, 2);
    expect(dr).toBeCloseTo(100, 2);
  });

  it('refunds a paid payment and blocks over-refund', async () => {
    const p = await createPayment({ amount: '50.00', currency: 'USD' }).expect(201);
    await http.post(`/v1/payments/${p.body.id}/simulate`).set('Authorization', `Bearer ${apiKey}`).send({ status: 'paid' }).expect(201);

    await http.post(`/v1/payments/${p.body.id}/refund`).set('Authorization', `Bearer ${apiKey}`).send({ amount: '20.00' }).expect(201);
    // Over-refund of the remaining 30 by asking for 40 must be rejected.
    const over = await http.post(`/v1/payments/${p.body.id}/refund`).set('Authorization', `Bearer ${apiKey}`).send({ amount: '40.00' });
    expect(over.status).toBeGreaterThanOrEqual(400);
  });

  it('reconciles the store ledger (journal integrity + trial balance)', async () => {
    const recon = await http.get(`/dashboard/stores/${storeId}/ledger/reconcile`).set('Authorization', `Bearer ${token}`).expect(200);
    const integrity = recon.body.checks.find((c: any) => c.id === 'journal_integrity');
    const trial = recon.body.checks.find((c: any) => c.id === 'trial_balance');
    expect(integrity.ok).toBe(true);
    expect(trial.ok).toBe(true);
  });
});
