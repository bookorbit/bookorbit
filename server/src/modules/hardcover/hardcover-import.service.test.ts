import { BadRequestException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HardcoverImportService } from './hardcover-import.service';

const mockRepo = {
  findImportCandidateBooks: vi.fn(),
  findBookStatesByBookIds: vi.fn(),
  upsertBookState: vi.fn(),
  upsertImportProgress: vi.fn(),
};

const mockClient = {
  query: vi.fn(),
};

const mockSettingsService = {
  getTokenForUser: vi.fn(),
};

const mockLibraryService = {
  findAccessibleLibraryIds: vi.fn(),
};

const mockUserBookStatusService = {
  updateManual: vi.fn(),
};

const user = {
  id: 7,
  isSuperuser: false,
  contentFilters: { includeTagIds: [], excludeTagIds: [], includeGenreIds: [], excludeGenreIds: [] },
};

function makeService() {
  return new HardcoverImportService(
    mockRepo as never,
    mockClient as never,
    mockSettingsService as never,
    mockLibraryService as never,
    mockUserBookStatusService as never,
  );
}

function hardcoverBook(overrides: Record<string, unknown> = {}) {
  return {
    id: 1000,
    book_id: 10,
    edition_id: 20,
    status_id: 3,
    first_started_reading_date: '2024-01-01',
    last_read_date: '2024-01-10',
    user_book_status: { status: 'Read' },
    book: {
      id: 10,
      title: 'Dune',
      slug: 'dune',
      cached_contributors: [{ author: { name: 'Frank Herbert' } }],
    },
    edition: {
      id: 20,
      isbn_13: '9780441172719',
      isbn_10: '0441172717',
      pages: 688,
      audio_seconds: null,
    },
    user_book_reads: [{ id: 501, started_at: '2024-01-02', finished_at: '2024-01-11', progress: 64, progress_pages: 440, progress_seconds: null }],
    ...overrides,
  };
}

function localBook(overrides: Record<string, unknown> = {}) {
  return {
    bookId: 42,
    primaryFileId: 500,
    primaryFileFormat: 'epub',
    title: 'Dune',
    isbn13: '9780441172719',
    isbn10: null,
    hardcoverMetadataId: null,
    authors: ['Frank Herbert'],
    status: null,
    startedAt: null,
    finishedAt: null,
    progress: null,
    ...overrides,
  };
}

describe('HardcoverImportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    mockSettingsService.getTokenForUser.mockResolvedValue('tok');
    mockLibraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
    mockRepo.findImportCandidateBooks.mockResolvedValue([localBook()]);
    mockRepo.findBookStatesByBookIds.mockResolvedValue([]);
    mockRepo.upsertBookState.mockResolvedValue({});
    mockRepo.upsertImportProgress.mockResolvedValue(true);
    mockUserBookStatusService.updateManual.mockResolvedValue({});
    mockClient.query.mockResolvedValue({ me: [{ user_books: [hardcoverBook()] }] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a preview row for an ISBN match with status and dates', async () => {
    const preview = await makeService().previewImport(user as never);

    expect(preview.summary).toEqual({
      totalHardcoverBooks: 1,
      matchedBooks: 1,
      willUpdate: 1,
      needsReview: 0,
      conflicts: 0,
      unmatched: 0,
      skipped: 0,
      progressWillUpdate: 1,
      progressConflicts: 0,
      progressSkipped: 0,
    });
    expect(preview.rows[0]).toMatchObject({
      hardcoverBookId: 10,
      hardcoverEditionId: 20,
      hardcoverReadId: 501,
      importedStatus: 'read',
      importedStartedAt: '2024-01-02',
      importedFinishedAt: '2024-01-11',
      importedProgressPercent: 100,
      localBookId: 42,
      localPrimaryFileId: 500,
      localProgressPercent: null,
      matchMethod: 'isbn',
      confidence: 100,
      outcome: 'will_update',
      progressOutcome: 'will_update',
      progressReason: 'Ready to import progress',
    });
    expect(mockRepo.findImportCandidateBooks).toHaveBeenCalledWith(7, [1], user.contentFilters);
  });

  it('marks existing non-unread local statuses as conflicts', async () => {
    mockRepo.findImportCandidateBooks.mockResolvedValue([localBook({ status: 'reading' })]);

    const preview = await makeService().previewImport(user as never);

    expect(preview.summary.conflicts).toBe(1);
    expect(preview.rows[0]).toMatchObject({
      localReadStatus: 'reading',
      outcome: 'conflict',
      reason: 'BookOrbit already has a read status',
    });
  });

  it('uses superuser access without content filters', async () => {
    await makeService().previewImport({ ...user, isSuperuser: true } as never);

    expect(mockRepo.findImportCandidateBooks).toHaveBeenCalledWith(7, [1], undefined);
  });

  it('returns an empty preview when Hardcover returns no user book page', async () => {
    mockClient.query.mockResolvedValue({});
    mockRepo.findImportCandidateBooks.mockResolvedValue([]);

    const preview = await makeService().previewImport(user as never);

    expect(preview.rows).toEqual([]);
    expect(preview.summary.totalHardcoverBooks).toBe(0);
  });

  it('fetches all Hardcover pages until the page is shorter than the import page size', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      hardcoverBook({
        id: 2000 + index,
        book_id: 2000 + index,
        edition_id: 3000 + index,
        book: { id: 2000 + index, title: `Book ${index}`, slug: null, cached_contributors: [] },
        edition: { id: 3000 + index, isbn_13: null, isbn_10: null, pages: null, audio_seconds: null },
      }),
    );
    mockClient.query
      .mockResolvedValueOnce({ me: [{ user_books: firstPage }] })
      .mockResolvedValueOnce({ me: [{ user_books: [hardcoverBook({ id: 3000, book_id: 3000 })] }] });
    mockRepo.findImportCandidateBooks.mockResolvedValue([]);

    const preview = await makeService().previewImport(user as never);

    expect(preview.summary.totalHardcoverBooks).toBe(101);
    expect(mockClient.query).toHaveBeenNthCalledWith(1, 7, 'tok', expect.any(String), { limit: 100, offset: 0 });
    expect(mockClient.query).toHaveBeenNthCalledWith(2, 7, 'tok', expect.any(String), { limit: 100, offset: 100 });
  });

  it('skips Hardcover ignored status', async () => {
    mockClient.query.mockResolvedValue({ me: [{ user_books: [hardcoverBook({ status_id: 6, user_book_status: { status: 'Ignored' } })] }] });

    const preview = await makeService().previewImport(user as never);

    expect(preview.summary.skipped).toBe(1);
    expect(preview.rows[0]).toMatchObject({
      importedStatus: null,
      outcome: 'skipped',
      reason: 'Hardcover status is not imported',
    });
  });

  it('marks strict title and author matches for review when no identifier is available', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              edition: { id: 20, isbn_13: null, isbn_10: null },
            }),
          ],
        },
      ],
    });
    mockRepo.findImportCandidateBooks.mockResolvedValue([localBook({ isbn13: null, isbn10: null })]);

    const preview = await makeService().previewImport(user as never);

    expect(preview.rows[0]).toMatchObject({
      matchMethod: 'title_author',
      outcome: 'needs_review',
      reason: 'Review title and author match before import',
    });
    expect(preview.summary.needsReview).toBe(1);
    expect(preview.rows[0]!.confidence).toBeGreaterThanOrEqual(86);
  });

  it('marks reordered title and author token matches for review', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              book: {
                id: 10,
                title: 'Dune Messiah',
                slug: null,
                cached_contributors: [{ author: { name: 'Herbert Frank' } }],
              },
              edition: { id: 20, isbn_13: null, isbn_10: null, pages: 352, audio_seconds: null },
            }),
          ],
        },
      ],
    });
    mockRepo.findImportCandidateBooks.mockResolvedValue([
      localBook({
        isbn13: null,
        isbn10: null,
        title: 'Messiah Dune',
        authors: ['Frank Herbert'],
      }),
    ]);

    const preview = await makeService().previewImport(user as never);

    expect(preview.rows[0]).toMatchObject({
      matchMethod: 'title_author',
      outcome: 'needs_review',
    });
    expect(preview.rows[0]!.confidence).toBeGreaterThanOrEqual(86);
  });

  it('marks small edit-distance title and author matches for review', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              book: {
                id: 10,
                title: 'Dune Messiah',
                slug: null,
                cached_contributors: [{ name: 'Frank Herbert' }],
              },
              edition: { id: 20, isbn_13: null, isbn_10: null, pages: 352, audio_seconds: null },
            }),
          ],
        },
      ],
    });
    mockRepo.findImportCandidateBooks.mockResolvedValue([
      localBook({
        isbn13: null,
        isbn10: null,
        title: 'Dune Mesiah',
        authors: ['Frank Herbrt'],
      }),
    ]);

    const preview = await makeService().previewImport(user as never);

    expect(preview.rows[0]).toMatchObject({
      matchMethod: 'title_author',
      outcome: 'needs_review',
    });
    expect(preview.rows[0]!.confidence).toBeGreaterThanOrEqual(86);
  });

  it('matches by stored Hardcover slug when ISBNs are unavailable', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              edition: { id: 20, isbn_13: null, isbn_10: null, pages: 688, audio_seconds: null },
            }),
          ],
        },
      ],
    });
    mockRepo.findImportCandidateBooks.mockResolvedValue([localBook({ isbn13: null, isbn10: null, hardcoverMetadataId: 'dune' })]);

    const preview = await makeService().previewImport(user as never);

    expect(preview.rows[0]).toMatchObject({
      matchMethod: 'hardcover_id',
      confidence: 100,
      outcome: 'will_update',
    });
  });

  it('skips ambiguous cached Hardcover ID matches', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              book: {
                id: 10,
                title: 'Unknown',
                slug: null,
                cached_contributors: [],
              },
              edition: { id: 20, isbn_13: null, isbn_10: null, pages: null, audio_seconds: null },
            }),
          ],
        },
      ],
    });
    mockRepo.findImportCandidateBooks.mockResolvedValue([
      localBook({ bookId: 42, isbn13: null, isbn10: null, title: 'One', authors: ['A'] }),
      localBook({ bookId: 43, isbn13: null, isbn10: null, title: 'Two', authors: ['B'] }),
    ]);
    mockRepo.findBookStatesByBookIds.mockResolvedValue([
      { bookId: 42, hardcoverBookId: 10, matchError: null },
      { bookId: 43, hardcoverBookId: 10, matchError: null },
    ]);

    const preview = await makeService().previewImport(user as never);

    expect(preview.rows[0]).toMatchObject({
      localBookId: null,
      outcome: 'skipped',
      reason: 'Multiple BookOrbit books match this Hardcover ID',
    });
  });

  it('skips ambiguous cached Hardcover slug matches', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              edition: { id: 20, isbn_13: null, isbn_10: null, pages: null, audio_seconds: null },
            }),
          ],
        },
      ],
    });
    mockRepo.findImportCandidateBooks.mockResolvedValue([
      localBook({ bookId: 42, isbn13: null, isbn10: null, hardcoverMetadataId: 'dune' }),
      localBook({ bookId: 43, isbn13: null, isbn10: null, hardcoverMetadataId: 'DUNE' }),
    ]);

    const preview = await makeService().previewImport(user as never);

    expect(preview.rows[0]).toMatchObject({
      localBookId: null,
      outcome: 'skipped',
      reason: 'Multiple BookOrbit books match this Hardcover slug',
    });
  });

  it('skips ambiguous ISBN matches', async () => {
    mockRepo.findImportCandidateBooks.mockResolvedValue([localBook({ bookId: 42 }), localBook({ bookId: 43 })]);

    const preview = await makeService().previewImport(user as never);

    expect(preview.summary.skipped).toBe(1);
    expect(preview.rows[0]).toMatchObject({
      localBookId: null,
      outcome: 'skipped',
      reason: 'Multiple BookOrbit books match this ISBN',
    });
  });

  it('falls back to title matching when identifiers do not match', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              edition: { id: 20, isbn_13: '9780000000002', isbn_10: null, pages: null, audio_seconds: null },
            }),
          ],
        },
      ],
    });
    mockRepo.findImportCandidateBooks.mockResolvedValue([localBook({ isbn13: '9780000000001', isbn10: null })]);

    const preview = await makeService().previewImport(user as never);

    expect(preview.rows[0]).toMatchObject({
      matchMethod: 'title_author',
      outcome: 'needs_review',
    });
  });

  it('skips fuzzy title matches when candidates tie within the confidence margin', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              edition: { id: 20, isbn_13: null, isbn_10: null, pages: null, audio_seconds: null },
            }),
          ],
        },
      ],
    });
    mockRepo.findImportCandidateBooks.mockResolvedValue([
      localBook({ bookId: 42, isbn13: null, isbn10: null, title: 'Dune', authors: ['Frank Herbert'] }),
      localBook({ bookId: 43, isbn13: null, isbn10: null, title: 'Dune', authors: ['Frank Herbert'] }),
    ]);

    const preview = await makeService().previewImport(user as never);

    expect(preview.rows[0]).toMatchObject({
      localBookId: null,
      outcome: 'unmatched',
      reason: 'No matching BookOrbit book found',
    });
  });

  it('does not fuzzy match rows without a title or authors', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              book: { id: 10, title: null, slug: null, cached_contributors: [] },
              edition: { id: 20, isbn_13: null, isbn_10: null, pages: null, audio_seconds: null },
            }),
          ],
        },
      ],
    });
    mockRepo.findImportCandidateBooks.mockResolvedValue([localBook({ isbn13: null, isbn10: null })]);

    const preview = await makeService().previewImport(user as never);

    expect(preview.rows[0]).toMatchObject({
      hardcoverTitle: null,
      outcome: 'unmatched',
    });
  });

  it('applies only will_update rows and caches Hardcover state', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [hardcoverBook(), hardcoverBook({ id: 1001, book_id: 11, edition_id: 21, status_id: 2, last_read_date: null })],
        },
      ],
    });
    mockRepo.findImportCandidateBooks.mockResolvedValue([
      localBook(),
      localBook({ bookId: 43, isbn13: null, hardcoverMetadataId: '11', status: 'reading' }),
    ]);

    const result = await makeService().applyImport(user as never);

    expect(result.applied).toBe(1);
    expect(result.progressApplied).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.conflicts).toBe(1);
    expect(mockUserBookStatusService.updateManual).toHaveBeenCalledTimes(1);
    expect(mockUserBookStatusService.updateManual).toHaveBeenCalledWith(7, 42, {
      status: 'read',
      startedAt: new Date('2024-01-02T00:00:00.000Z'),
      finishedAt: new Date('2024-01-11T00:00:00.000Z'),
    });
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        bookId: 42,
        hardcoverBookId: 10,
        hardcoverEditionId: 20,
        hardcoverUserBookId: 1000,
        hardcoverReadId: 501,
        matchMethod: 'isbn',
        lastSyncedStatus: 'read',
        lastSyncedProgress: null,
      }),
    );
    expect(mockRepo.upsertImportProgress).not.toHaveBeenCalled();
  });

  it('imports a want-to-read row that still carries a start date', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              status_id: 1,
              user_book_status: { status: 'Want to Read' },
              last_read_date: null,
              user_book_reads: [{ id: 504, started_at: '2024-01-02', finished_at: null, progress: 0, progress_pages: null, progress_seconds: null }],
            }),
          ],
        },
      ],
    });

    const result = await makeService().applyImport(user as never);

    expect(result.applied).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockUserBookStatusService.updateManual).toHaveBeenCalledWith(7, 42, { status: 'want_to_read' });
  });

  it('imports Hardcover progress when requested and local progress is blank', async () => {
    const result = await makeService().applyImport(user as never, { hardcoverUserBookIds: [1000], importProgress: true });

    expect(result.applied).toBe(1);
    expect(result.progressApplied).toBe(1);
    expect(mockRepo.upsertImportProgress).toHaveBeenCalledWith(7, 500, 100);
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSyncedProgress: 100,
      }),
    );
  });

  it('does not mark progress synced when the conditional progress write is skipped', async () => {
    mockRepo.upsertImportProgress.mockResolvedValue(false);

    const result = await makeService().applyImport(user as never, { hardcoverUserBookIds: [1000], importProgress: true });

    expect(result.applied).toBe(1);
    expect(result.progressApplied).toBe(0);
    expect(mockRepo.upsertImportProgress).toHaveBeenCalledWith(7, 500, 100);
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSyncedProgress: null,
      }),
    );
  });

  it('keeps status import successful when progress import fails', async () => {
    mockRepo.upsertImportProgress.mockRejectedValue(new Error('progress unavailable'));

    const result = await makeService().applyImport(user as never, { hardcoverUserBookIds: [1000], importProgress: true });

    expect(result.applied).toBe(1);
    expect(result.progressApplied).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSyncedStatus: 'read',
        lastSyncedProgress: null,
      }),
    );
  });

  it('does not overwrite existing local reading progress', async () => {
    mockRepo.findImportCandidateBooks.mockResolvedValue([localBook({ progress: 33 })]);

    const result = await makeService().applyImport(user as never, { hardcoverUserBookIds: [1000], importProgress: true });

    expect(result.applied).toBe(1);
    expect(result.progressApplied).toBe(0);
    expect(result.progressConflicts).toBe(1);
    expect(mockRepo.upsertImportProgress).not.toHaveBeenCalled();
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSyncedProgress: null,
      }),
    );
  });

  it('skips progress import when the local book has no primary file', async () => {
    mockRepo.findImportCandidateBooks.mockResolvedValue([localBook({ primaryFileId: null })]);

    const result = await makeService().applyImport(user as never, { hardcoverUserBookIds: [1000], importProgress: true });

    expect(result.applied).toBe(1);
    expect(result.progressApplied).toBe(0);
    expect(result.progressSkipped).toBe(1);
    expect(mockRepo.upsertImportProgress).not.toHaveBeenCalled();
  });

  it('records row failures without aborting the entire apply import', async () => {
    mockUserBookStatusService.updateManual.mockRejectedValue('status rejected');

    const result = await makeService().applyImport(user as never);

    expect(result.applied).toBe(0);
    expect(result.failed).toBe(1);
    expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
  });

  it('derives in-progress percentages from Hardcover page progress', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              status_id: 2,
              last_read_date: null,
              user_book_status: { status: 'Currently Reading' },
              user_book_reads: [{ id: 502, started_at: '2024-01-02', finished_at: null, progress: null, progress_pages: 69, progress_seconds: null }],
              edition: {
                id: 20,
                isbn_13: '9780441172719',
                isbn_10: '0441172717',
                pages: 283,
                audio_seconds: null,
              },
            }),
          ],
        },
      ],
    });

    const preview = await makeService().previewImport(user as never);

    expect(preview.rows[0]).toMatchObject({
      importedStatus: 'reading',
      importedProgressPercent: 24.4,
      progressOutcome: 'will_update',
    });
  });

  it('uses direct Hardcover in-progress percentage before page or audio fallbacks', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              status_id: 2,
              last_read_date: null,
              user_book_status: { status: 'Currently Reading' },
              user_book_reads: [
                { id: 502, started_at: '2024-01-02', finished_at: null, progress: 37.25, progress_pages: 69, progress_seconds: 1800 },
              ],
              edition: {
                id: 20,
                isbn_13: '9780441172719',
                isbn_10: '0441172717',
                pages: 283,
                audio_seconds: 3600,
              },
            }),
          ],
        },
      ],
    });

    const preview = await makeService().previewImport(user as never);

    expect(preview.rows[0]).toMatchObject({
      importedStatus: 'reading',
      importedProgressPercent: 37.3,
    });
  });

  it('leaves in-progress percentage blank when Hardcover progress is zero or invalid', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              status_id: 2,
              last_read_date: null,
              user_book_status: { status: 'Currently Reading' },
              user_book_reads: [{ id: 502, started_at: '2024-01-02', finished_at: null, progress: 0, progress_pages: 0, progress_seconds: 0 }],
              edition: {
                id: 20,
                isbn_13: '9780441172719',
                isbn_10: '0441172717',
                pages: 283,
                audio_seconds: 3600,
              },
            }),
          ],
        },
      ],
    });

    const preview = await makeService().previewImport(user as never);

    expect(preview.rows[0]).toMatchObject({
      importedStatus: 'reading',
      importedProgressPercent: null,
      progressOutcome: 'skipped',
    });
  });

  it('derives in-progress percentages from Hardcover audio seconds but skips local audiobook progress writes', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              status_id: 2,
              last_read_date: null,
              user_book_status: { status: 'Currently Reading' },
              user_book_reads: [
                { id: 502, started_at: '2024-01-02', finished_at: null, progress: null, progress_pages: null, progress_seconds: 1800 },
              ],
              edition: {
                id: 20,
                isbn_13: '9780441172719',
                isbn_10: '0441172717',
                pages: null,
                audio_seconds: 3600,
              },
            }),
          ],
        },
      ],
    });
    mockRepo.findImportCandidateBooks.mockResolvedValue([localBook({ primaryFileFormat: 'mp3' })]);

    const preview = await makeService().previewImport(user as never);

    expect(preview.rows[0]).toMatchObject({
      importedStatus: 'reading',
      importedProgressPercent: 50,
      progressOutcome: 'skipped',
      progressReason: 'Audiobook progress import is not supported yet',
    });
  });

  it('does not import stray progress for want-to-read rows', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              status_id: 1,
              user_book_status: { status: 'Want to Read' },
              first_started_reading_date: null,
              last_read_date: null,
              user_book_reads: [{ id: 503, started_at: null, finished_at: null, progress: 12, progress_pages: 83, progress_seconds: null }],
            }),
          ],
        },
      ],
    });

    const preview = await makeService().previewImport(user as never);

    expect(preview.rows[0]).toMatchObject({
      importedStatus: 'want_to_read',
      importedProgressPercent: null,
      progressOutcome: 'skipped',
      progressReason: 'No Hardcover progress to import',
    });
  });

  it('parses Hardcover timestamp dates during apply', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              user_book_reads: [
                {
                  id: 501,
                  started_at: '2024-01-02T12:34:56.000Z',
                  finished_at: '2024-01-11T01:02:03.000Z',
                  progress: 100,
                  progress_pages: 688,
                  progress_seconds: null,
                },
              ],
            }),
          ],
        },
      ],
    });

    await makeService().applyImport(user as never);

    expect(mockUserBookStatusService.updateManual).toHaveBeenCalledWith(7, 42, {
      status: 'read',
      startedAt: new Date('2024-01-02T12:34:56.000Z'),
      finishedAt: new Date('2024-01-11T01:02:03.000Z'),
    });
  });

  it('falls back to Hardcover user book dates when no read entry has progress or date signals', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              user_book_reads: [{ id: 501, started_at: null, finished_at: null, progress: null, progress_pages: null, progress_seconds: null }],
            }),
          ],
        },
      ],
    });

    const preview = await makeService().previewImport(user as never);

    expect(preview.rows[0]).toMatchObject({
      hardcoverReadId: null,
      importedStartedAt: '2024-01-01',
      importedFinishedAt: '2024-01-10',
    });
  });

  it('passes null dates to status import when Hardcover date values are invalid', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              user_book_reads: [
                {
                  id: 501,
                  started_at: 'not-a-date',
                  finished_at: 'also-not-a-date',
                  progress: 100,
                  progress_pages: 688,
                  progress_seconds: null,
                },
              ],
            }),
          ],
        },
      ],
    });

    await makeService().applyImport(user as never);

    expect(mockUserBookStatusService.updateManual).toHaveBeenCalledWith(7, 42, {
      status: 'read',
      startedAt: null,
      finishedAt: null,
    });
  });

  it('applies selected needs_review rows', async () => {
    mockClient.query.mockResolvedValue({
      me: [
        {
          user_books: [
            hardcoverBook({
              edition: { id: 20, isbn_13: null, isbn_10: null },
            }),
          ],
        },
      ],
    });
    mockRepo.findImportCandidateBooks.mockResolvedValue([localBook({ isbn13: null, isbn10: null })]);

    const defaultResult = await makeService().applyImport(user as never);
    expect(defaultResult.applied).toBe(0);
    expect(defaultResult.needsReview).toBe(1);
    expect(mockUserBookStatusService.updateManual).not.toHaveBeenCalled();

    const selectedResult = await makeService().applyImport(user as never, { hardcoverUserBookIds: [1000] });
    expect(selectedResult.applied).toBe(1);
    expect(mockUserBookStatusService.updateManual).toHaveBeenCalledTimes(1);
  });

  it('rejects preview when Hardcover is unavailable', async () => {
    mockSettingsService.getTokenForUser.mockResolvedValue(null);

    await expect(makeService().previewImport(user as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it('wraps Hardcover API failures in a user-safe bad request', async () => {
    mockClient.query.mockRejectedValue('offline');

    await expect(makeService().previewImport(user as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('logs and rethrows unexpected preview failures', async () => {
    mockSettingsService.getTokenForUser.mockRejectedValue('settings unavailable');

    await expect(makeService().previewImport(user as never)).rejects.toBe('settings unavailable');
  });
});
