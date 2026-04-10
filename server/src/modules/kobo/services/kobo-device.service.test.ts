import { NotFoundException } from '@nestjs/common';

import { KoboDeviceService } from './kobo-device.service';

function makeSelectChain(orderByResult: unknown[] = [], limitResult: unknown[] = []) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockResolvedValue(orderByResult);
  chain.limit.mockResolvedValue(limitResult);
  return chain;
}

function makeDb() {
  const insertReturning = vi.fn();
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  const updateReturning = vi.fn();
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockReturnValue({ where: deleteWhere });

  return {
    select: vi.fn(),
    insert,
    insertValues,
    insertReturning,
    update,
    updateSet,
    updateWhere,
    updateReturning,
    delete: del,
    deleteWhere,
  };
}

describe('KoboDeviceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists devices for user ordered by creation time', async () => {
    const db = makeDb();
    const rows = [{ id: 1, name: 'Aura' }];
    db.select.mockReturnValueOnce(makeSelectChain(rows));
    const service = new KoboDeviceService(db as never);

    await expect(service.listDevices(8)).resolves.toEqual(rows);
  });

  it('creates a device with hyphen-free token and returns persisted fields', async () => {
    const db = makeDb();
    db.insertReturning.mockResolvedValueOnce([
      {
        id: 22,
        name: 'Libra',
        token: 'server-generated-token',
        lastSeenAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const service = new KoboDeviceService(db as never);

    await expect(service.createDevice(8, 'Libra')).resolves.toEqual({
      id: 22,
      name: 'Libra',
      token: 'server-generated-token',
      lastSeenAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(db.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 8,
        name: 'Libra',
        token: expect.stringMatching(/^[0-9a-f]+$/i),
      }),
    );
  });

  it('renames existing devices and throws when device is missing', async () => {
    const db = makeDb();
    db.select.mockReturnValueOnce(makeSelectChain([], [])).mockReturnValueOnce(makeSelectChain([], [{ id: 5, userId: 8 }]));
    db.updateReturning.mockResolvedValueOnce([{ id: 5, name: 'Clara', lastSeenAt: null, createdAt: new Date('2026-01-01T00:00:00.000Z') }]);
    const service = new KoboDeviceService(db as never);

    await expect(service.renameDevice(8, 404, 'Nope')).rejects.toThrow(NotFoundException);
    await expect(service.renameDevice(8, 5, 'Clara')).resolves.toEqual({
      id: 5,
      name: 'Clara',
      lastSeenAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('revokes devices and rejects unknown ids', async () => {
    const db = makeDb();
    db.select.mockReturnValueOnce(makeSelectChain([], [])).mockReturnValueOnce(makeSelectChain([], [{ id: 7 }]));
    const service = new KoboDeviceService(db as never);

    await expect(service.revokeDevice(8, 111)).rejects.toThrow(NotFoundException);
    await expect(service.revokeDevice(8, 7)).resolves.toBeUndefined();
    expect(db.delete).toHaveBeenCalled();
    expect(db.deleteWhere).toHaveBeenCalled();
  });
});
