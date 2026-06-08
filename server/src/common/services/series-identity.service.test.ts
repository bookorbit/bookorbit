import { SeriesIdentityService } from './series-identity.service';

function flattenSql(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenSql).join(' ');
  if (!value || typeof value !== 'object') return '';

  const record = value as { queryChunks?: unknown[]; value?: unknown };
  return [flattenSql(record.value), flattenSql(record.queryChunks)].join(' ');
}

function makeInsertDb(rows: Array<{ id: number }> = [{ id: 42 }]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return { db: { insert } as never, insert, values, onConflictDoUpdate, returning };
}

function makeSelectDb(rows: Array<{ id: number }> = [{ id: 42 }]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } as never, select, from, where, limit };
}

describe('SeriesIdentityService', () => {
  it('normalizes names for identity while preserving display casing', () => {
    const service = new SeriesIdentityService({} as never);

    expect(service.normalizeName('  The Expanse  ')).toBe('the expanse');
    expect(service.normalizeName('   ')).toBeNull();
    expect(service.normalizeName(null)).toBeNull();
    expect(service.normalizeDisplayName('  The Expanse  ')).toBe('The Expanse');
    expect(service.normalizeDisplayName('   ')).toBeNull();
  });

  it('does not create a series row for blank names', async () => {
    const { db, insert } = makeInsertDb();
    const service = new SeriesIdentityService(db);

    await expect(service.resolveSeriesId('   ')).resolves.toBeNull();

    expect(insert).not.toHaveBeenCalled();
  });

  it('upserts a series row by normalized name and returns the stable id', async () => {
    const { db, insert, values, onConflictDoUpdate, returning } = makeInsertDb([{ id: 77 }]);
    const service = new SeriesIdentityService(db);

    const id = await service.resolveSeriesId('  Dune Chronicles  ');

    expect(id).toBe(77);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith({ name: 'Dune Chronicles', normalizedName: 'dune chronicles' });
    const conflictConfig = onConflictDoUpdate.mock.calls[0]![0] as { set: Record<string, unknown> };
    expect(conflictConfig.set).toEqual({ updatedAt: expect.any(Date) });
    expect(conflictConfig.set).not.toHaveProperty('name');
    expect(returning).toHaveBeenCalledTimes(1);
  });

  it('returns null when series resolution produces no row', async () => {
    const { db } = makeInsertDb([]);
    const service = new SeriesIdentityService(db);

    await expect(service.resolveSeriesId('Dune')).resolves.toBeNull();
  });

  it('leaves metadata untouched when seriesName is absent or undefined', async () => {
    const { db, insert } = makeInsertDb();
    const service = new SeriesIdentityService(db);
    const withoutSeries = { title: 'Dune' };
    const undefinedSeries = { title: 'Dune Messiah', seriesName: undefined };

    await expect(service.resolveMetadataPatch(withoutSeries)).resolves.toBe(withoutSeries);
    await expect(service.resolveMetadataPatch(undefinedSeries)).resolves.toBe(undefinedSeries);

    expect(insert).not.toHaveBeenCalled();
  });

  it('adds seriesId and trims seriesName when metadata includes a series', async () => {
    const { db } = makeInsertDb([{ id: 88 }]);
    const service = new SeriesIdentityService(db);

    const patch = await service.resolveMetadataPatch({ bookId: 1, title: 'Caliban War', seriesName: '  The Expanse  ' });

    expect(patch).toEqual({ bookId: 1, title: 'Caliban War', seriesName: 'The Expanse', seriesId: 88 });
  });

  it('clears seriesId when metadata clears seriesName', async () => {
    const { db, insert } = makeInsertDb();
    const service = new SeriesIdentityService(db);

    const patch = await service.resolveMetadataPatch({ bookId: 1, seriesName: '   ' });

    expect(patch).toEqual({ bookId: 1, seriesName: null, seriesId: null });
    expect(insert).not.toHaveBeenCalled();
  });

  it('runs all startup backfill statements without requiring manual data migration SQL', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const service = new SeriesIdentityService({ execute } as never);

    await service.backfillMissingSeriesIds();

    expect(execute).toHaveBeenCalledTimes(3);
    const createSeriesSql = flattenSql(execute.mock.calls[0]![0]).replace(/\s+/g, ' ');
    expect(createSeriesSql).toContain('ON CONFLICT (normalized_name) DO NOTHING');
    expect(createSeriesSql).not.toContain('DO UPDATE SET');
    expect(createSeriesSql).not.toContain('excluded.name');
  });

  it('runs backfill inside a transaction on initialization', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const tx = { execute } as never;
    const transaction = vi.fn().mockImplementation(async (cb: (tx: typeof tx) => Promise<void>) => cb(tx));
    const service = new SeriesIdentityService({ transaction } as never);
    const backfill = vi.spyOn(service, 'backfillMissingSeriesIds').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(backfill).toHaveBeenCalledTimes(1);
    expect(backfill).toHaveBeenCalledWith(tx);
  });

  it('disables statement timeout before running backfill', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const tx = { execute } as never;
    const transaction = vi.fn().mockImplementation(async (cb: (tx: typeof tx) => Promise<void>) => cb(tx));
    const service = new SeriesIdentityService({ transaction } as never);
    vi.spyOn(service, 'backfillMissingSeriesIds').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(execute).toHaveBeenCalledTimes(1);
    const timeoutSql = flattenSql(execute.mock.calls[0]![0]);
    expect(timeoutSql).toMatch(/SET LOCAL statement_timeout\s*=\s*0/i);
  });

  it('continues startup and logs error when backfill transaction fails', async () => {
    const transaction = vi.fn().mockRejectedValue(new Error('connection reset'));
    const service = new SeriesIdentityService({ transaction } as never);
    const logError = vi.spyOn(service['logger' as never] as { error: (...args: unknown[]) => void }, 'error').mockImplementation(() => undefined);

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(1);
    const message = logError.mock.calls[0]![0] as string;
    expect(message).toContain('[series.backfill] [fail]');
    expect(message).toContain('connection reset');
  });

  it('finds an existing id by normalized name', async () => {
    const { db, select } = makeSelectDb([{ id: 91 }]);
    const service = new SeriesIdentityService({} as never);

    await expect(service.findIdByName('  DUNE  ', db)).resolves.toBe(91);

    expect(select).toHaveBeenCalledTimes(1);
  });

  it('returns null when a normalized series lookup has no row', async () => {
    const { db } = makeSelectDb([]);
    const service = new SeriesIdentityService({} as never);

    await expect(service.findIdByName('Dune', db)).resolves.toBeNull();
  });

  it('does not query for a blank name lookup', async () => {
    const { db, select } = makeSelectDb();
    const service = new SeriesIdentityService({} as never);

    await expect(service.findIdByName('   ', db)).resolves.toBeNull();

    expect(select).not.toHaveBeenCalled();
  });
});
