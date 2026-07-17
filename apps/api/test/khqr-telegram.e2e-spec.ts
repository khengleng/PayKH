import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp } from './setup-app';
import { randomBase58 } from '@paykh/security';
import { crc16 } from '../src/providers/khqr.util';

/**
 * E2E coverage of the "bring your own bank account" + Telegram-detection money
 * paths, through the real HTTP layer — including the global ValidationPipe.
 *
 * These endpoints are unit-tested at the service level, but that path bypasses
 * the pipe. A missing DTO decorator once shipped a production 500 that every
 * unit test passed (the confirm endpoint). This suite exercises the wire format
 * end to end so that class of bug is caught in CI.
 */
const tlv = (t: string, v: string) => `${t}${v.length.toString().padStart(2, '0')}${v}`;
function bankQr(accountId: string, cur = '116', name = 'E2E MERCHANT') {
  const body =
    tlv('00', '01') + tlv('01', '11') + tlv('29', tlv('00', accountId)) +
    tlv('52', '5999') + tlv('53', cur) + tlv('58', 'KH') + tlv('59', name) + tlv('60', 'Phnom Penh') + '6304';
  return body + crc16(body);
}

describe('KHQR import + Telegram detection (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let storeId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    http = request(app.getHttpServer());
    const login = await http.post('/auth/login').send({ email: 'owner@demo.paykh.dev', password: 'Password123!' }).expect(201);
    token = login.body.token;
    const stores = await http.get('/stores').set('Authorization', `Bearer ${token}`).expect(200);
    storeId = stores.body[0].id;
  }, 60_000);

  afterAll(async () => {
    // Leave the store as we found it for other suites / the demo.
    await http.delete(`/dashboard/stores/${storeId}/khqr`).set('Authorization', `Bearer ${token}`).catch(() => undefined);
    await http.post(`/dashboard/stores/${storeId}/telegram-detection/unlink`).set('Authorization', `Bearer ${token}`).catch(() => undefined);
    await app?.close();
  });

  const auth = <T extends request.Test>(t: T) => t.set('Authorization', `Bearer ${token}`);

  describe('KHQR import', () => {
    it('imports a KHR account and reissues a valid static sample', async () => {
      const acct = `e2e_khr_${randomBase58(4)}@wing`;
      const res = await auth(http.post(`/dashboard/stores/${storeId}/khqr/import`)).send({ qr_string: bankQr(acct, '116') }).expect(201);
      expect(res.body.imported).toBe(true);
      expect(res.body.just_imported).toBe('KHR');
      expect(res.body.accounts.find((a: { currency: string }) => a.currency === 'KHR').bakong_account_id).toBe(acct);
      // The sample must be a real, CRC-valid KHQR.
      const s: string = res.body.sample_qr;
      expect(crc16(s.slice(0, -4))).toBe(s.slice(-4));
    });

    it('holds KHR and USD accounts side by side', async () => {
      await auth(http.post(`/dashboard/stores/${storeId}/khqr/import`)).send({ qr_string: bankQr('e2e_k@wing', '116') }).expect(201);
      const res = await auth(http.post(`/dashboard/stores/${storeId}/khqr/import`)).send({ qr_string: bankQr('e2e_u@wing', '840') }).expect(201);
      const currencies = res.body.accounts.map((a: { currency: string }) => a.currency).sort();
      expect(currencies).toEqual(['KHR', 'USD']);
    });

    it('rejects a tampered QR with a 400 (not a 500)', async () => {
      const good = bankQr('e2e_x@wing', '116');
      const tampered = good.slice(0, -1) + (good.slice(-1) === '0' ? '1' : '0');
      const res = await auth(http.post(`/dashboard/stores/${storeId}/khqr/import`)).send({ qr_string: tampered });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Could not read that KHQR/);
    });

    it('rejects a body with no qr_string (DTO validation)', async () => {
      const res = await auth(http.post(`/dashboard/stores/${storeId}/khqr/import`)).send({});
      expect(res.status).toBe(400);
    });
  });

  describe('per-currency routing through POS charge', () => {
    it('a KHR charge is refused with a clear 400 when only USD is connected', async () => {
      await auth(http.delete(`/dashboard/stores/${storeId}/khqr`));
      await auth(http.post(`/dashboard/stores/${storeId}/khqr/import`)).send({ qr_string: bankQr('e2e_usd@wing', '840') }).expect(201);
      const res = await auth(http.post(`/dashboard/stores/${storeId}/pos/charge`)).send({ amount: '5000', currency: 'KHR' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/No KHR account connected/);
    });

    it('a USD charge produces a QR paying the connected USD account', async () => {
      const res = await auth(http.post(`/dashboard/stores/${storeId}/pos/charge`)).send({ amount: '5.00', currency: 'USD' }).expect(201);
      const qr: string = res.body.qr_string ?? res.body.payment?.qr_string;
      expect(qr).toContain('e2e_usd@wing');
      expect(crc16(qr.slice(0, -4))).toBe(qr.slice(-4));
    });
  });

  describe('Telegram detection confirm (the endpoint that 500ed)', () => {
    it('rejects a confirm with no detection_id (DTO validation)', async () => {
      const res = await auth(http.post(`/dashboard/stores/${storeId}/telegram-detection/confirm`)).send({});
      expect(res.status).toBe(400); // was a 500 before ConfirmDto got @IsString()
    });

    it('rejects a confirm for an unknown detection id with a clean error', async () => {
      const res = await auth(http.post(`/dashboard/stores/${storeId}/telegram-detection/confirm`)).send({ detection_id: 'det_does_not_exist' });
      expect(res.status).toBe(404);
    });

    it('status is readable and reports whether the bot is configured', async () => {
      const res = await auth(http.get(`/dashboard/stores/${storeId}/telegram-detection`)).expect(200);
      expect(res.body).toHaveProperty('verified');
      expect(res.body).toHaveProperty('bot_configured');
    });
  });

  describe('the public webhook fails closed', () => {
    it('ignores an update with no secret header (200, no effect)', async () => {
      const res = await http.post('/telegram/webhook').send({ update_id: 1, message: { chat: { id: -1 }, text: 'Received 5000 KHR' } });
      expect([200, 201]).toContain(res.status);
    });
  });
});
