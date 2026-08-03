import { MetadataProviderKey, type MetadataCandidate } from '@bookorbit/types';

import { EMBEDDED_SERIES_TOTAL_SOURCE, MANUAL_SERIES_TOTAL_SOURCE, SeriesExpectedCountService } from './series-expected-count.service';
import { normalizeMetadataText, normalizeMetadataTextKey } from '../utils/metadata-text-normalize.utils';

function makeSeriesIdentity(ids: Record<string, number>) {
  return {
    normalizeDisplayName: vi.fn((name: string | null | undefined) => normalizeMetadataText(name)),
    normalizeName: vi.fn((name: string | null | undefined) => normalizeMetadataTextKey(name)),
    findIdByName: vi.fn((name: string) => Promise.resolve(ids[normalizeMetadataTextKey(name) ?? ''] ?? null)),
  };
}

/** Reports one updated row per update by default, matching a series whose count actually changed. */
function makeDb(updatedRowsPerCall: number = 1) {
  const returning = vi.fn(() => Promise.resolve(Array.from({ length: updatedRowsPerCall }, (_, i) => ({ id: i + 1 }))));
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { db: { update, select: vi.fn() } as never, update, set, where, returning };
}

/**
 * The raise-only rule lives in the SQL predicate so concurrent scans cannot race a read-then-write,
 * which means a mocked db never evaluates it. Pulling the operator tokens out of the Drizzle
 * expression is what lets us assert the comparison is `<` and not `<>`.
 */
function sqlOperators(node: unknown, out: string[] = []): string[] {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => sqlOperators(child, out));
    return out;
  }
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (chunks) sqlOperators(chunks, out);
  const value = (node as { value?: unknown }).value;
  if (Array.isArray(value)) value.forEach((token) => typeof token === 'string' && out.push(token));
  return out;
}

function candidate(data: Partial<MetadataCandidate>): MetadataCandidate {
  return {
    provider: MetadataProviderKey.HARDCOVER,
    providerId: 'p1',
    title: 'A book',
    ...data,
  };
}

describe('SeriesExpectedCountService', () => {
  describe('recordFromCandidates', () => {
    it('stores the total against the matching local series', async () => {
      const identity = makeSeriesIdentity({ dune: 101 });
      const { db, set, update } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      const updated = await service.recordFromCandidates([candidate({ seriesName: 'Dune', seriesTotalBooks: 6 })]);

      expect(updated).toBe(1);
      expect(update).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedBookCount: 6,
          expectedBookCountSource: MetadataProviderKey.HARDCOVER,
          expectedBookCountUpdatedAt: expect.any(Date),
        }),
      );
    });

    it('never creates a series row for a series nobody owns', async () => {
      const identity = makeSeriesIdentity({});
      const { db, update } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      const updated = await service.recordFromCandidates([candidate({ seriesName: 'Unowned Saga', seriesTotalBooks: 9 })]);

      expect(updated).toBe(0);
      expect(update).not.toHaveBeenCalled();
    });

    it('only raises the stored total, so the result cannot depend on scan order', async () => {
      const identity = makeSeriesIdentity({ dune: 101 });
      const { db, where } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      await service.recordFromCandidates([candidate({ seriesName: 'Dune', seriesTotalBooks: 6 })]);

      const operators = sqlOperators(where.mock.calls[0]?.[0]);
      expect(operators).toContain(' < ');
      expect(operators).not.toContain(' <> ');
      expect(operators).toContain(' is null');
    });

    it('applies the same raise-only guard to totals read from a file', async () => {
      const identity = makeSeriesIdentity({ batman: 101 });
      const { db, where } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      await service.record('Batman', 7);

      expect(sqlOperators(where.mock.calls[0]?.[0])).toContain(' < ');
    });

    it('reports zero updates when the stored count already matches', async () => {
      const identity = makeSeriesIdentity({ dune: 101 });
      const { db, update } = makeDb(0);
      const service = new SeriesExpectedCountService(db, identity as never);

      const updated = await service.recordFromCandidates([candidate({ seriesName: 'Dune', seriesTotalBooks: 6 })]);

      expect(updated).toBe(0);
      expect(update).toHaveBeenCalledTimes(1);
    });

    it('skips candidates with no series name', async () => {
      const identity = makeSeriesIdentity({ dune: 101 });
      const { db, update } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      const updated = await service.recordFromCandidates([candidate({ seriesTotalBooks: 6 }), candidate({ seriesName: '   ', seriesTotalBooks: 6 })]);

      expect(updated).toBe(0);
      expect(update).not.toHaveBeenCalled();
    });

    it('skips candidates with no usable total', async () => {
      const identity = makeSeriesIdentity({ dune: 101 });
      const { db, update } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      const updated = await service.recordFromCandidates([
        candidate({ seriesName: 'Dune' }),
        candidate({ seriesName: 'Dune', seriesTotalBooks: 0 }),
        candidate({ seriesName: 'Dune', seriesTotalBooks: -1 }),
        candidate({ seriesName: 'Dune', seriesTotalBooks: 10_001 }),
        candidate({ seriesName: 'Dune', seriesTotalBooks: 2.5 }),
      ]);

      expect(updated).toBe(0);
      expect(update).not.toHaveBeenCalled();
    });

    it('writes once per series when providers disagree, taking the larger total', async () => {
      const identity = makeSeriesIdentity({ dune: 101 });
      const { db, set, update } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      const updated = await service.recordFromCandidates([
        candidate({ provider: MetadataProviderKey.HARDCOVER, seriesName: 'Dune', seriesTotalBooks: 6 }),
        candidate({ provider: MetadataProviderKey.GOOGLE, seriesName: 'Dune', seriesTotalBooks: 8 }),
        candidate({ provider: MetadataProviderKey.OPEN_LIBRARY, seriesName: 'Dune', seriesTotalBooks: 3 }),
      ]);

      expect(updated).toBe(1);
      expect(update).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ expectedBookCount: 8, expectedBookCountSource: MetadataProviderKey.GOOGLE }));
    });

    it('collapses names that differ only by normalization into one series', async () => {
      const identity = makeSeriesIdentity({ dune: 101 });
      const { db, update } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      await service.recordFromCandidates([
        candidate({ seriesName: 'Dune', seriesTotalBooks: 6 }),
        candidate({ seriesName: '  dune  ', seriesTotalBooks: 6 }),
        candidate({ seriesName: 'DUNE', seriesTotalBooks: 6 }),
      ]);

      expect(update).toHaveBeenCalledTimes(1);
    });

    it('records each distinct series separately', async () => {
      const identity = makeSeriesIdentity({ dune: 101, 'the expanse': 202 });
      const { db, update } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      const updated = await service.recordFromCandidates([
        candidate({ seriesName: 'Dune', seriesTotalBooks: 6 }),
        candidate({ seriesName: 'The Expanse', seriesTotalBooks: 9 }),
      ]);

      expect(updated).toBe(2);
      expect(update).toHaveBeenCalledTimes(2);
    });

    it('does nothing for an empty candidate list', async () => {
      const identity = makeSeriesIdentity({ dune: 101 });
      const { db, update } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      expect(await service.recordFromCandidates([])).toBe(0);
      expect(update).not.toHaveBeenCalled();
      expect(identity.findIdByName).not.toHaveBeenCalled();
    });

    it('swallows database failures so a metadata refresh is never lost to a series total', async () => {
      const identity = makeSeriesIdentity({ dune: 101 });
      const update = vi.fn(() => {
        throw new Error('connection terminated');
      });
      const service = new SeriesExpectedCountService({ update, select: vi.fn() } as never, identity as never);

      await expect(service.recordFromCandidates([candidate({ seriesName: 'Dune', seriesTotalBooks: 6 })])).resolves.toBe(0);
    });

    it('records a total a file declared about its own series', async () => {
      const identity = makeSeriesIdentity({ batman: 101 });
      const { db, set } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      const updated = await service.record('Batman', 7);

      expect(updated).toBe(1);
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ expectedBookCount: 7, expectedBookCountSource: EMBEDDED_SERIES_TOTAL_SOURCE }));
    });

    it('applies the same validation to file totals as to provider totals', async () => {
      const identity = makeSeriesIdentity({ batman: 101 });
      const { db, update } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      for (const bad of [undefined, null, 0, -2, 4.5, 10_001, 'many']) {
        expect(await service.record('Batman', bad), `total=${String(bad)}`).toBe(0);
      }
      expect(await service.record(null, 7)).toBe(0);
      expect(await service.record('   ', 7)).toBe(0);
      expect(update).not.toHaveBeenCalled();
    });

    it('does not create a series row for a file naming an unowned series', async () => {
      const identity = makeSeriesIdentity({});
      const { db, update } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      expect(await service.record('Unowned Comic', 7)).toBe(0);
      expect(update).not.toHaveBeenCalled();
    });

    it('swallows failures on the file path too', async () => {
      const identity = makeSeriesIdentity({ batman: 101 });
      const update = vi.fn(() => {
        throw new Error('connection terminated');
      });
      const service = new SeriesExpectedCountService({ update, select: vi.fn() } as never, identity as never);

      await expect(service.record('Batman', 7)).resolves.toBe(0);
    });

    it('swallows series lookup failures too, on the candidate path', async () => {
      const identity = makeSeriesIdentity({ dune: 101 });
      identity.findIdByName.mockRejectedValueOnce(new Error('lookup exploded'));
      const { db } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      await expect(service.recordFromCandidates([candidate({ seriesName: 'Dune', seriesTotalBooks: 6 })])).resolves.toBe(0);
    });
  });

  describe('setManual', () => {
    it('stores what a person typed, marked as manual', async () => {
      const identity = makeSeriesIdentity({ dune: 101 });
      const { db, set } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      await expect(service.setManual('Dune', 6)).resolves.toBe(true);
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ expectedBookCount: 6, expectedBookCountSource: MANUAL_SERIES_TOTAL_SOURCE }));
    });

    it('clears the total and its source when the field is emptied', async () => {
      const identity = makeSeriesIdentity({ dune: 101 });
      const { db, set } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      await expect(service.setManual('Dune', null)).resolves.toBe(true);
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ expectedBookCount: null, expectedBookCountSource: null }));
    });

    it('lowers an existing total, unlike the automated paths which only raise it', async () => {
      const identity = makeSeriesIdentity({ dune: 101 });
      const { db, set, where } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      await service.setManual('Dune', 2);

      expect(set).toHaveBeenCalledWith(expect.objectContaining({ expectedBookCount: 2 }));
      // No comparison on the stored total: a person stating the length outright must win
      // in both directions, which is the escape hatch for a wrong automated maximum.
      const operators = sqlOperators(where.mock.calls[0]?.[0]);
      expect(operators).not.toContain(' < ');
      expect(operators).not.toContain(' <> ');
    });

    it('reports false without writing when the series is unknown or unnamed', async () => {
      const identity = makeSeriesIdentity({ dune: 101 });
      const { db, update } = makeDb();
      const service = new SeriesExpectedCountService(db, identity as never);

      await expect(service.setManual('Never Heard Of It', 6)).resolves.toBe(false);
      await expect(service.setManual(null, 6)).resolves.toBe(false);
      await expect(service.setManual('   ', 6)).resolves.toBe(false);
      expect(update).not.toHaveBeenCalled();
    });

    it('propagates failures so a save cannot silently do nothing', async () => {
      const identity = makeSeriesIdentity({ dune: 101 });
      const update = vi.fn(() => {
        throw new Error('connection terminated');
      });
      const service = new SeriesExpectedCountService({ update, select: vi.fn() } as never, identity as never);

      await expect(service.setManual('Dune', 6)).rejects.toThrow('connection terminated');
    });
  });
});
