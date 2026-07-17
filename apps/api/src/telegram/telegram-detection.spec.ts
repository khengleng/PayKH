import { Prisma } from '@prisma/client';
import { TelegramDetectionService } from './telegram-detection.module';

/** In-memory prisma double covering the tables the service touches. */
function make() {
  const sources: Record<string, unknown>[] = [];
  const detections: Record<string, unknown>[] = [];
  const payments: Record<string, unknown>[] = [];
  const p2002 = () => new Prisma.PrismaClientKnownRequestError('u', { code: 'P2002', clientVersion: '5' });

  const prisma = {
    store: { findUnique: jest.fn().mockResolvedValue({ id: 'st_1', organizationId: 'org_1' }) },
    telegramPaymentSource: {
      findUnique: jest.fn(({ where }: never) => Promise.resolve(sources.find((s) => s.storeId === (where as { storeId: string }).storeId) ?? null)),
      findFirst: jest.fn(({ where }: never) => {
        const w = where as Record<string, unknown>;
        const matchesVerifiedAt = (s: Record<string, unknown>) => {
          if (w.verifiedAt === undefined) return true;
          if (w.verifiedAt === null) return s.verifiedAt == null; // Prisma: IS NULL
          return s.verifiedAt != null; // { not: null }
        };
        return Promise.resolve(sources.find((s) =>
          (w.verifyCode === undefined || s.verifyCode === w.verifyCode) &&
          (w.chatId === undefined || s.chatId === w.chatId) &&
          matchesVerifiedAt(s),
        ) ?? null);
      }),
      upsert: jest.fn(({ where, create, update }: never) => {
        const w = (where as { storeId: string }).storeId;
        const found = sources.find((s) => s.storeId === w);
        if (found) Object.assign(found, update as object);
        else sources.push({ ...(create as object) });
        return Promise.resolve(sources.find((s) => s.storeId === w));
      }),
      update: jest.fn(({ where, data }: never) => {
        const found = sources.find((s) => s.id === (where as { id: string }).id);
        if (found) Object.assign(found, data as object);
        return Promise.resolve(found);
      }),
      deleteMany: jest.fn(() => { sources.length = 0; return Promise.resolve({ count: 1 }); }),
    },
    paymentDetection: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if (detections.some((d) => d.updateKey === data.updateKey)) return Promise.reject(p2002());
        detections.push(data);
        return Promise.resolve(data);
      }),
      findMany: jest.fn(() => Promise.resolve([...detections].reverse())),
      findUnique: jest.fn(({ where }: never) => Promise.resolve(detections.find((d) => d.id === (where as { id: string }).id) ?? null)),
      update: jest.fn(({ where, data }: never) => {
        const f = detections.find((d) => d.id === (where as { id: string }).id);
        if (f) Object.assign(f, data as object);
        return Promise.resolve(f);
      }),
    },
    payment: {
      findMany: jest.fn(({ where }: never) => {
        const w = where as { currency: string };
        return Promise.resolve(payments.filter((p) => p.currency === w.currency && ['PENDING', 'SCANNED'].includes(p.status as string)));
      }),
    },
  };
  const paid: string[] = [];
  const paymentsSvc = { transition: jest.fn((id: string, to: string) => { paid.push(`${id}->${to}`); return Promise.resolve({}); }) };
  const settings = { resolve: jest.fn().mockResolvedValue('BOT') };
  const config = { get: jest.fn().mockReturnValue('secret') };
  const svc = new TelegramDetectionService(prisma as never, settings as never, paymentsSvc as never, config as never);
  const owner = { userId: 'u1', memberships: [{ organizationId: 'org_1', role: 'owner' }] } as never;
  const addPayment = (id: string, amount: string, currency = 'KHR') => payments.push({ id, amount: new Prisma.Decimal(amount), currency, status: 'PENDING' });
  return { svc, owner, sources, detections, paid, addPayment };
}

describe('TelegramDetectionService', () => {
  it('verifies a chat only via the one-time code', async () => {
    const { svc, owner, sources } = make();
    const { verify_code } = await svc.beginVerify(owner, 'st_1');
    await svc.ingest({ update_id: 1, message: { chat: { id: -100 }, text: verify_code } });
    expect(sources[0].chatId).toBe('-100');
    expect(sources[0].verifiedAt).toBeTruthy();
    expect(sources[0].verifyCode).toBeNull(); // consumed
  });

  it('ignores a wrong verify code', async () => {
    const { svc, owner, sources } = make();
    await svc.beginVerify(owner, 'st_1');
    await svc.ingest({ update_id: 1, message: { chat: { id: -100 }, text: 'PAYKH-WRONG9' } });
    expect(sources[0].verifiedAt).toBeFalsy();
  });

  describe('the security boundary is the verified chat', () => {
    it('drops payment alerts from an unverified chat', async () => {
      const { svc, owner, detections, addPayment } = make();
      addPayment('p1', '5000');
      await svc.ingest({ update_id: 2, message: { chat: { id: -999 }, text: 'Received 5000 KHR' } });
      expect(detections).toHaveLength(0);
    });

    it('acts on alerts once the chat is verified', async () => {
      const { svc, owner, detections, addPayment } = make();
      const { verify_code } = await svc.beginVerify(owner, 'st_1');
      await svc.ingest({ update_id: 1, message: { chat: { id: -100 }, text: verify_code } });
      addPayment('p1', '5000');
      await svc.ingest({ update_id: 2, message: { chat: { id: -100 }, text: 'Received 5000 KHR' } });
      expect(detections).toHaveLength(1);
      expect(detections[0].paymentId).toBe('p1');
    });
  });

  describe('matching', () => {
    async function verified() {
      const m = make();
      const { verify_code } = await m.svc.beginVerify(m.owner, 'st_1');
      await m.svc.ingest({ update_id: 1, message: { chat: { id: -100 }, text: verify_code } });
      return m;
    }

    it('links a unique amount+currency match', async () => {
      const m = await verified();
      m.addPayment('p1', '5000');
      await m.svc.ingest({ update_id: 2, message: { chat: { id: -100 }, text: 'Received 5,000 KHR' } });
      expect(m.detections[0].matchCount).toBe(1);
      expect(m.detections[0].paymentId).toBe('p1');
    });

    it('records but does NOT link an ambiguous amount', async () => {
      const m = await verified();
      m.addPayment('p1', '9000'); m.addPayment('p2', '9000');
      await m.svc.ingest({ update_id: 2, message: { chat: { id: -100 }, text: 'Received 9000 KHR' } });
      expect(m.detections[0].matchCount).toBe(2);
      expect(m.detections[0].paymentId).toBeNull();
    });

    it('does not match across currencies', async () => {
      const m = await verified();
      m.addPayment('p1', '12', 'KHR');
      await m.svc.ingest({ update_id: 2, message: { chat: { id: -100 }, text: 'Received USD 12' } });
      expect(m.detections[0].matchCount).toBe(0);
    });

    it('records an unparseable alert with no match', async () => {
      const m = await verified();
      await m.svc.ingest({ update_id: 2, message: { chat: { id: -100 }, text: 'Your OTP is 123456' } });
      expect(m.detections[0].matchCount).toBe(0);
      expect(m.detections[0].amount).toBeNull();
    });

    it('dedupes a re-delivered update', async () => {
      const m = await verified();
      m.addPayment('p1', '5000');
      await m.svc.ingest({ update_id: 2, message: { chat: { id: -100 }, text: 'Received 5000 KHR' } });
      await m.svc.ingest({ update_id: 2, message: { chat: { id: -100 }, text: 'Received 5000 KHR' } });
      expect(m.detections).toHaveLength(1);
    });
  });

  describe('confirm (assist mode)', () => {
    it('marks the matched payment paid only when the cashier confirms', async () => {
      const m = make();
      const { verify_code } = await m.svc.beginVerify(m.owner, 'st_1');
      await m.svc.ingest({ update_id: 1, message: { chat: { id: -100 }, text: verify_code } });
      m.addPayment('p1', '5000');
      await m.svc.ingest({ update_id: 2, message: { chat: { id: -100 }, text: 'Received 5000 KHR' } });
      expect(m.paid).toHaveLength(0); // nothing auto-confirmed
      await m.svc.confirm(m.owner, m.detections[0].id as string);
      expect(m.paid).toContain('p1->paid');
    });

    it('refuses to confirm an unmatched detection', async () => {
      const m = make();
      const { verify_code } = await m.svc.beginVerify(m.owner, 'st_1');
      await m.svc.ingest({ update_id: 1, message: { chat: { id: -100 }, text: verify_code } });
      await m.svc.ingest({ update_id: 2, message: { chat: { id: -100 }, text: 'Received 9999 KHR' } }); // no payment
      await expect(m.svc.confirm(m.owner, m.detections[0].id as string)).rejects.toThrow(/not matched/);
    });
  });
});
