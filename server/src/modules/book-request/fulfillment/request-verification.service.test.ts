import { NotificationType, type BookDockMetadata } from '@bookorbit/types';

import type { BookRequestDownloadRow } from '../../../db/schema';
import { RequestVerificationService, verifyAgainstRequest } from './request-verification.service';

type RequestSnapshot = Parameters<typeof verifyAgainstRequest>[0];

function request(overrides: Partial<RequestSnapshot> = {}): RequestSnapshot {
  return { title: 'Dune', subtitle: null, authors: ['Frank Herbert'], isbn13: null, ...overrides } as RequestSnapshot;
}

function metadata(overrides: Partial<BookDockMetadata> = {}): BookDockMetadata {
  return { title: 'Dune', authors: ['Frank Herbert'], ...overrides } as BookDockMetadata;
}

describe('verifyAgainstRequest', () => {
  it('passes on an exact ISBN13 match without looking at anything else', () => {
    const outcome = verifyAgainstRequest(
      request({ title: 'Dune', isbn13: '978-0-441-01359-3' }),
      metadata({ title: 'Something Else Entirely', authors: ['Nobody'], isbn13: '9780441013593' }),
      null,
    );

    expect(outcome).toMatchObject({ passed: true, score: 100 });
  });

  it('falls through to title and author when the ISBNs differ, because editions differ', () => {
    const outcome = verifyAgainstRequest(request({ isbn13: '9780441013593' }), metadata({ isbn13: '9780340960196' }), null);
    expect(outcome.passed).toBe(true);
  });

  /**
   * The case the whole step exists for. The dock's own confidence score would be high here,
   * because the file and the provider agree with each other about Dune Messiah.
   */
  it('holds a sequel that merely extends the requested title', () => {
    const outcome = verifyAgainstRequest(request(), metadata({ title: 'Dune Messiah' }), null);

    expect(outcome.passed).toBe(false);
    expect(outcome.score).toBeLessThan(70);
  });

  it('passes an edition that adds a subtitle to the requested title', () => {
    const outcome = verifyAgainstRequest(
      request({ title: 'The Hobbit', authors: ['J. R. R. Tolkien'] }),
      metadata({ title: 'The Hobbit: Or There and Back Again', authors: ['J. R. R. Tolkien'] }),
      null,
    );

    expect(outcome.passed).toBe(true);
  });

  it('tolerates an author written surname-first', () => {
    const outcome = verifyAgainstRequest(request(), metadata({ authors: ['Herbert, Frank'] }), null);
    expect(outcome.passed).toBe(true);
  });

  it('holds a right-title wrong-author file however well the title scores', () => {
    const outcome = verifyAgainstRequest(
      request({ title: 'It', authors: ['Stephen King'] }),
      metadata({ title: 'It', authors: ['Alexa Chung'] }),
      null,
    );

    expect(outcome.passed).toBe(false);
    expect(outcome.reason).toContain('Alexa Chung');
  });

  it('holds an unrelated book', () => {
    const outcome = verifyAgainstRequest(request(), metadata({ title: 'Neuromancer', authors: ['William Gibson'] }), null);
    expect(outcome).toMatchObject({ passed: false, score: 0 });
  });

  it('falls back to embedded metadata when the provider fetch produced nothing', () => {
    const outcome = verifyAgainstRequest(request(), null, metadata());
    expect(outcome.passed).toBe(true);
  });

  it('holds a file with no readable title rather than guessing', () => {
    const outcome = verifyAgainstRequest(request(), metadata({ title: undefined }), null);
    expect(outcome).toMatchObject({ passed: false, score: 0 });
  });

  it('scores on title alone when the imported file names no author', () => {
    const outcome = verifyAgainstRequest(request(), metadata({ authors: [] }), null);
    expect(outcome).toMatchObject({ passed: true, score: 100 });
  });
});

/**
 * The right number depends on an instance's own trackers and metadata providers, so the operator
 * moves it. What must not move is the shape: one score, measured against whatever it was told.
 */
describe('verifyAgainstRequest with an operator-set threshold', () => {
  const sequel = (threshold?: number) => verifyAgainstRequest(request(), metadata({ title: 'Dune Messiah' }), null, threshold);

  it('files a file the default holds, once the operator lowers the bar to its score', () => {
    const held = sequel();
    expect(held.passed).toBe(false);

    expect(sequel(held.score).passed).toBe(true);
    expect(sequel(held.score + 1).passed).toBe(false);
  });

  it('holds a file the default files, once the operator raises the bar past it', () => {
    // An imported edition that abbreviates the author. Right book, imperfect agreement: exactly
    // the band an operator moves the threshold through.
    const initialled = (threshold?: number) => verifyAgainstRequest(request(), metadata({ authors: ['F. Herbert'] }), null, threshold);

    const filed = initialled();
    expect(filed.passed).toBe(true);
    expect(filed.score).toBeLessThan(100);

    const strict = initialled(filed.score + 1);
    expect(strict.passed).toBe(false);
    expect(strict.reason).toContain(`below the ${filed.score + 1}`);
  });
});

/**
 * The threshold is only worth having if the gate actually reads it, so this drives the whole
 * handler: one file, one score, two operator settings, two outcomes.
 */
describe('RequestVerificationService against the configured threshold', () => {
  function makeService(threshold: number, verificationEnabled = true, overrides: { requestSettled?: boolean } = {}) {
    const events = { on: vi.fn() };
    const dockRepo = {
      findById: vi.fn().mockResolvedValue({ id: 100, fetchedMetadata: metadata({ authors: ['F. Herbert'] }), embeddedMetadata: null }),
    };
    const dock = { discardFile: vi.fn().mockResolvedValue(undefined) };
    const finalizeService = { finalizeManagedFile: vi.fn().mockResolvedValue({ success: true, bookId: 55 }) };
    const downloads = {
      findByBookDockFileId: vi.fn().mockResolvedValue({ id: 11, requestId: 7, status: 'importing', bookDockFileId: 100 } as BookRequestDownloadRow),
      update: vi.fn().mockResolvedValue(undefined),
      updateIf: vi.fn().mockImplementation((id: number, _expected: unknown, patch: Record<string, unknown>) => Promise.resolve({ id, ...patch })),
    };
    const requests = {
      findById: vi.fn().mockResolvedValue({ request: { ...request(), id: 7, targetLibraryId: 2, targetFolderId: 3 } }),
      update: vi.fn().mockResolvedValue(undefined),
      updateIf: vi
        .fn()
        .mockImplementation((id: number, _expected: unknown, patch: Record<string, unknown>) =>
          Promise.resolve(overrides.requestSettled ? undefined : { id, ...patch }),
        ),
      findFirstFolderId: vi.fn().mockResolvedValue(3),
    };
    const fulfillment = { failDownload: vi.fn().mockResolvedValue(undefined), holdForReview: vi.fn().mockResolvedValue(undefined) };
    const notifier = {
      notifyApprovers: vi.fn().mockResolvedValue(undefined),
      notifyInterested: vi.fn().mockResolvedValue(undefined),
      notifyResponsible: vi.fn().mockResolvedValue(undefined),
      notifyBookAvailable: vi.fn().mockResolvedValue(undefined),
    };
    const gateway = { emitChanged: vi.fn() };
    const settings = { get: vi.fn().mockResolvedValue({ verificationEnabled, verificationThreshold: threshold }) };

    const service = new RequestVerificationService(
      events as never,
      dockRepo as never,
      dock as never,
      finalizeService as never,
      downloads as never,
      requests as never,
      fulfillment as never,
      notifier as never,
      gateway as never,
      settings as never,
    );

    service.onModuleInit();
    const listener = events.on.mock.calls[0][1] as (fileId: number) => void;
    const ingest = async () => {
      listener(100);
      await new Promise((resolve) => setImmediate(resolve));
    };

    return { ingest, finalizeService, downloads, requests, notifier, fulfillment };
  }

  it('files the book when its score clears the configured threshold', async () => {
    const { ingest, finalizeService, requests } = makeService(70);

    await ingest();

    expect(finalizeService.finalizeManagedFile).toHaveBeenCalledWith(100, { libraryId: 2, folderId: 3 });
    expect(requests.updateIf).toHaveBeenCalledWith(
      7,
      expect.arrayContaining(['importing']),
      expect.objectContaining({ status: 'available', matchedBookId: 55 }),
    );
  });

  /**
   * Scoring an import and handing it to the Book Dock takes long enough for somebody to cancel the
   * request underneath it. The two finalize writes used to be the only unconditional ones in the
   * pipeline, so a cancellation landing there was silently undone and the requester was told their
   * book had arrived.
   */
  it('leaves a request somebody settled while the import was being filed alone', async () => {
    const { ingest, requests, downloads, notifier } = makeService(50, true, { requestSettled: true });

    await ingest();

    expect(requests.updateIf).toHaveBeenCalledWith(7, expect.arrayContaining(['importing']), expect.objectContaining({ status: 'available' }));
    expect(requests.update).not.toHaveBeenCalled();
    // The bytes did become a book, so the attempt is settled rather than left for the resume sweep.
    expect(downloads.updateIf).toHaveBeenCalledWith(11, expect.anything(), expect.objectContaining({ status: 'imported' }));
    expect(notifier.notifyBookAvailable).not.toHaveBeenCalled();
  });

  it('holds the same book in the dock once the operator raises the threshold past it', async () => {
    const { ingest, finalizeService, fulfillment } = makeService(95);

    await ingest();

    expect(finalizeService.finalizeManagedFile).not.toHaveBeenCalled();
    expect(fulfillment.holdForReview).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 7 }), expect.stringContaining('scored'));
  });

  /**
   * Turning the check off is the operator saying they would rather have the book than the guard.
   * The threshold it would have failed stays stored and untouched, so switching back restores the
   * number they tuned rather than a default.
   */
  it('files a book that would have been held when checking is switched off', async () => {
    const { ingest, finalizeService, requests, fulfillment } = makeService(95, false);

    await ingest();

    expect(finalizeService.finalizeManagedFile).toHaveBeenCalledWith(100, { libraryId: 2, folderId: 3 });
    expect(requests.updateIf).toHaveBeenCalledWith(
      7,
      expect.arrayContaining(['importing']),
      expect.objectContaining({ status: 'available', matchedBookId: 55 }),
    );
    expect(fulfillment.holdForReview).not.toHaveBeenCalled();
  });
});

/**
 * The drawer renders these rows verbatim, so a shortfall has to be attributable: an approver
 * deciding whether to file a 65 anyway needs to see which field lost the points.
 */
describe('verifyAgainstRequest comparison rows', () => {
  const rowFor = (outcome: ReturnType<typeof verifyAgainstRequest>, field: string) => outcome.rows.find((row) => row.field === field)!;

  it('blames the title and clears the author when only the title drifted', () => {
    const outcome = verifyAgainstRequest(
      request({ title: 'Fablehaven', authors: ['Brandon Mull'] }),
      metadata({ title: 'Fablehaven, Book 1 (Unabridged)', authors: ['Brandon Mull'] }),
      null,
    );

    expect(outcome.passed).toBe(false);
    expect(outcome.code).toBe('below_threshold');
    expect(rowFor(outcome, 'title')).toMatchObject({
      requested: 'Fablehaven',
      imported: 'Fablehaven, Book 1 (Unabridged)',
      verdict: 'mismatch',
    });
    expect(rowFor(outcome, 'authors')).toMatchObject({ verdict: 'match' });
  });

  it('reports a field neither side carries as uncompared rather than as a mismatch', () => {
    const outcome = verifyAgainstRequest(request(), metadata(), null);
    expect(rowFor(outcome, 'isbn13')).toMatchObject({ requested: null, imported: null, verdict: 'unknown' });
  });

  it('reports an ISBN only one side carries as uncompared, because it cost nothing', () => {
    const outcome = verifyAgainstRequest(request({ isbn13: '9780441013593' }), metadata(), null);
    expect(rowFor(outcome, 'isbn13')).toMatchObject({ requested: '9780441013593', imported: null, verdict: 'unknown' });
  });

  it('carries the rows through the ISBN shortcut, which returns before anything is compared', () => {
    const outcome = verifyAgainstRequest(request({ isbn13: '9780441013593' }), metadata({ isbn13: '9780441013593' }), null);

    expect(outcome.code).toBe('isbn_match');
    expect(outcome.rows.map((row) => row.field)).toEqual(['title', 'authors', 'isbn13']);
    expect(rowFor(outcome, 'isbn13').verdict).toBe('match');
  });

  it('names the subtitle in the requested title, since that is what was scored against', () => {
    const outcome = verifyAgainstRequest(request({ title: 'Dune', subtitle: 'Book One' }), metadata(), null);
    expect(rowFor(outcome, 'title').requested).toBe('Dune: Book One');
  });
});

describe('RequestVerificationService review surface', () => {
  const heldRequest = { ...request(), id: 7, status: 'needs_review', bookDockFileId: 100, targetLibraryId: 2, targetFolderId: 3 };

  function makeService(
    overrides: {
      dockRow?: Record<string, unknown>;
      unitFiles?: Array<Record<string, unknown>>;
      requestRow?: Record<string, unknown>;
      downloadRow?: Record<string, unknown>;
      firstFolderId?: number | null;
      finalizeResult?: Record<string, unknown>;
      threshold?: number;
      verificationEnabled?: boolean;
    } = {},
  ) {
    const dockRepo = {
      findById: vi.fn().mockResolvedValue(
        overrides.dockRow ?? {
          id: 100,
          fileName: 'dune.epub',
          fileSize: 1024,
          format: 'epub',
          unitDirectory: null,
          fetchedMetadata: metadata({ title: 'Dune Messiah' }),
          embeddedMetadata: null,
        },
      ),
      findUnitFiles: vi.fn().mockResolvedValue(overrides.unitFiles ?? []),
    };
    const dock = { discardFile: vi.fn().mockResolvedValue(undefined) };
    const finalizeService = {
      finalizeManagedFile: vi.fn().mockResolvedValue(overrides.finalizeResult ?? { success: true, bookId: 55 }),
    };
    const downloadRow = { id: 11, requestId: 7, status: 'needs_review', bookDockFileId: 100, ...overrides.downloadRow } as BookRequestDownloadRow;
    const downloads = {
      findByBookDockFileId: vi.fn().mockResolvedValue(downloadRow),
      findLatestForRequests: vi.fn().mockResolvedValue(new Map([[7, { download: downloadRow, downloadClientName: null }]])),
      update: vi.fn().mockResolvedValue(undefined),
      updateIf: vi.fn().mockImplementation((id: number, _expected: unknown, patch: Record<string, unknown>) => Promise.resolve({ id, ...patch })),
    };
    const requests = {
      findById: vi.fn().mockResolvedValue({ request: { ...heldRequest, ...overrides.requestRow } }),
      update: vi.fn().mockResolvedValue(undefined),
      updateIf: vi.fn().mockImplementation((id: number, _expected: unknown, patch: Record<string, unknown>) => Promise.resolve({ id, ...patch })),
      findFirstFolderId: vi.fn().mockResolvedValue(overrides.firstFolderId === undefined ? 3 : overrides.firstFolderId),
    };
    const fulfillment = { failDownload: vi.fn().mockResolvedValue(undefined), holdForReview: vi.fn().mockResolvedValue(undefined) };
    const notifier = {
      notifyApprovers: vi.fn().mockResolvedValue(undefined),
      notifyInterested: vi.fn().mockResolvedValue(undefined),
      notifyResponsible: vi.fn().mockResolvedValue(undefined),
      notifyBookAvailable: vi.fn().mockResolvedValue(undefined),
    };
    const gateway = { emitChanged: vi.fn() };
    const settings = {
      get: vi.fn().mockResolvedValue({
        verificationEnabled: overrides.verificationEnabled ?? true,
        verificationThreshold: overrides.threshold ?? 70,
      }),
    };

    const service = new RequestVerificationService(
      { on: vi.fn() } as never,
      dockRepo as never,
      dock as never,
      finalizeService as never,
      downloads as never,
      requests as never,
      fulfillment as never,
      notifier as never,
      gateway as never,
      settings as never,
    );

    return { service, dock, dockRepo, finalizeService, downloads, requests, notifier, gateway, fulfillment };
  }

  it('describes a loose single file from the anchor row, which already describes it fully', async () => {
    const { service } = makeService();

    const review = await service.getReview(7);

    expect(review.files).toEqual([{ fileName: 'dune.epub', fileSize: 1024, format: 'epub', role: 'content' }]);
    expect(review.totalSizeBytes).toBe(1024);
    expect(review.bookDockFileId).toBe(100);
  });

  it('lists every file of a multi-file unit and totals only the sizes it knows', async () => {
    const { service } = makeService({
      dockRow: {
        id: 100,
        fileName: 'part-01.m4b',
        fileSize: 400,
        format: 'm4b',
        unitDirectory: '/dock/dune',
        fetchedMetadata: metadata(),
        embeddedMetadata: null,
      },
      unitFiles: [
        { fileName: 'part-01.m4b', fileSize: 400, format: 'm4b', role: 'content' },
        { fileName: 'part-02.m4b', fileSize: 600, format: 'm4b', role: 'content' },
        { fileName: 'cover.jpg', fileSize: null, format: 'jpg', role: 'cover' },
      ],
    });

    const review = await service.getReview(7);

    expect(review.files).toHaveLength(3);
    expect(review.files[2]).toMatchObject({ fileName: 'cover.jpg', role: 'cover' });
    expect(review.totalSizeBytes).toBe(1000);
  });

  /** Never exposed: a dock path is a server path, and the review is the one new read of that row. */
  it('reports file names without the absolute paths they came from', async () => {
    const { service } = makeService({
      dockRow: {
        id: 100,
        fileName: 'dune.epub',
        fileSize: 1024,
        format: 'epub',
        absolutePath: '/srv/book-dock/dune.epub',
        unitDirectory: '/srv/book-dock/dune',
        fetchedMetadata: metadata(),
        embeddedMetadata: null,
      },
      unitFiles: [{ fileName: 'dune.epub', fileSize: 1024, format: 'epub', role: 'content', absolutePath: '/srv/book-dock/dune/dune.epub' }],
    });

    const review = await service.getReview(7);

    expect(JSON.stringify(review)).not.toContain('/srv/book-dock');
  });

  /**
   * The whole reason the score is recomputed instead of replayed: an approver who corrects the
   * metadata in the dock and comes back must see the corrected number, not the one that held it.
   */
  it('scores against the dock entry as it stands now, not as it stood when it was held', async () => {
    const stale = await makeService().service.getReview(7);
    expect(stale.verification).toMatchObject({ passed: false, reason: 'below_threshold' });

    const corrected = await makeService({
      dockRow: {
        id: 100,
        fileName: 'dune.epub',
        fileSize: 1024,
        format: 'epub',
        unitDirectory: null,
        fetchedMetadata: metadata(),
        embeddedMetadata: null,
      },
    }).service.getReview(7);

    expect(corrected.verification).toMatchObject({ passed: true, score: 100 });
  });

  it('reports the operator threshold alongside the score, so the drawer needs no second read', async () => {
    const { service } = makeService({ threshold: 85 });
    expect((await service.getReview(7)).verification?.threshold).toBe(85);
  });

  it('offers no verification when the operator has switched import checking off', async () => {
    const { service } = makeService({ verificationEnabled: false });
    expect((await service.getReview(7)).verification).toBeNull();
  });

  it('falls back to the library first folder when the request never named one', async () => {
    const { service } = makeService({ requestRow: { targetFolderId: null } });
    expect((await service.getReview(7)).canFile).toBe(true);
  });

  it('reports that it cannot be filed when there is no folder anywhere to file it into', async () => {
    const { service } = makeService({ requestRow: { targetFolderId: null, targetLibraryId: null }, firstFolderId: null });
    expect((await service.getReview(7)).canFile).toBe(false);
  });

  /**
   * Both columns pointing at the entry are `on delete set null`, so filing or discarding it by
   * hand empties them together and the hold outlives its file. Found in the dev database.
   */
  it('reports a dock entry that has been removed instead of refusing to answer', async () => {
    const { service } = makeService({ requestRow: { bookDockFileId: null }, downloadRow: { bookDockFileId: null } });

    const review = await service.getReview(7);

    expect(review).toMatchObject({ bookDockFileId: null, verification: null, files: [], canFile: false });
  });

  it('finds the entry through the attempt when only the request lost its pointer', async () => {
    const { service } = makeService({ requestRow: { bookDockFileId: null } });
    expect((await service.getReview(7)).bookDockFileId).toBe(100);
  });

  it('refuses to file a request whose dock entry has been removed', async () => {
    const { service, finalizeService } = makeService({ requestRow: { bookDockFileId: null }, downloadRow: { bookDockFileId: null } });

    await expect(service.fileHeldImport(7, { id: 9 } as never)).rejects.toThrow(/nothing left to file/);
    expect(finalizeService.finalizeManagedFile).not.toHaveBeenCalled();
  });

  it('refuses to review a request that is not waiting on a person', async () => {
    const { service } = makeService({ requestRow: { status: 'available' } });
    await expect(service.getReview(7)).rejects.toThrow(/not waiting for review/);
  });

  it('files a held import on an approver overruling the score', async () => {
    const { service, finalizeService, requests, downloads, notifier } = makeService();

    await service.fileHeldImport(7, { id: 9 } as never);

    expect(finalizeService.finalizeManagedFile).toHaveBeenCalledWith(100, { libraryId: 2, folderId: 3 });
    expect(downloads.updateIf).toHaveBeenCalledWith(11, expect.anything(), expect.objectContaining({ status: 'imported' }));
    expect(requests.updateIf).toHaveBeenCalledWith(
      7,
      expect.arrayContaining(['needs_review']),
      expect.objectContaining({ status: 'available', matchedBookId: 55, statusReason: null }),
    );
    expect(notifier.notifyBookAvailable).toHaveBeenCalled();
  });

  /** A failure here is the approver's to see, not another silent hold they have to come back to. */
  it('throws the dock message back at the approver instead of holding the import again', async () => {
    const { service, fulfillment } = makeService({ finalizeResult: { success: false, message: 'a book with that path already exists' } });

    await expect(service.fileHeldImport(7, { id: 9 } as never)).rejects.toThrow(/already exists/);
    expect(fulfillment.holdForReview).not.toHaveBeenCalled();
  });

  it('refuses to file a request that is not held', async () => {
    const { service, finalizeService } = makeService({ requestRow: { status: 'downloading' } });

    await expect(service.fileHeldImport(7, { id: 9 } as never)).rejects.toThrow(/not waiting for review/);
    expect(finalizeService.finalizeManagedFile).not.toHaveBeenCalled();
  });

  it('discards a held import without requiring separate Book Dock permission', async () => {
    const { service, dock, requests, downloads, notifier, gateway } = makeService();

    await service.discardHeldImport(7, { id: 9, isSuperuser: false, permissions: [] } as never);

    expect(requests.updateIf).toHaveBeenCalledWith(7, ['needs_review'], expect.objectContaining({ status: 'failed' }));
    expect(downloads.updateIf).toHaveBeenCalledWith(11, ['needs_review'], expect.objectContaining({ status: 'failed' }));
    expect(dock.discardFile).toHaveBeenCalledWith(100, 9, true);
    expect(notifier.notifyResponsible).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      NotificationType.BookRequestFailed,
      expect.objectContaining({ meta: { requestId: 7, downloadId: 11, dockFileId: 100 } }),
    );
    expect(gateway.emitChanged).toHaveBeenCalledOnce();
  });

  it('does not delete the dock entry when the download is no longer held', async () => {
    const { service, dock, requests, downloads, gateway } = makeService();
    downloads.updateIf.mockResolvedValueOnce(undefined);

    await expect(service.discardHeldImport(7, { id: 9 } as never)).rejects.toThrow(/no longer waiting for review/);

    expect(requests.updateIf).toHaveBeenLastCalledWith(7, ['failed'], expect.objectContaining({ status: 'needs_review' }));
    expect(dock.discardFile).not.toHaveBeenCalled();
    expect(gateway.emitChanged).not.toHaveBeenCalled();
  });

  it('restores the held state when deleting the dock files fails', async () => {
    const { service, dock, requests, downloads, gateway } = makeService();
    dock.discardFile.mockRejectedValueOnce(new Error('disk is read-only'));

    await expect(service.discardHeldImport(7, { id: 9, isSuperuser: false, permissions: [] } as never)).rejects.toThrow(
      /held import could not be discarded/i,
    );

    expect(requests.updateIf).toHaveBeenLastCalledWith(7, ['failed'], expect.objectContaining({ status: 'needs_review' }));
    expect(downloads.updateIf).toHaveBeenLastCalledWith(11, ['failed'], expect.objectContaining({ status: 'needs_review' }));
    expect(gateway.emitChanged).not.toHaveBeenCalled();
  });
});
