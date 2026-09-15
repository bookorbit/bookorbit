import type { IndexerCategoryMap } from '@bookorbit/types';
import type { RequestIndexerManagerRow, RequestIndexerRow } from '../../../db/schema';
import { IndexerManagerRepository } from './indexer-manager.repository';
import type { ProwlarrIndexer } from './prowlarr.client';

const categories: Record<'torrent' | 'usenet', IndexerCategoryMap> = {
  torrent: { ebook: [7020], audiobook: [3030], comic: [7030] },
  usenet: { ebook: [7020], audiobook: [3030], comic: [7030] },
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
});
