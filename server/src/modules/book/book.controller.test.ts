import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { MockedFunction } from 'vitest';
import { ZipArchive } from 'archiver';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { AUDITABLE_KEY } from '../../common/decorators/auditable.decorator';
import { FORBIDDEN_PERMISSION_KEY } from '../../common/decorators/forbid-permission.decorator';
import { BookController } from './book.controller';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

vi.mock('archiver', () => ({
  ZipArchive: vi.fn(function () {
    return {
      pipe: vi.fn(),
      file: vi.fn(),
      on: vi.fn().mockReturnThis(),
      abort: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    createReadStream: vi.fn(() => ({ stream: true })),
  };
});

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    stat: vi.fn(),
  };
});

const mockStat = stat as MockedFunction<typeof stat>;
const mockCreateReadStream = createReadStream as MockedFunction<typeof createReadStream>;

function makeUser(): RequestUser {
  return {
    id: 1,
    username: 'tester',
    name: 'Tester',
    email: null,
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    isSuperuser: false,
    permissions: [],

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeReply() {
  const headers: Record<string, unknown> = {};
  const listeners = new Map<string, Set<() => void>>();
  const raw = {
    destroyed: false,
    writableEnded: false,
    setHeader: vi.fn((key: string, value: unknown) => {
      headers[key] = value;
    }),
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(() => {
      raw.writableEnded = true;
    }),
    on: vi.fn((event: string, listener: () => void) => {
      const set = listeners.get(event) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(event, set);
      return raw;
    }),
    off: vi.fn((event: string, listener: () => void) => {
      listeners.get(event)?.delete(listener);
      return raw;
    }),
  };

  const reply = {
    raw,
    status: vi.fn(),
    header: vi.fn(),
    type: vi.fn(),
    send: vi.fn(),
  };

  reply.status.mockImplementation(() => reply as never);
  reply.header.mockImplementation((key: string, value: unknown) => {
    headers[key] = value;
    return reply as never;
  });
  reply.type.mockImplementation(() => reply as never);
  reply.send.mockImplementation(() => reply as never);

  return {
    reply: reply as never,
    raw,
    headers,
    emitRawEvent: (event: string) => {
      for (const listener of listeners.get(event) ?? []) {
        listener();
      }
    },
  };
}

function mockZipArchiveOnce(archive: unknown) {
  (ZipArchive as unknown as vi.Mock).mockImplementationOnce(
    class {
      constructor() {
        return archive;
      }
    } as never,
  );
}

function makeController() {
  const bookService = {
    embedAll: vi.fn(),
    deleteBooks: vi.fn(),
    searchAcrossLibraries: vi.fn(),
    globalQuery: vi.fn(),
    bulkRefreshMetadata: vi.fn(),
    bulkReExtractCover: vi.fn(),
    bulkSetMetadata: vi.fn(),
    bulkEditMetadata: vi.fn(),
    bulkUpdateTags: vi.fn(),
    getExportFiles: vi.fn(),
    getMetadataExportPreflight: vi.fn(),
    buildMetadataExport: vi.fn(),
    acquireExportSlot: vi.fn().mockReturnValue(vi.fn()),
    getCoverPath: vi.fn(),
    getThumbnailPath: vi.fn(),
    getFileInfo: vi.fn(),
    resolveDownloadFilename: vi.fn(),
    getProgress: vi.fn(),
    getBookProgress: vi.fn(),
    getAudioProgress: vi.fn(),
    saveProgress: vi.fn(),
    clearFileProgress: vi.fn(),
    saveAudioProgress: vi.fn(),
    updatePersonalNote: vi.fn(),
    updateMetadata: vi.fn(),
    updateMetadataAndLocks: vi.fn(),
    updateMetadataLocks: vi.fn(),
    refreshMetadata: vi.fn(),
    getMetadataFromFile: vi.fn(),
    writeAndRename: vi.fn(),
    verifyBookAccess: vi.fn(),
    getKoboState: vi.fn(),
    setReadStatus: vi.fn(),
    getDetail: vi.fn(),
    resolveSelectionToIds: vi.fn().mockImplementation((dto: { bookIds?: number[] }) => Promise.resolve(dto.bookIds ?? [])),
  };
  const fileWriteService = {
    findWriteLog: vi.fn(),
  };

  return {
    controller: new BookController(bookService as never, fileWriteService as never),
    bookService,
    fileWriteService,
  };
}

describe('BookController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStat.mockReset();
    mockCreateReadStream.mockReset();
    mockCreateReadStream.mockReturnValue({ stream: true } as never);
  });

  it('throws NotFoundException when cover is missing', async () => {
    const { controller, bookService } = makeController();
    const { reply } = makeReply();
    bookService.getCoverPath.mockResolvedValue(null);

    await expect(controller.getCover(7, makeUser(), reply, undefined, undefined)).rejects.toThrow(NotFoundException);
  });

  it('delegates embed-all endpoint to service', async () => {
    const { controller, bookService } = makeController();
    bookService.embedAll.mockResolvedValue({ queued: 5 });

    await expect(controller.embedAll()).resolves.toEqual({ queued: 5 });
    expect(bookService.embedAll).toHaveBeenCalledTimes(1);
  });

  it('updates a personal note through the service', async () => {
    const { controller, bookService } = makeController();
    const user = makeUser();
    const updated = { id: 7, personalNote: 'private note' };
    bookService.updatePersonalNote.mockResolvedValue(updated);

    await expect(controller.updatePersonalNote(7, { note: 'private note' }, user)).resolves.toBe(updated);
    expect(bookService.updatePersonalNote).toHaveBeenCalledWith(7, { note: 'private note' }, user);
  });

  it('returns 304 when cover etag matches (unversioned → 24h private cache)', async () => {
    const { controller, bookService } = makeController();
    const { reply, headers } = makeReply();
    bookService.getCoverPath.mockResolvedValue('/tmp/cover.jpg');
    mockStat.mockResolvedValue({ mtimeMs: 1234 } as never);

    await controller.getCover(7, makeUser(), reply, undefined, '"1234"');

    expect(reply.status).toHaveBeenCalledWith(304);
    expect(headers['Cache-Control']).toBe('private, max-age=86400');
    expect(headers['ETag']).toBe('"1234"');
    expect(reply.send).toHaveBeenCalled();
    expect(mockCreateReadStream).not.toHaveBeenCalled();
  });

  it('returns 304 with immutable cache when cover etag matches and ?t= present', async () => {
    const { controller, bookService } = makeController();
    const { reply, headers } = makeReply();
    bookService.getCoverPath.mockResolvedValue('/tmp/cover.jpg');
    mockStat.mockResolvedValue({ mtimeMs: 1234 } as never);

    await controller.getCover(7, makeUser(), reply, '1234567890', '"1234"');

    expect(reply.status).toHaveBeenCalledWith(304);
    expect(headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
  });

  it('streams cover with 24h private cache when no ?t= param', async () => {
    const { controller, bookService } = makeController();
    const { reply, headers } = makeReply();
    bookService.getCoverPath.mockResolvedValue('/tmp/cover.png');
    mockStat.mockResolvedValue({ mtimeMs: 4321 } as never);

    await controller.getCover(7, makeUser(), reply, undefined, undefined);

    expect(headers['Cache-Control']).toBe('private, max-age=86400');
    expect(headers['ETag']).toBe('"4321"');
    expect(reply.type).toHaveBeenCalledWith('image/png');
    expect(mockCreateReadStream).toHaveBeenCalledWith('/tmp/cover.png');
    expect(reply.send).toHaveBeenCalled();
  });

  it('streams cover with immutable cache when ?t= param present', async () => {
    const { controller, bookService } = makeController();
    const { reply, headers } = makeReply();
    bookService.getCoverPath.mockResolvedValue('/tmp/cover.jpg');
    mockStat.mockResolvedValue({ mtimeMs: 4321 } as never);

    await controller.getCover(7, makeUser(), reply, '1234567890', undefined);

    expect(headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
    expect(reply.type).toHaveBeenCalledWith('image/jpeg');
  });

  it('sets RFC5987 content-disposition filename for downloads', async () => {
    const { controller, bookService } = makeController();
    const { reply, headers } = makeReply();
    bookService.getFileInfo.mockResolvedValue({
      path: '/tmp/book.epub',
      size: 100,
      format: 'epub',
      bookId: 5,
      originalFilename: 'book.epub',
    });
    bookService.resolveDownloadFilename.mockResolvedValue('caf\u00e9.epub');

    await controller.downloadFile(1, makeUser(), reply);

    expect(headers['Accept-Ranges']).toBe('bytes');
    expect(headers['Content-Disposition']).toBe(`attachment; filename="caf_.epub"; filename*=UTF-8''caf%C3%A9.epub`);
    expect(reply.type).toHaveBeenCalledWith('application/epub+zip');
    expect(mockCreateReadStream).toHaveBeenCalledWith('/tmp/book.epub');
  });

  it('serves inline content-disposition for file stream route', async () => {
    const { controller, bookService } = makeController();
    const { reply, headers } = makeReply();
    bookService.getFileInfo.mockResolvedValue({
      path: '/tmp/book.epub',
      size: 100,
      format: 'epub',
      bookId: 5,
      originalFilename: 'book.epub',
    });

    await controller.serveFile(1, makeUser(), undefined, reply);

    expect(headers['Content-Disposition']).toBe(`inline; filename="book.epub"; filename*=UTF-8''book.epub`);
  });

  it('serves partial content for valid byte ranges', async () => {
    const { controller, bookService } = makeController();
    const { reply, headers } = makeReply();
    bookService.getFileInfo.mockResolvedValue({
      path: '/tmp/book.pdf',
      size: 500,
      format: 'pdf',
      bookId: 5,
      originalFilename: 'book.pdf',
    });

    await controller.serveFile(1, makeUser(), 'bytes=10-19', reply);

    expect(reply.status).toHaveBeenCalledWith(206);
    expect(headers['Content-Range']).toBe('bytes 10-19/500');
    expect(headers['Content-Length']).toBe(10);
    expect(mockCreateReadStream).toHaveBeenCalledWith('/tmp/book.pdf', { start: 10, end: 19 });
  });

  it('returns 416 for unsatisfiable ranges instead of attempting stream', async () => {
    const { controller, bookService } = makeController();
    const { reply, headers } = makeReply();
    bookService.getFileInfo.mockResolvedValue({
      path: '/tmp/book.epub',
      size: 100,
      format: 'epub',
      bookId: 5,
      originalFilename: 'book.epub',
    });

    await controller.serveFile(1, makeUser(), 'bytes=120-130', reply);

    expect(reply.status).toHaveBeenCalledWith(416);
    expect(headers['Content-Range']).toBe('bytes */100');
    expect(mockCreateReadStream).not.toHaveBeenCalled();
  });

  it('streams server-sent events for bulk metadata refresh progress', async () => {
    const { controller, bookService } = makeController();
    const { reply, raw } = makeReply();
    bookService.bulkRefreshMetadata.mockImplementation(
      (
        _bookIds: number[],
        _user: RequestUser,
        onProgress: (event: { bookId: number; success: boolean; detail?: unknown; error?: string }) => void,
        options?: { isCancelled?: () => boolean },
      ) => {
        expect(options?.isCancelled?.()).toBe(false);
        onProgress({ bookId: 9, success: true });
        return Promise.resolve({ processed: 1, failed: 0 });
      },
    );

    await controller.bulkRefreshMetadata({ bookIds: [9] }, makeUser(), reply);

    expect(raw.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    expect(raw.write).toHaveBeenNthCalledWith(1, `data: ${JSON.stringify({ bookId: 9, success: true })}\n\n`);
    expect(raw.write).toHaveBeenNthCalledWith(2, `data: ${JSON.stringify({ done: true, processed: 1, failed: 0 })}\n\n`);
    expect(raw.end).toHaveBeenCalled();
  });

  it('stops sending SSE done event when client disconnects', async () => {
    const { controller, bookService } = makeController();
    const { reply, raw, emitRawEvent } = makeReply();
    bookService.bulkRefreshMetadata.mockImplementation(
      (
        _bookIds: number[],
        _user: RequestUser,
        onProgress: (event: { bookId: number; success: boolean; detail?: unknown; error?: string }) => void,
      ) => {
        onProgress({ bookId: 9, success: true });
        emitRawEvent('close');
        return Promise.resolve({ processed: 1, failed: 0 });
      },
    );

    await controller.bulkRefreshMetadata({ bookIds: [9] }, makeUser(), reply);

    expect(raw.write).toHaveBeenCalledTimes(1);
    expect(raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ bookId: 9, success: true })}\n\n`);
    expect(raw.end).not.toHaveBeenCalled();
  });

  it('streams server-sent events for bulk cover re-extraction progress', async () => {
    const { controller, bookService } = makeController();
    const { reply, raw } = makeReply();
    bookService.bulkReExtractCover.mockImplementation(
      (_bookIds: number[], _user: RequestUser, onProgress: (bookId: number) => void, options?: { isCancelled?: () => boolean }) => {
        expect(options?.isCancelled?.()).toBe(false);
        onProgress(12);
        return Promise.resolve({ processed: 1, updated: 1 });
      },
    );

    await controller.bulkReExtractCover({ bookIds: [12] }, makeUser(), reply);

    expect(raw.write).toHaveBeenNthCalledWith(1, `data: ${JSON.stringify({ bookId: 12 })}\n\n`);
    expect(raw.write).toHaveBeenNthCalledWith(2, `data: ${JSON.stringify({ done: true, processed: 1, updated: 1 })}\n\n`);
    expect(raw.end).toHaveBeenCalled();
  });

  it('archives exported files into a zip stream', async () => {
    const { controller, bookService } = makeController();
    const { reply, raw } = makeReply();
    bookService.getExportFiles.mockResolvedValue({
      files: [
        { absolutePath: '/books/a.epub', zipPath: 'A.epub', sizeBytes: 10 },
        { absolutePath: '/books/b.epub', zipPath: 'B.epub', sizeBytes: 20 },
      ],
      projectedBytes: 30,
      bookCount: 2,
      scope: 'primary',
      archiveFilename: 'Selected Books.zip',
    });

    await controller.exportBooks({ bookIds: [1, 2], allFormats: false }, makeUser(), reply);

    expect(raw.setHeader).toHaveBeenCalledWith('Content-Type', 'application/zip');
    expect(raw.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      `attachment; filename="Selected Books.zip"; filename*=UTF-8''Selected%20Books.zip`,
    );

    const zipArchiveMock = ZipArchive as unknown as vi.Mock;
    expect(zipArchiveMock).toHaveBeenCalledWith({ zlib: { level: 0 } });
    const archive = zipArchiveMock.mock.results[0].value;

    expect(archive.pipe).toHaveBeenCalledWith(raw);
    expect(archive.file).toHaveBeenCalledWith('/books/a.epub', { name: 'A.epub' });
    expect(archive.file).toHaveBeenCalledWith('/books/b.epub', { name: 'B.epub' });
    expect(archive.finalize).toHaveBeenCalled();
  });

  it('throws export errors when archive finalization fails without disconnect', async () => {
    const { controller, bookService } = makeController();
    const { reply } = makeReply();
    bookService.getExportFiles.mockResolvedValue({
      files: [{ absolutePath: '/books/a.epub', zipPath: 'A.epub', sizeBytes: 10 }],
      projectedBytes: 10,
      bookCount: 1,
      scope: 'primary',
    });
    const archive = {
      pipe: vi.fn(),
      file: vi.fn(),
      on: vi.fn().mockReturnThis(),
      abort: vi.fn(),
      finalize: vi.fn().mockRejectedValue(new Error('zip failure')),
    };
    mockZipArchiveOnce(archive);

    await expect(controller.exportBooks({ bookIds: [1], allFormats: false }, makeUser(), reply)).rejects.toThrow('zip failure');
  });

  it('parses export download query args and delegates with scope', async () => {
    const { controller, bookService } = makeController();
    const { reply } = makeReply();
    bookService.getExportFiles.mockResolvedValue({
      files: [{ absolutePath: '/books/a.epub', zipPath: 'A.epub', sizeBytes: 10 }],
      projectedBytes: 10,
      bookCount: 1,
      scope: 'audio',
    });

    await controller.exportBooksDownload('9,10', 'audio', makeUser(), reply);

    expect(bookService.getExportFiles).toHaveBeenCalledWith([9, 10], expect.any(Object), 'audio');
  });

  it('rejects invalid export download query args', async () => {
    const { controller } = makeController();
    const { reply } = makeReply();

    await expect(controller.exportBooksDownload(undefined, 'primary', makeUser(), reply)).rejects.toThrow(BadRequestException);
    await expect(controller.exportBooksDownload('1', 'invalid', makeUser(), reply)).rejects.toThrow(BadRequestException);
    await expect(controller.exportBooksDownload('1,-2', 'primary', makeUser(), reply)).rejects.toThrow(BadRequestException);
  });

  it('delegates metadata export preflight to service', async () => {
    const { controller, bookService } = makeController();
    const user = makeUser();
    bookService.getMetadataExportPreflight.mockResolvedValue({
      schemaVersion: 1,
      rowCount: 200,
      estimatedBytes: 120000,
      sizeCategory: 'small',
      fileName: 'bookorbit-library-all-matching-2026-05-07.csv',
      scope: 'all-matching',
      format: 'csv',
    });

    const result = await controller.metadataExportPreflight(
      {
        query: { libraryId: 5, q: 'dune', sort: [{ field: 'title', dir: 'asc' }] },
        format: 'csv',
        viewType: 'library',
      } as never,
      user,
    );

    expect(bookService.getMetadataExportPreflight).toHaveBeenCalledWith(
      {
        query: { libraryId: 5, q: 'dune', sort: [{ field: 'title', dir: 'asc' }] },
        format: 'csv',
        viewType: 'library',
      },
      user,
    );
    expect(result).toEqual({
      schemaVersion: 1,
      rowCount: 200,
      estimatedBytes: 120000,
      sizeCategory: 'small',
      fileName: 'bookorbit-library-all-matching-2026-05-07.csv',
      scope: 'all-matching',
      format: 'csv',
    });
  });

  it('streams metadata export content with encoded filename', async () => {
    const { controller, bookService } = makeController();
    const { reply, raw } = makeReply();
    bookService.buildMetadataExport.mockResolvedValue({
      preflight: {
        schemaVersion: 1,
        rowCount: 2,
        estimatedBytes: 250,
        sizeCategory: 'small',
        fileName: 'bookorbit-library-selected-2026-05-07.csv',
        scope: 'selected',
        format: 'csv',
      },
      fileName: 'bookorbit-library-selected-2026-05-07.csv',
      contentType: 'text/csv; charset=utf-8',
      content: '\uFEFFbookId,title\n1,Dune',
    });

    await controller.downloadMetadataExport(
      {
        bookIds: [1, 2],
        format: 'csv',
        viewType: 'library',
      } as never,
      makeUser(),
      reply,
    );

    expect(raw.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(raw.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment; filename="bookorbit-library-selected-2026-05-07.csv"'),
    );
    expect(reply.send).toHaveBeenCalledWith('\uFEFFbookId,title\n1,Dune');
  });

  it('releases export slot when metadata export fails', async () => {
    const { controller, bookService } = makeController();
    const { reply } = makeReply();
    const release = vi.fn();
    bookService.acquireExportSlot.mockReturnValueOnce(release);
    bookService.buildMetadataExport.mockRejectedValueOnce(new Error('boom'));

    await expect(controller.downloadMetadataExport({ bookIds: [1], format: 'json' } as never, makeUser(), reply)).rejects.toThrow('boom');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('aborts archive export and swallows finalize errors after client disconnect', async () => {
    const { controller, bookService } = makeController();
    const { reply, emitRawEvent } = makeReply();
    bookService.getExportFiles.mockResolvedValue({
      files: [{ absolutePath: '/books/a.epub', zipPath: 'A.epub', sizeBytes: 10 }],
      projectedBytes: 10,
      bookCount: 1,
      scope: 'primary',
    });
    const archive = {
      pipe: vi.fn(),
      file: vi.fn(),
      on: vi.fn().mockReturnThis(),
      abort: vi.fn(),
      finalize: vi.fn().mockImplementation(() => {
        emitRawEvent('close');
        return Promise.reject(new Error('stream closed'));
      }),
    };
    mockZipArchiveOnce(archive);

    await expect(controller.exportBooks({ bookIds: [1], allFormats: false }, makeUser(), reply)).resolves.toBeUndefined();
    expect(archive.abort).toHaveBeenCalled();
  });

  it('aborts archive on raw "aborted" event', async () => {
    const { controller, bookService } = makeController();
    const { reply, emitRawEvent } = makeReply();
    bookService.getExportFiles.mockResolvedValue({
      files: [{ absolutePath: '/books/a.epub', zipPath: 'A.epub', sizeBytes: 10 }],
      projectedBytes: 10,
      bookCount: 1,
      scope: 'primary',
    });
    const archive = {
      pipe: vi.fn(),
      file: vi.fn(),
      on: vi.fn().mockReturnThis(),
      abort: vi.fn(),
      finalize: vi.fn().mockImplementation(() => {
        emitRawEvent('aborted');
        return Promise.reject(new Error('stream aborted'));
      }),
    };
    mockZipArchiveOnce(archive);

    await expect(controller.exportBooks({ bookIds: [1], allFormats: false }, makeUser(), reply)).resolves.toBeUndefined();
    expect(archive.abort).toHaveBeenCalled();
  });

  it('releases export slot when zip archive export fails', async () => {
    const { controller, bookService } = makeController();
    const { reply } = makeReply();
    const release = vi.fn();
    bookService.acquireExportSlot.mockReturnValueOnce(release);
    bookService.getExportFiles.mockResolvedValue({
      files: [{ absolutePath: '/books/a.epub', zipPath: 'A.epub', sizeBytes: 10 }],
      projectedBytes: 10,
      bookCount: 1,
      scope: 'primary',
    });
    const archive = {
      pipe: vi.fn(),
      file: vi.fn(),
      on: vi.fn().mockReturnThis(),
      abort: vi.fn(),
      finalize: vi.fn().mockRejectedValue(new Error('zip failure')),
    };
    mockZipArchiveOnce(archive);

    await expect(controller.exportBooks({ bookIds: [1], allFormats: false }, makeUser(), reply)).rejects.toThrow('zip failure');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('archive warning event rejects the zip export', async () => {
    const { controller, bookService } = makeController();
    const { reply } = makeReply();
    bookService.getExportFiles.mockResolvedValue({
      files: [{ absolutePath: '/books/a.epub', zipPath: 'A.epub', sizeBytes: 10 }],
      projectedBytes: 10,
      bookCount: 1,
      scope: 'primary',
    });
    const listeners: Record<string, (err: Error) => void> = {};
    const archive = {
      pipe: vi.fn(),
      file: vi.fn(),
      on: vi.fn().mockImplementation((event: string, cb: (err: Error) => void) => {
        listeners[event] = cb;
        return archive;
      }),
      abort: vi.fn(),
      finalize: vi.fn().mockImplementation(() => {
        void Promise.resolve().then(() => listeners['warning']?.(new Error('archive warning')));
        return new Promise<void>(() => {});
      }),
    };
    mockZipArchiveOnce(archive);

    await expect(controller.exportBooks({ bookIds: [1], allFormats: false }, makeUser(), reply)).rejects.toThrow('archive warning');
  });

  it('exportBooksDownload with scope=all passes through correctly', async () => {
    const { controller, bookService } = makeController();
    const { reply } = makeReply();
    bookService.getExportFiles.mockResolvedValue({
      files: [{ absolutePath: '/books/a.epub', zipPath: 'A.epub', sizeBytes: 10 }],
      projectedBytes: 10,
      bookCount: 1,
      scope: 'all',
    });

    await controller.exportBooksDownload('5,6', 'all', makeUser(), reply);

    expect(bookService.getExportFiles).toHaveBeenCalledWith([5, 6], expect.any(Object), 'all');
  });

  it('delegates book-level progress endpoint to service with current user id', async () => {
    const { controller, bookService } = makeController();
    const user = makeUser();
    const payload = [{ fileId: 1, cfi: null, pageNumber: null, percentage: 0, updatedAt: null }];
    bookService.getBookProgress.mockResolvedValue(payload);

    const result = await controller.getBookProgress(9, user);

    expect(bookService.getBookProgress).toHaveBeenCalledWith(user.id, 9, user);
    expect(result).toEqual(payload);
  });

  it('verifies access before returning file write log entries', async () => {
    const { controller, bookService, fileWriteService } = makeController();
    bookService.verifyBookAccess.mockResolvedValue(undefined);
    fileWriteService.findWriteLog.mockResolvedValue([{ id: 1 }]);

    const result = await controller.getWriteLog(12, makeUser());

    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(12, expect.any(Object));
    expect(result).toEqual({ entries: [{ id: 1 }] });
  });

  it('handles thumbnail 304 (unversioned) and streaming responses', async () => {
    const { controller, bookService } = makeController();
    const first = makeReply();
    const second = makeReply();
    bookService.getThumbnailPath.mockResolvedValue('/tmp/thumb.jpg');
    mockStat.mockResolvedValue({ mtimeMs: 1000 } as never);

    await controller.getThumbnail(7, makeUser(), first.reply, undefined, '"1000"');
    expect(first.reply.status).toHaveBeenCalledWith(304);
    expect(first.headers['ETag']).toBe('"1000"');
    expect(first.headers['Cache-Control']).toBe('private, max-age=86400');

    await controller.getThumbnail(7, makeUser(), second.reply, undefined, undefined);
    expect(second.reply.type).toHaveBeenCalledWith('image/jpeg');
    expect(second.headers['Cache-Control']).toBe('private, max-age=86400');
    expect(mockCreateReadStream).toHaveBeenCalledWith('/tmp/thumb.jpg');
  });

  it('uses immutable cache for thumbnail when ?t= param present', async () => {
    const { controller, bookService } = makeController();
    const { reply, headers } = makeReply();
    bookService.getThumbnailPath.mockResolvedValue('/tmp/thumb.jpg');
    mockStat.mockResolvedValue({ mtimeMs: 1000 } as never);

    await controller.getThumbnail(7, makeUser(), reply, '1234567890', undefined);
    expect(headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
  });

  it('throws NotFoundException when thumbnail is missing', async () => {
    const { controller, bookService } = makeController();
    const { reply } = makeReply();
    bookService.getThumbnailPath.mockResolvedValue(null);

    await expect(controller.getThumbnail(7, makeUser(), reply, undefined, undefined)).rejects.toThrow(NotFoundException);
  });

  it('delegates re-extract-cover endpoint to bulk cover flow', async () => {
    const { controller, bookService } = makeController();
    bookService.bulkReExtractCover.mockResolvedValue({ processed: 1, updated: 1 });
    const user = makeUser();

    await controller.reExtractCover(42, user);

    expect(bookService.bulkReExtractCover).toHaveBeenCalledWith([42], user);
  });

  it('logs and rethrows download failures', async () => {
    const { controller, bookService } = makeController();
    const { reply } = makeReply();
    bookService.getFileInfo.mockRejectedValue(new Error('fs unavailable'));

    await expect(controller.downloadFile(1, makeUser(), reply)).rejects.toThrow('fs unavailable');
  });

  it('uses fallback object when no file progress exists', async () => {
    const { controller, bookService } = makeController();
    const user = makeUser();
    bookService.getProgress.mockResolvedValue(null);

    await expect(controller.getFileProgress(9, user)).resolves.toEqual({
      cfi: null,
      pageNumber: null,
      percentage: 0,
      koboLocationSource: null,
      koboLocationType: null,
      koboLocationValue: null,
      koboContentSourceProgressPercent: null,
      koreaderProgress: null,
    });
    expect(bookService.getProgress).toHaveBeenCalledWith(user.id, 9, user);
  });

  it('delegates progress mutation endpoints to service', async () => {
    const { controller, bookService } = makeController();
    const user = makeUser();

    await controller.saveFileProgress(9, { percentage: 25 } as never, user);
    await controller.clearFileProgress(9, user);
    await controller.saveAudioProgress(11, { currentFileId: 2, positionSeconds: 90, percentage: 20 } as never, user);

    expect(bookService.saveProgress).toHaveBeenCalledWith(user.id, 9, { percentage: 25 }, user);
    expect(bookService.clearFileProgress).toHaveBeenCalledWith(user.id, 9, user);
    expect(bookService.saveAudioProgress).toHaveBeenCalledWith(user.id, 11, { currentFileId: 2, positionSeconds: 90, percentage: 20 }, user);
  });

  it('delegates remaining book endpoints to service methods', async () => {
    const { controller, bookService } = makeController();
    const user = makeUser();
    bookService.updateMetadata.mockResolvedValue({ book: { id: 7 }, write: null, libraryAutoWriteEnabled: false });
    bookService.updateMetadataAndLocks.mockResolvedValue({
      book: { id: 7, lockedFields: ['goodreadsId'] },
      write: null,
      libraryAutoWriteEnabled: false,
    });
    bookService.updateMetadataLocks.mockResolvedValue({ id: 7, lockedFields: ['title'] });
    bookService.refreshMetadata.mockResolvedValue({ id: 7 });
    bookService.getMetadataFromFile.mockResolvedValue({ title: 'File Title' });
    bookService.getKoboState.mockResolvedValue({ eligibleForKoboSync: false, syncCollections: [], readingState: null, snapshots: [] });
    bookService.getAudioProgress.mockResolvedValue({ positionSeconds: 15 });
    bookService.getDetail.mockResolvedValue({ id: 7, title: 'Detail' });

    await controller.updateMetadata(7, { title: 'New' } as never, user);
    await controller.updateMetadataAndLocks(7, { metadata: { goodreadsId: '123' }, lockedFields: ['goodreadsId'] } as never, user);
    await controller.bulkSetMetadata({ bookIds: [7, 8], field: 'language', value: 'fr' } as never, user);
    await controller.updateMetadataLocks(7, { lockedFields: ['title'] } as never, user);
    await controller.refreshMetadata(7, 'true', user);
    await controller.getMetadataFromFile(7, user);
    await controller.getKoboState(7, user);
    await controller.setReadStatus(7, { status: 'reading' } as never, user);
    await controller.getAudioProgress(7, user);
    await controller.getDetail(7, user);

    expect(bookService.updateMetadata).toHaveBeenCalledWith(7, { title: 'New' }, user, { postSaveMode: 'schedule' });
    expect(bookService.updateMetadataAndLocks).toHaveBeenCalledWith(7, { metadata: { goodreadsId: '123' }, lockedFields: ['goodreadsId'] }, user, {
      postSaveMode: 'schedule',
    });
    expect(bookService.bulkSetMetadata).toHaveBeenCalledWith([7, 8], 'language', 'fr', user);
    expect(bookService.updateMetadataLocks).toHaveBeenCalledWith(7, ['title'], user);
    expect(bookService.refreshMetadata).toHaveBeenCalledWith(7, true, user);
    expect(bookService.getMetadataFromFile).toHaveBeenCalledWith(7, user);
    expect(bookService.getKoboState).toHaveBeenCalledWith(7, user);
    expect(bookService.setReadStatus).toHaveBeenCalledWith(7, { status: 'reading' }, user);
    expect(bookService.getAudioProgress).toHaveBeenCalledWith(user.id, 7, user);
    expect(bookService.getDetail).toHaveBeenCalledWith(7, user);
  });

  it('returns the save result shape only when synchronous file write is requested', async () => {
    const { controller, bookService } = makeController();
    const user = makeUser();
    const result = {
      book: { id: 7, title: 'New' },
      write: { status: 'success', fieldsWritten: ['title'], durationMs: 12 },
      libraryAutoWriteEnabled: true,
    };
    const lockResult = {
      book: { id: 7, lockedFields: ['goodreadsId'] },
      write: { status: 'success', fieldsWritten: ['goodreadsId'], durationMs: 9 },
      libraryAutoWriteEnabled: true,
    };
    bookService.updateMetadata.mockResolvedValue(result);
    bookService.updateMetadataAndLocks.mockResolvedValue(lockResult);

    await expect(controller.updateMetadata(7, { title: 'New' } as never, user)).resolves.toEqual({ id: 7, title: 'New' });
    await expect(controller.updateMetadata(7, { title: 'New' } as never, user, 'true')).resolves.toEqual(result);
    await expect(
      controller.updateMetadataAndLocks(7, { metadata: { goodreadsId: '123' }, lockedFields: ['goodreadsId'] } as never, user),
    ).resolves.toEqual(lockResult.book);
    await expect(
      controller.updateMetadataAndLocks(7, { metadata: { goodreadsId: '123' }, lockedFields: ['goodreadsId'] } as never, user, 'true'),
    ).resolves.toEqual(lockResult);

    expect(bookService.updateMetadata).toHaveBeenNthCalledWith(1, 7, { title: 'New' }, user, { postSaveMode: 'schedule' });
    expect(bookService.updateMetadata).toHaveBeenNthCalledWith(2, 7, { title: 'New' }, user, { postSaveMode: 'sync' });
    expect(bookService.updateMetadataAndLocks).toHaveBeenNthCalledWith(
      1,
      7,
      { metadata: { goodreadsId: '123' }, lockedFields: ['goodreadsId'] },
      user,
      {
        postSaveMode: 'schedule',
      },
    );
    expect(bookService.updateMetadataAndLocks).toHaveBeenNthCalledWith(
      2,
      7,
      { metadata: { goodreadsId: '123' }, lockedFields: ['goodreadsId'] },
      user,
      {
        postSaveMode: 'sync',
      },
    );
  });

  it('throws when writing to a closed sse stream', () => {
    const { controller } = makeController();
    const { reply } = makeReply();
    const stream = (controller as any).createSseStream(reply);

    stream.close();

    expect(() => stream.send({ ping: true })).toThrow('SSE stream closed');
  });

  it('invokes auditable descriptions for bulk and metadata actions', () => {
    const deleteAudit = Reflect.getMetadata(AUDITABLE_KEY, BookController.prototype.deleteBooks) as {
      description: (req: { body: { bookIds?: number[] } }) => string;
    };
    const bulkRefreshAudit = Reflect.getMetadata(AUDITABLE_KEY, BookController.prototype.bulkRefreshMetadata) as {
      description: (req: { body: { bookIds?: number[] } }) => string;
    };
    const bulkCoverAudit = Reflect.getMetadata(AUDITABLE_KEY, BookController.prototype.bulkReExtractCover) as {
      description: (req: { body: { bookIds?: number[] } }) => string;
    };
    const bulkSetMetadataAudit = Reflect.getMetadata(AUDITABLE_KEY, BookController.prototype.bulkSetMetadata) as {
      description: (req: { body: { bookIds?: number[]; field?: string } }) => string;
    };
    const updateMetadataAudit = Reflect.getMetadata(AUDITABLE_KEY, BookController.prototype.updateMetadata) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }) => string;
    };
    const updateMetadataAndLocksAudit = Reflect.getMetadata(AUDITABLE_KEY, BookController.prototype.updateMetadataAndLocks) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }) => string;
    };
    const updateLocksAudit = Reflect.getMetadata(AUDITABLE_KEY, BookController.prototype.updateMetadataLocks) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }) => string;
    };
    const refreshAudit = Reflect.getMetadata(AUDITABLE_KEY, BookController.prototype.refreshMetadata) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }) => string;
    };

    expect(deleteAudit.description({ body: { bookIds: [1, 2] } })).toBe('Deleted 2 books');
    expect(bulkRefreshAudit.description({ body: { bookIds: [1] } })).toBe('Bulk refreshed metadata for 1 book');
    expect(bulkCoverAudit.description({ body: { bookIds: [1, 2, 3] } })).toBe('Bulk re-extracted covers for 3 books');
    expect(bulkSetMetadataAudit.description({ body: { bookIds: [1, 2], field: 'language' } })).toBe('Bulk set language for 2 books');
    expect(updateMetadataAudit.getResourceId({ params: { id: '44' } })).toBe(44);
    expect(updateMetadataAudit.description({ params: { id: '44' } })).toBe('Updated metadata for book #44');
    expect(updateMetadataAndLocksAudit.getResourceId({ params: { id: '44' } })).toBe(44);
    expect(updateMetadataAndLocksAudit.description({ params: { id: '44' } })).toBe('Updated metadata and locks for book #44');
    expect(updateLocksAudit.getResourceId({ params: { id: '44' } })).toBe(44);
    expect(updateLocksAudit.description({ params: { id: '44' } })).toBe('Updated metadata locks for book #44');
    expect(refreshAudit.getResourceId({ params: { id: '44' } })).toBe(44);
    expect(refreshAudit.description({ params: { id: '44' } })).toBe('Refreshed metadata for book #44');
  });

  it('marks bulk-edit endpoints as demo-restricted', () => {
    const message = 'Demo-restricted account cannot perform bulk edits';
    const bulkMethods = [
      BookController.prototype.bulkRefreshMetadata,
      BookController.prototype.bulkReExtractCover,
      BookController.prototype.bulkSetStatus,
      BookController.prototype.bulkSetRating,
      BookController.prototype.bulkSetMetadata,
      BookController.prototype.bulkUpdateTags,
      BookController.prototype.bulkSetMetadataLock,
      BookController.prototype.bulkEditMetadata,
    ];

    for (const method of bulkMethods) {
      expect(Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, method)).toEqual({
        permission: Permission.DemoRestricted,
        message,
      });
    }

    expect(Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, BookController.prototype.refreshMetadata)).toBeUndefined();
  });

  it('marks bulk-download endpoints as demo-restricted', () => {
    const message = 'Demo-restricted account cannot perform bulk downloads';
    const bulkDownloadMethods = [BookController.prototype.exportBooks, BookController.prototype.exportBooksDownload];

    for (const method of bulkDownloadMethods) {
      expect(Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, method)).toEqual({
        permission: Permission.DemoRestricted,
        message,
      });
    }
  });

  it('preserves valid surrogate pairs while stripping lone surrogates in download filenames', async () => {
    const { controller, bookService } = makeController();
    const { reply, headers } = makeReply();
    bookService.getFileInfo.mockResolvedValue({
      path: '/tmp/book.epub',
      size: 100,
      format: 'epub',
      bookId: 5,
      originalFilename: 'book.epub',
    });
    bookService.resolveDownloadFilename.mockResolvedValue('ok-\uD83D\uDE00-\uD800.epub');

    await controller.downloadFile(1, makeUser(), reply);

    expect(headers['Content-Disposition']).toBe(`attachment; filename="ok-__-_.epub"; filename*=UTF-8''ok-%F0%9F%98%80-.epub`);
  });

  describe('bulkEditMetadata', () => {
    it('resolves selection and delegates to service', async () => {
      const { controller, bookService } = makeController();
      const user = makeUser();
      const fields = { publisher: { value: 'Penguin' } };
      const expectedResult = {
        updatedBooks: 2,
        fields: { publisher: { updated: 2, skippedLocked: 0 } },
      };
      bookService.resolveSelectionToIds.mockResolvedValue([7, 9]);
      bookService.bulkEditMetadata.mockResolvedValue(expectedResult);

      const result = await controller.bulkEditMetadata({ bookIds: [7, 9], fields } as never, user);

      expect(bookService.resolveSelectionToIds).toHaveBeenCalledWith({ bookIds: [7, 9], fields }, user);
      expect(bookService.bulkEditMetadata).toHaveBeenCalledWith([7, 9], fields, user);
      expect(result).toEqual(expectedResult);
    });

    it('has the correct permission and audit decorators', () => {
      const permission = Reflect.getMetadata('permission', BookController.prototype.bulkEditMetadata);
      expect(permission).toBe(Permission.LibraryEditMetadata);

      const forbidden = Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, BookController.prototype.bulkEditMetadata);
      expect(forbidden).toEqual({
        permission: Permission.DemoRestricted,
        message: 'Demo-restricted account cannot perform bulk edits',
      });

      const audit = Reflect.getMetadata(AUDITABLE_KEY, BookController.prototype.bulkEditMetadata);
      expect(audit).toBeDefined();
      expect(audit.action).toBe('book.bulk.edit_metadata');
    });
  });

  describe('writeAndRename', () => {
    it('calls bookService.writeAndRename with user and book id', async () => {
      const { controller, bookService } = makeController();
      const user = { ...makeUser(), id: 5 };
      const expected = {
        write: { status: 'success', fieldsWritten: ['title'], durationMs: 10 },
        rename: { status: 'skipped', durationMs: 0, reason: 'path unchanged' },
        libraryAutoWriteEnabled: false,
        libraryAutoRenameEnabled: false,
      };
      bookService.writeAndRename.mockResolvedValue(expected);

      const result = await controller.writeAndRename(42, user);

      expect(bookService.writeAndRename).toHaveBeenCalledWith(42, user);
      expect(result).toEqual(expected);
    });

    it('propagates NotFoundException from bookService.writeAndRename', async () => {
      const { controller, bookService } = makeController();
      bookService.writeAndRename.mockRejectedValue(new NotFoundException('Book 999 not found'));

      await expect(controller.writeAndRename(999, makeUser())).rejects.toThrow(NotFoundException);
    });
  });
});
