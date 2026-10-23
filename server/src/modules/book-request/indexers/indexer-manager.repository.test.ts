import type { IndexerCategoryMap } from '@bookorbit/types';
import type { RequestIndexerManagerRow, RequestIndexerRow } from '../../../db/schema';
import { IndexerManagerRepository } from './indexer-manager.repository';
import type { ProwlarrIndexer } from './prowlarr.client';

const categories: Record<'torrent' | 'usenet', IndexerCategoryMap> = {
  torrent: { ebook: [7020], audiobook: [3030] },
  usenet: { ebook: [7020], audiobook: [3030] },
};

function source(id: number, color: RequestIndexerRow['color']): RequestIndexerRow {
  return {
    id,
    managerId: 3,
    managerExternalId: String(id),
    color,
  } as RequestIndexerRow;
}

function discovered(id: number): ProwlarrIndexer {
  return {
    id,
    name: `Source ${id}`,
    implementation: 'Cardigann',
    protocol: 'torrent',
    enabled: true,
    priority: 25,
    seedRatioGoal: null,
    seedTimeMinutes: null,
  };
}

describe('IndexerManagerRepository', () => {
  it('preserves selected colors and assigns least-used colors to uncolored and new sources', async () => {
    const existing = [source(1, 'orange'), source(2, null)];
    const updates: Array<Partial<RequestIndexerRow>> = [];
    const inserts: Array<Partial<RequestIndexerRow>> = [];
    const tx = {
      select: vi
        .fn()
        .mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve(existing) }) })
        .mockReturnValueOnce({ from: () => Promise.resolve(existing.map(({ color }) => ({ color }))) }),
      update: vi.fn(() => ({
        set: (data: Partial<RequestIndexerRow>) => {
          updates.push(data);
          return { where: () => Promise.resolve() };
        },
      })),
      insert: vi.fn(() => ({
        values: (data: Partial<RequestIndexerRow>) => {
          inserts.push(data);
          return Promise.resolve();
        },
      })),
    };
    const db = { transaction: vi.fn((run: (value: typeof tx) => unknown) => run(tx)) };
    const repository = new IndexerManagerRepository(db as never);

    await repository.syncProwlarrSources(
      {
        id: 3,
        enabled: true,
        baseUrl: 'http://127.0.0.1:9696',
        allowPrivateAddress: true,
        inheritSeedLimits: true,
        syncNewIndexers: true,
        networkProfile: null,
      } as RequestIndexerManagerRow,
      [discovered(1), discovered(2), discovered(3)],
      categories,
    );

    expect(updates.filter((update) => 'color' in update).map((update) => update.color)).toEqual(['orange', 'blue']);
    expect(inserts).toEqual([expect.objectContaining({ managerExternalId: '3', color: 'indigo' })]);
  });
  it.each([
    { protocol: 'torrent' as const, inheritSeedLimits: false, expectedTracker: false, expectedRatio: null, expectedTime: null },
    { protocol: 'torrent' as const, inheritSeedLimits: true, expectedTracker: true, expectedRatio: 1, expectedTime: 4320 },
    { protocol: 'usenet' as const, inheritSeedLimits: false, expectedTracker: true, expectedRatio: null, expectedTime: null },
    { protocol: 'usenet' as const, inheritSeedLimits: true, expectedTracker: true, expectedRatio: null, expectedTime: null },
  ])(
    'synchronizes new and existing $protocol sources with inheritance=$inheritSeedLimits',
    async ({ protocol, inheritSeedLimits, expectedTracker, expectedRatio, expectedTime }) => {
      const existing = [{ ...source(1, 'blue'), applyTrackerSeedGoals: !expectedTracker, seedRatioGoal: 7, seedTimeMinutes: 120 }];
      const sourceWrites: Array<Partial<RequestIndexerRow>> = [];
      const tx = {
        select: vi
          .fn()
          .mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve(existing) }) })
          .mockReturnValueOnce({ from: () => Promise.resolve(existing) }),
        update: vi.fn(() => ({
          set: (data: Partial<RequestIndexerRow>) => {
            if ('adapterType' in data) sourceWrites.push(data);
            return { where: () => Promise.resolve() };
          },
        })),
        insert: vi.fn(() => ({
          values: (data: Partial<RequestIndexerRow>) => {
            sourceWrites.push(data);
            return Promise.resolve();
          },
        })),
      };
      const db = { transaction: (run: (value: typeof tx) => unknown) => run(tx) };
      const repository = new IndexerManagerRepository(db as never);
      await expect(
        repository.syncProwlarrSources(
          {
            id: 3,
            enabled: true,
            baseUrl: 'http://127.0.0.1:9696',
            allowPrivateAddress: true,
            inheritSeedLimits,
            syncNewIndexers: true,
            networkProfile: null,
          } as RequestIndexerManagerRow,
          [1, 2].map((id) => ({ ...discovered(id), protocol, seedRatioGoal: 1, seedTimeMinutes: 4320 })),
          categories,
        ),
      ).resolves.toEqual({ created: 1, updated: 1, unavailable: 0 });

      expect(sourceWrites).toHaveLength(2);
      for (const write of sourceWrites) {
        expect(write).toMatchObject({
          adapterType: protocol === 'torrent' ? 'torznab' : 'newznab',
          applyTrackerSeedGoals: expectedTracker,
          seedRatioGoal: expectedRatio,
          seedTimeMinutes: expectedTime,
        });
      }
    },
  );
});
