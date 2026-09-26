import { CoverSlotBackfillService } from './cover-slot-backfill.service';

function makeService(options: { marker?: string | null; bothMediaIds?: number[]; repaired?: Array<{ bookId: number; libraryId: number }> } = {}) {
  const appSettings = {
    getValue: vi.fn().mockResolvedValue(options.marker ?? null),
    setValue: vi.fn().mockResolvedValue(undefined),
  };
  const repository = {
    listBookIdsAfter: vi.fn().mockResolvedValueOnce([1, 2, 3]).mockResolvedValueOnce([]),
    listBookIdsWithBothCoverMediaAfter: vi
      .fn()
      .mockResolvedValueOnce(options.bothMediaIds ?? [])
      .mockResolvedValueOnce([]),
    repairCoverSummaries: vi.fn().mockResolvedValue(options.repaired ?? []),
  };
  const store = {
    convertLegacy: vi.fn().mockImplementation((bookId: number) =>
      Promise.resolve({
        converted: bookId !== 3,
        libraryId: bookId === 3 ? 20 : 10,
      }),
    ),
  };
  const reconciler = {
    reconcile: vi
      .fn()
      .mockImplementation((bookId: number) => Promise.resolve({ libraryId: 10, changed: bookId !== 8, filled: bookId === 7 ? ['audio'] : [] })),
  };
  const events = { emitChanged: vi.fn() };
  const config = { backfillMode: 'sync' };
  const service = new CoverSlotBackfillService(
    appSettings as never,
    repository as never,
    store as never,
    events as never,
    config as never,
    reconciler as never,
  );
  return { service, appSettings, repository, store, reconciler, events };
}

function markers(appSettings: { setValue: ReturnType<typeof vi.fn> }) {
  return appSettings.setValue.mock.calls.map(([, value]) => JSON.parse(value as string) as unknown);
}

describe('CoverSlotBackfillService', () => {
  it('converts legacy covers, fills the second slot of books with both media, then repairs summaries', async () => {
    const { service, appSettings, repository, store, reconciler, events } = makeService({ bothMediaIds: [7, 8] });

    await expect(service.run()).resolves.toEqual({ processed: 5, converted: 2, filled: 1, failed: 0, repaired: 0 });

    expect(repository.listBookIdsAfter).toHaveBeenNthCalledWith(1, 0, 200);
    expect(repository.listBookIdsAfter).toHaveBeenNthCalledWith(2, 3, 200);
    expect(store.convertLegacy).toHaveBeenNthCalledWith(1, 1, { emit: false });
    expect(repository.listBookIdsWithBothCoverMediaAfter).toHaveBeenNthCalledWith(1, 0, 200);
    expect(reconciler.reconcile).toHaveBeenCalledWith(7, { backfill: true });
    expect(reconciler.reconcile).toHaveBeenCalledWith(8, { backfill: true });
    expect(events.emitChanged.mock.calls).toEqual([[{ bookIds: [1, 2], libraryId: 10 }], [{ bookIds: [7], libraryId: 10 }]]);
    expect(repository.repairCoverSummaries).toHaveBeenCalledOnce();
    expect(markers(appSettings)).toEqual([
      { version: 3, stage: 'a', lastBookId: 3 },
      { version: 3, stage: 'b', lastBookId: 0 },
      { version: 3, stage: 'b', lastBookId: 8 },
      { version: 3, stage: 'c', lastBookId: 0 },
      { version: 3, stage: 'complete', lastBookId: 0 },
    ]);
  });

  it('resumes at stage B when only the first upgrade has completed', async () => {
    const marker = JSON.stringify({ version: 1, stage: 'complete', lastBookId: 500 });
    const { service, repository, store, reconciler } = makeService({ marker, bothMediaIds: [7] });

    await expect(service.run()).resolves.toEqual({ processed: 1, converted: 0, filled: 1, failed: 0, repaired: 0 });

    expect(repository.listBookIdsAfter).not.toHaveBeenCalled();
    expect(store.convertLegacy).not.toHaveBeenCalled();
    expect(repository.listBookIdsWithBothCoverMediaAfter).toHaveBeenNthCalledWith(1, 0, 200);
    expect(reconciler.reconcile).toHaveBeenCalledOnce();
  });

  it('reruns stage B and then repairs summaries after a completed version 2 marker', async () => {
    const marker = JSON.stringify({ version: 2, stage: 'complete', lastBookId: 0 });
    const { service, appSettings, repository, store } = makeService({ marker, bothMediaIds: [7] });

    await expect(service.run()).resolves.toMatchObject({ processed: 1, filled: 1, repaired: 0 });

    expect(store.convertLegacy).not.toHaveBeenCalled();
    expect(repository.listBookIdsWithBothCoverMediaAfter).toHaveBeenNthCalledWith(1, 0, 200);
    expect(repository.repairCoverSummaries).toHaveBeenCalledOnce();
    expect(markers(appSettings).at(-1)).toEqual({ version: 3, stage: 'complete', lastBookId: 0 });
  });

  it('announces every repaired book, batched per library', async () => {
    const marker = JSON.stringify({ version: 3, stage: 'c', lastBookId: 0 });
    const repaired = [
      { bookId: 276, libraryId: 2 },
      { bookId: 277, libraryId: 2 },
      { bookId: 9, libraryId: 5 },
    ];
    const { service, repository, reconciler, events } = makeService({ marker, repaired });

    await expect(service.run()).resolves.toEqual({ processed: 0, converted: 0, filled: 0, failed: 0, repaired: 3 });

    expect(repository.listBookIdsWithBothCoverMediaAfter).not.toHaveBeenCalled();
    expect(reconciler.reconcile).not.toHaveBeenCalled();
    expect(events.emitChanged.mock.calls).toEqual([[{ bookIds: [276, 277], libraryId: 2 }], [{ bookIds: [9], libraryId: 5 }]]);
  });

  it('resumes stage B after the saved cursor', async () => {
    const marker = JSON.stringify({ version: 2, stage: 'b', lastBookId: 40 });
    const { service, repository } = makeService({ marker });

    await service.run();

    expect(repository.listBookIdsWithBothCoverMediaAfter).toHaveBeenNthCalledWith(1, 40, 200);
  });

  it('logs and skips a book that fails without stopping the stage', async () => {
    const { service, appSettings, repository, reconciler } = makeService({ bothMediaIds: [7, 8] });
    reconciler.reconcile.mockRejectedValueOnce(new Error('ffmpeg exploded'));

    await expect(service.run()).resolves.toMatchObject({ processed: 5, failed: 1 });

    expect(markers(appSettings).at(-1)).toEqual({ version: 3, stage: 'b', lastBookId: 8 });
    expect(repository.repairCoverSummaries).not.toHaveBeenCalled();
  });

  it('does no work after the version marker is complete', async () => {
    const marker = JSON.stringify({ version: 3, stage: 'complete', lastBookId: 0 });
    const { service, appSettings, repository, store, reconciler, events } = makeService({ marker });

    await expect(service.run()).resolves.toEqual({ processed: 0, converted: 0, filled: 0, failed: 0, repaired: 0 });

    expect(repository.listBookIdsAfter).not.toHaveBeenCalled();
    expect(repository.listBookIdsWithBothCoverMediaAfter).not.toHaveBeenCalled();
    expect(store.convertLegacy).not.toHaveBeenCalled();
    expect(reconciler.reconcile).not.toHaveBeenCalled();
    expect(repository.repairCoverSummaries).not.toHaveBeenCalled();
    expect(events.emitChanged).not.toHaveBeenCalled();
    expect(appSettings.setValue).not.toHaveBeenCalled();
  });
});
