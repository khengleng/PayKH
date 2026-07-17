import { CustomersService } from './customers.service';

function make(seed: { id: string; storeId: string; phone?: string; email?: string; name?: string }[] = []) {
  const rows = [...seed];
  const prisma = {
    customer: {
      findFirst: jest.fn(({ where }: { where: { storeId: string; OR: { phone?: string; email?: string }[] } }) =>
        Promise.resolve(rows.filter((r) => r.storeId === where.storeId).find((r) =>
          where.OR.some((o) => (o.phone && r.phone === o.phone) || (o.email && r.email === o.email))) ?? null)),
      create: jest.fn(({ data }: { data: { id: string; storeId: string; phone?: string; email?: string; name?: string } }) => {
        rows.push({ ...data }); return Promise.resolve(data);
      }),
      update: jest.fn(({ where, data }: { where: { id: string }; data: object }) => {
        const r = rows.find((x) => x.id === where.id); if (r) Object.assign(r, data); return Promise.resolve(r);
      }),
    },
  };
  const svc = new CustomersService(prisma as never, {} as never);
  return { svc, rows, prisma };
}

describe('CustomersService.resolveOrCreateByContact', () => {
  it('returns null when no phone or email is given (nothing to attach)', async () => {
    const { svc, prisma } = make();
    expect(await svc.resolveOrCreateByContact('s1', {})).toBeNull();
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it('creates a customer for a new phone', async () => {
    const { svc, rows } = make();
    const id = await svc.resolveOrCreateByContact('s1', { phone: '012345678', name: 'A' });
    expect(id).toBeTruthy();
    expect(rows).toHaveLength(1);
    expect(rows[0].phone).toBe('012345678');
  });

  it('reuses an existing customer with the same phone (no duplicate)', async () => {
    const { svc, prisma } = make([{ id: 'c1', storeId: 's1', phone: '012345678' }]);
    expect(await svc.resolveOrCreateByContact('s1', { phone: '012345678' })).toBe('c1');
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it('does not match a phone from another store', async () => {
    const { svc } = make([{ id: 'c1', storeId: 'other', phone: '012345678' }]);
    const id = await svc.resolveOrCreateByContact('s1', { phone: '012345678' });
    expect(id).not.toBe('c1');
  });

  it('matches by email case-insensitively', async () => {
    const { svc } = make([{ id: 'c1', storeId: 's1', email: 'a@b.com' }]);
    expect(await svc.resolveOrCreateByContact('s1', { email: 'A@B.COM' })).toBe('c1');
  });

  it('backfills a missing name on an existing record', async () => {
    const { svc, rows } = make([{ id: 'c1', storeId: 's1', phone: '012345678' }]);
    await svc.resolveOrCreateByContact('s1', { phone: '012345678', name: 'Backfilled' });
    expect(rows[0].name).toBe('Backfilled');
  });
});
