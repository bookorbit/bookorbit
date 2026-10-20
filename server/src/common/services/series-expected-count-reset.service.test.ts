import { MetadataProviderKey } from '@bookorbit/types';

import { APP_SETTING_KEYS } from '../constants/app-settings.constants';
import { SeriesExpectedCountResetService } from './series-expected-count-reset.service';

/** Collects the primitives drizzle binds into a query, so tests can assert on parameters rather than SQL text. */
function boundValues(node: unknown, out: unknown[] = [], seen = new Set<unknown>()): unknown[] {
  if (node === null || node === undefined || seen.has(node)) return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(node);
    return out;
  }
  if (typeof node !== 'object') return out;
  seen.add(node);
  for (const value of Object.values(node as Record<string, unknown>)) boundValues(value, out, seen);
  return out;
}

function makeDb(options: { markerWon: boolean; clearedIds?: number[]; updateError?: Error }) {
  const insertReturning = vi.fn().mockResolvedValue(options.markerWon ? [{ key: APP_SETTING_KEYS.SERIES_HARDCOVER_TOTALS_RESET }] : []);
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning: insertReturning });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });

  const updateReturning = options.updateError
    ? vi.fn().mockRejectedValue(options.updateError)
    : vi.fn().mockResolvedValue((options.clearedIds ?? []).map((id) => ({ id })));
  const where = vi.fn().mockReturnValue({ returning: updateReturning });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });

  const tx = { insert, update };
  const transaction = vi.fn((callback: (value: typeof tx) => unknown) => callback(tx));
  return { db: { transaction } as never, transaction, values, onConflictDoNothing, update, set, where };
}

function makeService(db: never) {
  const service = new SeriesExpectedCountResetService(db);
  const logger = (service as unknown as { logger: { log: (m: string) => void; warn: (m: string) => void } }).logger;
  return {
    service,
    log: vi.spyOn(logger, 'log').mockImplementation(() => undefined),
    warn: vi.spyOn(logger, 'warn').mockImplementation(() => undefined),
  };
}

describe('SeriesExpectedCountResetService', () => {
  it('clears only totals recorded from Hardcover, and claims the marker in the same transaction', async () => {
    const { db, transaction, values, onConflictDoNothing, set, where } = makeDb({ markerWon: true, clearedIds: [4, 9, 12] });
    const { service } = makeService(db);

    await expect(service.clearHardcoverTotalsOnce()).resolves.toBe(3);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ key: APP_SETTING_KEYS.SERIES_HARDCOVER_TOTALS_RESET }));
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ expectedBookCount: null, expectedBookCountSource: null, expectedBookCountUpdatedAt: expect.any(Date) }),
    );
    const bound = boundValues(where.mock.calls[0]?.[0]);
    expect(bound).toContain(MetadataProviderKey.HARDCOVER);
    expect(bound).not.toContain('manual');
    expect(bound).not.toContain('embedded');
  });

  it('touches nothing once an earlier boot has claimed the marker', async () => {
    const { db, update } = makeDb({ markerWon: false });
    const { service } = makeService(db);

    await expect(service.clearHardcoverTotalsOnce()).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('logs the count when it runs at startup', async () => {
    const { db } = makeDb({ markerWon: true, clearedIds: [1, 2] });
    const { service, log } = makeService(db);

    await service.onApplicationBootstrap();

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[series\.hardcover_total_reset\] \[end\] durationMs=\d+ cleared=2 - /));
  });

  it('stays quiet at startup once the reset has already run', async () => {
    const { db } = makeDb({ markerWon: false });
    const { service, log, warn } = makeService(db);

    await service.onApplicationBootstrap();

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs a failure without blocking startup', async () => {
    const { db } = makeDb({ markerWon: true, updateError: new Error('statement timeout') });
    const { service, warn } = makeService(db);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[series.hardcover_total_reset] [fail]'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('error="statement timeout"'));
  });
});
