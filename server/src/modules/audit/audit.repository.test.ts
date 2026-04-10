import { AuditAction, AuditResource } from '@projectx/types';

import { AuditRepository } from './audit.repository';

function makeRepository(options?: { data?: unknown[]; total?: number }) {
  const data = options?.data ?? [];
  const total = options?.total ?? data.length;

  const dataLimit = { offset: vi.fn().mockResolvedValue(data) };
  const dataOrder = { limit: vi.fn().mockReturnValue(dataLimit) };
  const dataWhere = { orderBy: vi.fn().mockReturnValue(dataOrder) };
  const dataFrom = { where: vi.fn().mockReturnValue(dataWhere) };
  const dataSelect = { from: vi.fn().mockReturnValue(dataFrom) };

  const countFrom = { where: vi.fn().mockResolvedValue([{ total }]) };
  const countSelect = { from: vi.fn().mockReturnValue(countFrom) };

  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insertBuilder = { values: insertValues };

  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteBuilder = { where: deleteWhere };

  const db = {
    select: vi.fn((selection?: unknown) => (selection ? countSelect : dataSelect)),
    insert: vi.fn().mockReturnValue(insertBuilder),
    delete: vi.fn().mockReturnValue(deleteBuilder),
    _dataFrom: dataFrom,
    _dataWhere: dataWhere,
    _dataOrder: dataOrder,
    _dataLimit: dataLimit,
    _countFrom: countFrom,
    _insertValues: insertValues,
    _deleteWhere: deleteWhere,
  };

  return {
    repo: new AuditRepository(db as never),
    db,
  };
}

describe('AuditRepository', () => {
  it('insert stores audit records', async () => {
    const { repo, db } = makeRepository();

    await repo.insert({
      userId: 3,
      actorUsername: 'admin',
      action: AuditAction.BookMetadataUpdate,
      resource: AuditResource.Book,
      resourceId: 22,
      description: 'Updated metadata',
      ip: '127.0.0.1',
      meta: { source: 'test' },
    } as never);

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db._insertValues).toHaveBeenCalledTimes(1);
  });

  it('findAll applies pagination and filter conditions', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const { repo, db } = makeRepository({ data: rows, total: 7 });

    const result = await repo.findAll({
      userId: 9,
      action: AuditAction.LibraryUpdate,
      resource: AuditResource.Library,
      dateFrom: new Date('2026-01-01T00:00:00.000Z'),
      dateTo: new Date('2026-01-31T23:59:59.000Z'),
      page: 3,
      pageSize: 25,
    });

    expect(db._dataFrom.where).toHaveBeenCalledWith(expect.anything());
    expect(db._dataWhere.orderBy).toHaveBeenCalled();
    expect(db._dataOrder.limit).toHaveBeenCalledWith(25);
    expect(db._dataLimit.offset).toHaveBeenCalledWith(50);
    expect(db._countFrom.where).toHaveBeenCalledWith(expect.anything());
    expect(result).toEqual({ data: rows, total: 7 });
  });

  it('findAll keeps where undefined when no filters are supplied', async () => {
    const { repo, db } = makeRepository({ data: [], total: 0 });

    await repo.findAll({
      page: 1,
      pageSize: 50,
    });

    expect(db._dataFrom.where).toHaveBeenCalledWith(undefined);
    expect(db._countFrom.where).toHaveBeenCalledWith(undefined);
    expect(db._dataLimit.offset).toHaveBeenCalledWith(0);
  });

  it('deleteOlderThan removes entries before cutoff date', async () => {
    const { repo, db } = makeRepository();
    const cutoff = new Date('2025-12-31T00:00:00.000Z');

    await repo.deleteOlderThan(cutoff);

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db._deleteWhere).toHaveBeenCalledWith(expect.anything());
  });
});
