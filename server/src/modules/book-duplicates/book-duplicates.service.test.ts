import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { BookDuplicatesService } from './book-duplicates.service';

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
    deleteScanKeys: vi.fn().mockResolvedValue(undefined),
    findGroups: vi.fn().mockResolvedValue({ groups: [], total: 0 }),
    findPairs: vi.fn().mockResolvedValue([]),
    findCandidatePreviews: vi.fn().mockResolvedValue([]),
  };
  const libraryService = { findAccessibleLibraryIds: vi.fn().mockResolvedValue(accessibleLibraryIds) };
  return { service: new BookDuplicatesService(repo as never, libraryService as never), repo, libraryService };
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
      groups: [{ id: 5, reasons: ['isbn'], maxTitleSimilarity: null }],
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
      })),
    );

    const result = await service.getGroups(11, { page: 1, pageSize: 20 }, user);

    expect(repo.findGroups).toHaveBeenCalledWith(11, 1, 20, [2], user, undefined);
    expect(result.groups[0]?.pairs).toEqual([{ bookIdA: 1, bookIdB: 2, reasons: ['isbn'], titleSimilarity: null }]);
  });

  it('cleans partial artifacts when a background scan fails', async () => {
    const { service, repo } = setup();
    repo.countScopedBooks.mockResolvedValue(10);
    repo.insertFileHashKeys.mockRejectedValue(new Error('database unavailable'));

    await service.createScan({ libraryId: 2, similarityPercent: 85 }, user);

    await vi.waitFor(() => expect(repo.deleteScanArtifacts).toHaveBeenCalledWith(11));
    expect(repo.updateScan).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'failed', errorCode: 'scan_failed' }));
  });

  it('runs every bounded scan stage and completes a non-empty library', async () => {
    const { service, repo } = setup();
    repo.countScopedBooks.mockResolvedValue(2);
    repo.findIsbnBatch.mockResolvedValueOnce([{ id: 3, isbn10: '0306406152', isbn13: null, formats: ['epub', 'EPUB'] }]).mockResolvedValueOnce([]);
    repo.finalizeGroups.mockResolvedValue(1);

    await service.createScan({ libraryId: 2, similarityPercent: 85 }, user);

    await vi.waitFor(() => expect(repo.updateScan).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'completed', totalGroups: 1 })));
    expect(repo.insertIsbnKeys).toHaveBeenCalledWith([{ scanId: 11, bookId: 3, value: '9780306406157|ebook' }]);
    expect(repo.insertExactMetadataKeys).toHaveBeenCalledWith(11, [2], user);
    expect(repo.createExactPairs).toHaveBeenCalledWith(11);
    expect(repo.createFuzzyPairs).toHaveBeenCalledWith(11, [2], user, 85);
    expect(repo.deleteScanKeys).toHaveBeenCalledWith(11);
  });

  it('rejects completed results when the saved library scope is no longer accessible', async () => {
    const { service, repo } = setup([3]);
    repo.findScan.mockResolvedValue(scanRow({ status: 'completed' }));

    await expect(service.getGroups(11, { page: 1, pageSize: 20 }, user)).rejects.toThrow(ForbiddenException);
    expect(repo.findGroups).not.toHaveBeenCalled();
  });
});
