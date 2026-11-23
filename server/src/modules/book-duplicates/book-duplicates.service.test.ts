import { ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';
import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';

import type { RequestUser } from '../../common/types/request-user';
import { BookDuplicatesService, otherFormatKeys } from './book-duplicates.service';

const user = {
  id: 7,
  isSuperuser: false,
  contentFilters: EMPTY_CONTENT_FILTER_RULES,
} as RequestUser;

function scanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    userId: 7,
    libraryIds: [2],
    requestedLibraryId: 2,
    similarityPercent: 85,
    status: 'queued',
    processedBooks: 0,
    totalBooks: null,
    totalGroups: null,
    errorCode: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    completedAt: null,
    ...overrides,
  };
}

function setup(accessibleLibraryIds = [2]) {
  const repo = {
    markInterruptedScansFailed: vi.fn().mockResolvedValue(undefined),
    findActiveForUser: vi.fn().mockResolvedValue(null),
    createScanUnlessActive: vi.fn().mockResolvedValue(scanRow()),
    findScan: vi.fn().mockResolvedValue(scanRow()),
    countScopedBooks: vi.fn().mockResolvedValue(0),
    updateScan: vi.fn().mockResolvedValue(undefined),
    deleteOlderScans: vi.fn().mockResolvedValue(undefined),
    deleteScanArtifacts: vi.fn().mockResolvedValue(undefined),
    insertFileHashKeys: vi.fn().mockResolvedValue(undefined),
    findIsbnBatch: vi.fn().mockResolvedValue([]),
    insertIsbnKeys: vi.fn().mockResolvedValue(undefined),
    insertExactMetadataKeys: vi.fn().mockResolvedValue(undefined),
    createExactPairs: vi.fn().mockResolvedValue(undefined),
    createFuzzyPairs: vi.fn().mockResolvedValue(undefined),
    finalizeGroups: vi.fn().mockResolvedValue(0),
    deleteDismissedPairs: vi.fn().mockResolvedValue(0),
    computeScanTotals: vi.fn().mockResolvedValue({ totalExtraCopies: 0, totalReclaimableBytes: 0 }),
    findGroupMemberIds: vi.fn().mockResolvedValue([]),
    findGroupKind: vi.fn().mockResolvedValue('duplicate'),
    findOtherFormatBatch: vi.fn().mockResolvedValue([]),
    insertScanKeys: vi.fn().mockResolvedValue(undefined),
    analyzeScanKeys: vi.fn().mockResolvedValue(undefined),
    createOtherFormatPairs: vi.fn().mockResolvedValue(undefined),
    deleteSeriesConflictPairs: vi.fn().mockResolvedValue(0),
    createSameMediumWorkPairs: vi.fn().mockResolvedValue(0),
    deleteLinkedPairs: vi.fn().mockResolvedValue(0),
    findEditionCandidatePairs: vi.fn().mockResolvedValue([]),
    findEditionFacts: vi.fn().mockResolvedValue([]),
    applyEditionOutcomes: vi.fn().mockResolvedValue(undefined),
    finalizeOtherFormatGroups: vi.fn().mockResolvedValue(0),
    finalizeOtherEditionGroups: vi.fn().mockResolvedValue(0),
    insertDismissals: vi.fn().mockResolvedValue(undefined),
    deleteDismissal: vi.fn().mockResolvedValue(1),
    listDismissals: vi.fn().mockResolvedValue([]),
    deleteScanKeys: vi.fn().mockResolvedValue(undefined),
    findGroups: vi.fn().mockResolvedValue({ groups: [], total: 0 }),
    findPairs: vi.fn().mockResolvedValue([]),
    findCandidatePreviews: vi.fn().mockResolvedValue([]),
  };
  const libraryService = { findAccessibleLibraryIds: vi.fn().mockResolvedValue(accessibleLibraryIds) };
  const jobChanges = { notify: vi.fn() };
  return { service: new BookDuplicatesService(repo as never, libraryService as never, jobChanges as never), repo, libraryService, jobChanges };
}

describe('BookDuplicatesService', () => {
  it('creates a user-scoped scan and completes an empty library in the background', async () => {
    const { service, repo } = setup();

    const result = await service.createScan({ libraryId: 2, similarityPercent: 85 }, user);

    expect(result).toEqual(expect.objectContaining({ id: 11, requestedLibraryId: 2, similarityPercent: 85 }));
    expect(repo.createScanUnlessActive).toHaveBeenCalledWith({ userId: 7, libraryIds: [2], requestedLibraryId: 2, similarityPercent: 85 });
    await vi.waitFor(() => {
      expect(repo.updateScan).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'completed', totalGroups: 0, processedBooks: 0 }));
      expect(repo.deleteOlderScans).toHaveBeenCalledWith(7, 11);
    });
  });

  it('rejects an inaccessible selected library', async () => {
    const { service, repo } = setup([3]);

    await expect(service.createScan({ libraryId: 2, similarityPercent: 85 }, user)).rejects.toThrow(ForbiddenException);
    expect(repo.createScanUnlessActive).not.toHaveBeenCalled();
  });

  it('reports a conflict when an atomic scan creation finds another active scan', async () => {
    const { service, repo } = setup();
    repo.createScanUnlessActive.mockResolvedValue(null);

    await expect(service.createScan({ libraryId: 2, similarityPercent: 85 }, user)).rejects.toThrow(ConflictException);
    expect(repo.deleteOlderScans).not.toHaveBeenCalled();
  });

  it('returns the active scan for page reload recovery', async () => {
    const { service, repo } = setup();
    repo.findActiveForUser.mockResolvedValue(scanRow({ status: 'running', totalBooks: 20, processedBooks: 10 }));

    await expect(service.getActiveScan(user)).resolves.toEqual(expect.objectContaining({ id: 11, status: 'running', progressPercent: 50 }));
    expect(repo.findActiveForUser).toHaveBeenCalledWith(7);
  });

  it('returns null when the user has no active scan', async () => {
    const { service } = setup();

    await expect(service.getActiveScan(user)).resolves.toBeNull();
  });

  it('does not reveal scans owned by another user', async () => {
    const { service, repo } = setup();
    repo.findScan.mockResolvedValue(scanRow({ userId: 99 }));

    await expect(service.getScan(11, user)).rejects.toThrow(NotFoundException);
  });

  it('filters inaccessible pair endpoints from completed scan results', async () => {
    const { service, repo } = setup();
    repo.findScan.mockResolvedValue(scanRow({ status: 'completed', totalBooks: 3, processedBooks: 3, totalGroups: 1 }));
    repo.findGroups.mockResolvedValue({
      groups: [{ id: 5, kind: 'duplicate', reasons: ['isbn'], maxTitleSimilarity: null, memberCount: 2, memberBytesTotal: 900, memberBytesMax: 500 }],
      total: 1,
    });
    repo.findPairs.mockResolvedValue([
      { groupId: 5, bookIdA: 1, bookIdB: 2, reasons: ['isbn'], titleSimilarity: null },
      { groupId: 5, bookIdA: 1, bookIdB: 99, reasons: ['isbn'], titleSimilarity: null },
    ]);
    repo.findCandidatePreviews.mockResolvedValue(
      [1, 2].map((id) => ({
        group_id: 5,
        id,
        title: `Book ${id}`,
        subtitle: null,
        authors: [],
        library_id: 2,
        library_name: 'Library',
        folder_path: `book-${id}.epub`,
        status: 'present',
        files: [],
        isbn10: null,
        isbn13: null,
        metadata_score: null,
        read_status: null,
        reading_progress: null,
        collections: [],
        added_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: null,
        has_cover: false,
        book_per_file: false,
      })),
    );

    const result = await service.getGroups(11, { page: 1, pageSize: 20, sortBy: 'reclaimable', order: 'desc', kind: 'duplicate' }, user);

    expect(repo.findGroups).toHaveBeenCalledWith(11, 1, 20, [2], user, undefined, 'reclaimable', 'desc', 'duplicate');
    expect(result.groups[0]?.kind).toBe('duplicate');
    expect(result.groups[0]?.books[0]?.bookPerFile).toBe(false);
    expect(result.groups[0]?.pairs).toEqual([{ bookIdA: 1, bookIdB: 2, reasons: ['isbn'], titleSimilarity: null }]);
    expect(result.groups[0]?.reclaimableBytes).toBe(400);
  });

  it('dismisses every pair in a group so the judgement survives a rescan', async () => {
    const { service, repo } = setup();
    repo.findScan.mockResolvedValue(scanRow({ status: 'completed' }));
    repo.findGroupMemberIds.mockResolvedValue([9, 4, 7]);

    await service.dismissGroup({ scanId: 11, groupId: 5 }, user);

    expect(repo.insertDismissals).toHaveBeenCalledWith(7, 'duplicate', [
      { bookIdA: 4, bookIdB: 7 },
      { bookIdA: 4, bookIdB: 9 },
      { bookIdA: 7, bookIdB: 9 },
    ]);
  });

  it('refuses to dismiss a group that is not in the scan', async () => {
    const { service, repo } = setup();
    repo.findScan.mockResolvedValue(scanRow({ status: 'completed' }));
    repo.findGroupMemberIds.mockResolvedValue([9]);

    await expect(service.dismissGroup({ scanId: 11, groupId: 5 }, user)).rejects.toThrow(NotFoundException);
    expect(repo.insertDismissals).not.toHaveBeenCalled();
  });

  it('normalises pair order when a dismissal is restored', async () => {
    const { service, repo } = setup();

    await service.restoreDismissal(9, 4, user);

    expect(repo.deleteDismissal).toHaveBeenCalledWith(7, 'duplicate', 4, 9);
  });

  it('tells apart two dismissed books that share a title, naming only libraries the user can open', async () => {
    const { service, repo } = setup();
    const base = {
      kind: 'other_edition',
      titleA: 'Quiet Engines',
      titleB: 'quiet engines',
      editionNameA: null,
      editionNameB: null,
      publisherA: null,
      publisherB: null,
      publishedYearA: null,
      publishedYearB: null,
      libraryIdA: 2,
      libraryIdB: 2,
      libraryNameA: 'Novels',
      libraryNameB: 'Novels',
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
    };
    repo.listDismissals.mockResolvedValue([
      { ...base, bookIdA: 1, bookIdB: 2, publisherA: 'Orbit', publishedYearA: 2019, publishedYearB: 2024 },
      { ...base, bookIdA: 3, bookIdB: 4, libraryIdB: 99, libraryNameB: 'Hidden shelf' },
      { ...base, bookIdA: 5, bookIdB: 6, titleB: 'Loud Engines', publisherA: 'Orbit' },
    ]);

    const result = await service.listDismissals(user);

    expect(result.map(({ detailA, detailB }) => [detailA, detailB])).toEqual([
      ['Orbit · 2019', '2024'],
      [null, null],
      [null, null],
    ]);
  });

  it('keeps an other-format dismissal apart from a duplicate one', async () => {
    const { service, repo } = setup();
    repo.findScan.mockResolvedValue(scanRow({ status: 'completed' }));
    repo.findGroupKind.mockResolvedValue('other_format');
    repo.findGroupMemberIds.mockResolvedValue([8, 3]);

    await service.dismissGroup({ scanId: 11, groupId: 6 }, user);
    await service.restoreDismissal(8, 3, user, 'other_format');

    expect(repo.insertDismissals).toHaveBeenCalledWith(7, 'other_format', [{ bookIdA: 3, bookIdB: 8 }]);
    expect(repo.deleteDismissal).toHaveBeenCalledWith(7, 'other_format', 3, 8);
  });

  it('cleans partial artifacts when a background scan fails', async () => {
    const { service, repo, jobChanges } = setup();
    repo.countScopedBooks.mockResolvedValue(10);
    repo.insertFileHashKeys.mockRejectedValue(new Error('database unavailable'));

    await service.createScan({ libraryId: 2, similarityPercent: 85 }, user);

    await vi.waitFor(() => expect(repo.deleteScanArtifacts).toHaveBeenCalledWith(11));
    expect(repo.updateScan).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'failed', errorCode: 'scan_failed' }));
    await vi.waitFor(() => expect(jobChanges.notify).toHaveBeenLastCalledWith({ type: 'duplicate-scan', ownerId: 7, state: true }));
  });

  it('logs the PostgreSQL reason and SQLSTATE instead of the SQL Drizzle reports', async () => {
    const { service, repo } = setup();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      repo.countScopedBooks.mockResolvedValue(10);
      const timeout = Object.assign(new DatabaseError('canceling statement due to statement timeout', 0, 'error'), { code: '57014' });
      repo.createOtherFormatPairs.mockRejectedValue(new DrizzleQueryError('WITH matched AS (...)', [11, 11, 0.85], timeout));

      await service.createScan({ libraryId: 2, similarityPercent: 85 }, user);

      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate scan failed')));
      const message = String(warn.mock.calls.at(-1)?.[0]);
      expect(message).toContain('postgresCode=57014');
      expect(message).toContain('error="canceling statement due to statement timeout"');
      expect(message).not.toContain('Failed query:');
      expect(repo.updateScan).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'failed', errorCode: 'scan_failed' }));
      expect(repo.deleteScanArtifacts).toHaveBeenCalledWith(11);
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    { case: 'a plain error', failure: new Error('database unavailable'), message: 'database unavailable' },
    {
      case: 'a Node system error under Drizzle',
      failure: new DrizzleQueryError('select 1', [], Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })),
      message: 'write EPIPE',
    },
    {
      case: 'a wrapped error that is not a failed query',
      failure: new Error('stage failed', { cause: Object.assign(new Error('inner'), { code: '57014' }) }),
      message: 'stage failed',
    },
    { case: 'a non-Error rejection', failure: 'plain failure', message: 'plain failure' },
  ])('logs no SQLSTATE for $case', async ({ failure, message }) => {
    const { service, repo } = setup();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      repo.countScopedBooks.mockResolvedValue(10);
      repo.createOtherFormatPairs.mockRejectedValue(failure);

      await service.createScan({ libraryId: 2, similarityPercent: 85 }, user);

      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate scan failed')));
      const logged = String(warn.mock.calls.at(-1)?.[0]);
      expect(logged).toContain('postgresCode=none');
      expect(logged).toContain(`error="${message}"`);
      expect(repo.updateScan).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'failed', errorCode: 'scan_failed' }));
      expect(repo.deleteScanArtifacts).toHaveBeenCalledWith(11);
    } finally {
      warn.mockRestore();
    }
  });

  it('scans all accessible libraries when no library is selected', async () => {
    const { service, repo } = setup([2, 3]);
    repo.countScopedBooks.mockResolvedValue(2);
    repo.findScan.mockResolvedValue(scanRow({ libraryIds: [2, 3], requestedLibraryId: null }));
    repo.createScanUnlessActive.mockResolvedValue(scanRow({ libraryIds: [2, 3], requestedLibraryId: null }));

    await service.createScan({ similarityPercent: 85 }, user);

    await vi.waitFor(() => expect(repo.updateScan).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'completed' })));
    expect(repo.createScanUnlessActive).toHaveBeenCalledWith({
      userId: 7,
      libraryIds: [2, 3],
      requestedLibraryId: null,
      similarityPercent: 85,
    });
    expect(repo.insertFileHashKeys).toHaveBeenCalledWith(11, [2, 3], user);
    expect(repo.findIsbnBatch).toHaveBeenCalledWith([2, 3], user, 0, 500);
    expect(repo.findOtherFormatBatch).toHaveBeenCalledWith([2, 3], user, 0, 500);
    expect(repo.createOtherFormatPairs).toHaveBeenCalledWith(11, 85);
  });

  it('analyzes populated cross-format keys before running the indexed matching query', async () => {
    const { service, repo } = setup();
    repo.countScopedBooks.mockResolvedValue(2);
    repo.findOtherFormatBatch
      .mockResolvedValueOnce([
        {
          id: 4,
          title: 'Dune',
          hardcover_id: '123',
          open_library_id: null,
          series_id: null,
          series_index: null,
          formats: ['epub'],
          authors: ['Frank Herbert'],
          narrators: [],
        },
      ])
      .mockResolvedValueOnce([]);

    await service.createScan({ libraryId: 2, similarityPercent: 85 }, user);

    await vi.waitFor(() => expect(repo.updateScan).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'completed' })));
    expect(repo.insertScanKeys).toHaveBeenCalledTimes(1);
    expect(repo.analyzeScanKeys).toHaveBeenCalledTimes(1);
    expect(repo.insertScanKeys.mock.invocationCallOrder[0]).toBeLessThan(repo.analyzeScanKeys.mock.invocationCallOrder[0]!);
    expect(repo.analyzeScanKeys.mock.invocationCallOrder[0]).toBeLessThan(repo.createOtherFormatPairs.mock.invocationCallOrder[0]!);
  });

  it('still matches and completes the scan when refreshing statistics fails', async () => {
    const { service, repo } = setup();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      repo.countScopedBooks.mockResolvedValue(2);
      const lockTimeout = Object.assign(new DatabaseError('canceling statement due to lock timeout', 0, 'error'), { code: '55P03' });
      repo.analyzeScanKeys.mockRejectedValue(new DrizzleQueryError('ANALYZE "book_duplicate_scan_keys"', [], lockTimeout));

      await service.createScan({ libraryId: 2, similarityPercent: 85 }, user);

      await vi.waitFor(() => expect(repo.updateScan).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'completed' })));
      expect(repo.createOtherFormatPairs).toHaveBeenCalledWith(11, 85);
      expect(repo.deleteScanArtifacts).not.toHaveBeenCalled();
      const logged = String(warn.mock.calls.find(([line]) => String(line).includes('[book_duplicates.scan_keys_analyze] [fail]'))?.[0]);
      expect(logged).toContain('postgresCode=55P03');
      expect(logged).toContain('error="canceling statement due to lock timeout"');
    } finally {
      warn.mockRestore();
    }
  });

  it('runs every bounded scan stage and completes a non-empty library', async () => {
    const { service, repo, jobChanges } = setup();
    repo.countScopedBooks.mockResolvedValue(2);
    repo.findIsbnBatch.mockResolvedValueOnce([{ id: 3, isbn10: '0306406152', isbn13: null, formats: ['epub', 'EPUB'] }]).mockResolvedValueOnce([]);
    repo.finalizeGroups.mockResolvedValue(1);

    await service.createScan({ libraryId: 2, similarityPercent: 85 }, user);

    await vi.waitFor(() => expect(repo.updateScan).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'completed', totalGroups: 1 })));
    expect(repo.insertIsbnKeys).toHaveBeenCalledWith([{ scanId: 11, bookId: 3, value: '9780306406157|ebook' }]);
    expect(repo.insertExactMetadataKeys).toHaveBeenCalledWith(11, [2], user);
    expect(repo.createExactPairs).toHaveBeenCalledWith(11);
    expect(repo.createFuzzyPairs).toHaveBeenCalledWith(11, [2], user, 85);
    expect(repo.createOtherFormatPairs).toHaveBeenCalledWith(11, 85);
    expect(repo.deleteSeriesConflictPairs).toHaveBeenCalledWith(11);
    expect(repo.deleteSeriesConflictPairs.mock.invocationCallOrder[0]).toBeLessThan(repo.finalizeGroups.mock.invocationCallOrder[0]!);
    expect(repo.finalizeOtherFormatGroups).toHaveBeenCalledWith(11);
    expect(repo.deleteDismissedPairs).toHaveBeenCalledWith(11, 7);
    expect(repo.updateScan).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'completed', totalExtraCopies: 0, totalReclaimableBytes: 0 }));
    expect(repo.deleteScanKeys).toHaveBeenCalledWith(11);
    // The Jobs area hears the request, the start, every stage as progress only, and the end.
    await vi.waitFor(() => expect(jobChanges.notify).toHaveBeenLastCalledWith({ type: 'duplicate-scan', ownerId: 7, state: true }));
    const calls = jobChanges.notify.mock.calls.map(([change]) => (change as { state: boolean }).state);
    expect(calls.slice(0, 2)).toEqual([true, true]);
    expect(calls.filter((state) => !state)).toHaveLength(7);
  });

  it('splits other editions out of duplicates in batches before dismissals and grouping', async () => {
    const { service, repo } = setup();
    repo.countScopedBooks.mockResolvedValue(6);
    const facts = (id: number, overrides: Record<string, unknown> = {}) => ({
      id,
      isbn10: null,
      isbn13: null,
      hardcover_id: null,
      hardcover_edition_id: null,
      open_library_id: null,
      publisher: null,
      published_year: null,
      formats: ['m4b'],
      narrators: [],
      ...overrides,
    });
    repo.findEditionCandidatePairs
      .mockResolvedValueOnce([
        { book_id_a: 1, book_id_b: 2, kind: 'duplicate', reasons: ['exact_metadata'] },
        { book_id_a: 3, book_id_b: 4, kind: 'duplicate', reasons: ['fuzzy_metadata'] },
      ])
      .mockResolvedValueOnce([{ book_id_a: 5, book_id_b: 6, kind: 'other_edition', reasons: ['same_work'] }])
      .mockResolvedValueOnce([]);
    repo.findEditionFacts
      .mockResolvedValueOnce([
        facts(1, { narrators: ['Rob Inglis'], hardcover_id: 'hc-1' }),
        facts(2, { narrators: ['Andy Serkis'], hardcover_id: 'HC-1' }),
        facts(3, { narrators: ['Kate Reading'] }),
        facts(4, { narrators: ['Kate Reading'] }),
      ])
      .mockResolvedValueOnce([facts(5, { formats: ['epub'] }), facts(6, { formats: ['epub'] })]);
    repo.finalizeOtherEditionGroups.mockResolvedValue(1);

    await service.createScan({ libraryId: 2, similarityPercent: 85 }, user);

    await vi.waitFor(() =>
      expect(repo.updateScan).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'completed', totalOtherEditionPairs: 1 })),
    );
    expect(repo.findEditionCandidatePairs).toHaveBeenNthCalledWith(1, 11, null, 500);
    expect(repo.findEditionCandidatePairs).toHaveBeenNthCalledWith(2, 11, { bookIdA: 3, bookIdB: 4 }, 500);
    expect(repo.findEditionFacts).toHaveBeenNthCalledWith(1, [1, 2, 3, 4]);
    expect(repo.applyEditionOutcomes).toHaveBeenNthCalledWith(1, 11, [{ bookIdA: 1, bookIdB: 2, sameWork: true }], []);
    expect(repo.applyEditionOutcomes).toHaveBeenNthCalledWith(2, 11, [], [{ bookIdA: 5, bookIdB: 6 }]);
    const order = (mock: { mock: { invocationCallOrder: number[] } }) => mock.mock.invocationCallOrder[0]!;
    expect(order(repo.createSameMediumWorkPairs)).toBeLessThan(order(repo.deleteSeriesConflictPairs));
    expect(order(repo.deleteLinkedPairs)).toBeLessThan(order(repo.findEditionCandidatePairs));
    expect(order(repo.applyEditionOutcomes)).toBeLessThan(order(repo.deleteDismissedPairs));
    expect(order(repo.deleteDismissedPairs)).toBeLessThan(order(repo.finalizeOtherEditionGroups));
  });

  it('rejects completed results when the saved library scope is no longer accessible', async () => {
    const { service, repo } = setup([3]);
    repo.findScan.mockResolvedValue(scanRow({ status: 'completed' }));

    await expect(service.getGroups(11, { page: 1, pageSize: 20, sortBy: 'reclaimable', order: 'desc' }, user)).rejects.toThrow(ForbiddenException);
    expect(repo.findGroups).not.toHaveBeenCalled();
  });
});

describe('otherFormatKeys', () => {
  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: 4,
      title: 'The Hobbit',
      hardcover_id: null,
      open_library_id: null,
      series_id: null,
      series_index: null,
      formats: ['epub'],
      authors: ['J.R.R. Tolkien'],
      narrators: [],
      ...overrides,
    };
  }
  const values = (keys: ReturnType<typeof otherFormatKeys>, kind: string) => keys.filter((key) => key.kind === kind).map((key) => key.value);

  it('gives an ebook and its audiobook the same title key on opposite sides', () => {
    const ebook = otherFormatKeys(11, row());
    const audio = otherFormatKeys(11, row({ id: 5, title: 'The Hobbit (Unabridged)', formats: ['m4b'], authors: [], narrators: ['JRR Tolkien'] }));

    const ebookTitle = values(ebook, 'of_title');
    const audioTitle = values(audio, 'of_title');
    expect(ebookTitle[0]?.startsWith('e|')).toBe(true);
    expect(audioTitle[0]?.startsWith('a|')).toBe(true);
    expect(ebookTitle.map((value) => value.slice(2))).toEqual(audioTitle.map((value) => value.slice(2)));
  });

  it('keys work-level provider ids only', () => {
    const keys = otherFormatKeys(11, row({ hardcover_id: ' 123 ', open_library_id: 'OL1W' }));
    const other = otherFormatKeys(11, row({ id: 5, formats: ['mp3'], hardcover_id: '123', open_library_id: 'ol1w' }));

    expect(values(keys, 'of_work')).toHaveLength(2);
    expect(values(keys, 'of_work').map((value) => value.slice(2))).toEqual(values(other, 'of_work').map((value) => value.slice(2)));
  });

  it('keys a series position in its canonical spelling', () => {
    expect(values(otherFormatKeys(11, row({ series_id: 9, series_index: '01' })), 'of_series')).toEqual(['e|9|1']);
    expect(values(otherFormatKeys(11, row({ series_id: 9, series_index: '1.0', formats: ['m4b'] })), 'of_series')).toEqual(['a|9|1']);
  });

  it('skips books that hold both media or neither', () => {
    expect(otherFormatKeys(11, row({ formats: ['epub', 'm4b'] }))).toEqual([]);
    expect(otherFormatKeys(11, row({ formats: ['cbz'] }))).toEqual([]);
    expect(otherFormatKeys(11, row({ formats: [] }))).toEqual([]);
  });

  it('has no title key without a person to match', () => {
    expect(values(otherFormatKeys(11, row({ authors: [], narrators: [] })), 'of_title')).toEqual([]);
  });
});
