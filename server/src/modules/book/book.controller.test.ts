import { BadRequestException, ForbiddenException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { MockedFunction } from 'vitest';
import { ZipArchive } from 'archiver';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { AuditAction, AuditResource, BULK_RUN_MAX_UNFINISHED, Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { AUDITABLE_KEY } from '../../common/decorators/auditable.decorator';
import { FORBIDDEN_PERMISSION_KEY } from '../../common/decorators/forbid-permission.decorator';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { BulkRunHandlerRegistry } from '../bulk-runs/bulk-run-handler.registry';
import { BulkRunStreams } from '../bulk-runs/bulk-run-streams.service';
import { BulkRunsService } from '../bulk-runs/bulk-runs.service';
import { BookEmbedAudioCoverBulkHandler, BookReExtractCoverBulkHandler, BookRefreshMetadataBulkHandler } from './book-bulk-run-handlers';
import { BookController } from './book.controller';
import { FASTIFY_ROUTE_CONFIG_METADATA } from '@nestjs/platform-fastify/constants.js';
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
    embedAudioCover: vi.fn(),
    reExtractCover: vi.fn(),
    bulkSetMetadata: vi.fn(),
    bulkSetStatus: vi.fn(),
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
    saveProgress: vi.fn(),
    clearFileProgress: vi.fn(),
    updatePersonalNote: vi.fn(),
    updateAddedAt: vi.fn(),
    updateMetadata: vi.fn(),
    updateMetadataAndLocks: vi.fn(),
    updateMetadataLocks: vi.fn(),
    refreshMetadata: vi.fn(),
    getMetadataFromFile: vi.fn(),
    getIsbnCandidates: vi.fn(),
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
  const bulkRuns = {
    startAndStream: vi.fn().mockResolvedValue(undefined),
  };

  return {
    controller: new BookController(bookService as never, fileWriteService as never, bulkRuns as never),
    bookService,
    fileWriteService,
    bulkRuns,
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

  it('passes a requested display size on to the service', async () => {
    const { controller, bookService } = makeController();
    const { reply } = makeReply();
    bookService.getCoverPath.mockResolvedValue('/tmp/display.jpg');
    mockStat.mockResolvedValue({ mtimeMs: 1234 } as never);

    await controller.getCover(7, makeUser(), reply, { t: '1', size: 'display' }, '"1234"');

    expect(bookService.getCoverPath).toHaveBeenCalledWith(7, expect.anything(), { medium: undefined, strict: undefined, size: 'display' });
  });

  it('returns 304 with immutable cache when cover etag matches and ?t= present', async () => {
    const { controller, bookService } = makeController();
    const { reply, headers } = makeReply();
    bookService.getCoverPath.mockResolvedValue('/tmp/cover.jpg');
    mockStat.mockResolvedValue({ mtimeMs: 1234 } as never);

    await controller.getCover(7, makeUser(), reply, { t: '1234567890' }, '"1234"');

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

    await controller.getCover(7, makeUser(), reply, { t: '1234567890' }, undefined);

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

  describe('file byte routes', () => {
    const MTIME_MS = Date.UTC(2026, 0, 2, 3, 4, 5);

    function mockFile(bookService: ReturnType<typeof makeController>['bookService'], format = 'pdf') {
      bookService.getFileInfo.mockResolvedValue({
        path: `/tmp/book.${format}`,
        size: 500,
        mtimeMs: MTIME_MS,
        format,
        bookId: 5,
        originalFilename: `book.${format}`,
        mediaOverlayAvailable: false,
      });
      bookService.resolveDownloadFilename.mockResolvedValue(`book.${format}`);
    }

    it('sends validators and a revalidate-every-time cache policy with the whole file', async () => {
      const { controller, bookService } = makeController();
      const { reply, headers } = makeReply();
      mockFile(bookService);

      await controller.serveFile(1, makeUser(), undefined, reply);

      expect(headers['ETag']).toMatch(/^"[0-9a-f]{64}"$/);
      expect(headers['Last-Modified']).toBe('Fri, 02 Jan 2026 03:04:05 GMT');
      expect(headers['Cache-Control']).toBe('private, no-cache');
      expect(headers['Accept-Ranges']).toBe('bytes');
      expect(headers['Content-Length']).toBe(500);
      expect(reply.status).not.toHaveBeenCalled();
      expect(mockCreateReadStream).toHaveBeenCalledWith('/tmp/book.pdf');
    });

    it('resumes from If-Range when it carries the current ETag', async () => {
      const { controller, bookService } = makeController();
      const first = makeReply();
      mockFile(bookService);
      await controller.serveFile(1, makeUser(), undefined, first.reply);
      const etag = first.headers['ETag'] as string;
      mockCreateReadStream.mockClear();

      const { reply, headers } = makeReply();
      await controller.serveFile(1, makeUser(), 'bytes=200-', reply, etag);

      expect(reply.status).toHaveBeenCalledWith(206);
      expect(headers['Content-Range']).toBe('bytes 200-499/500');
      expect(headers['Content-Length']).toBe(300);
      expect(mockCreateReadStream).toHaveBeenCalledWith('/tmp/book.pdf', { start: 200, end: 499 });
    });

    it('restarts with the whole file when If-Range names a file that has since changed', async () => {
      const { controller, bookService } = makeController();
      const { reply, headers } = makeReply();
      mockFile(bookService);

      await controller.serveFile(1, makeUser(), 'bytes=200-', reply, '"stale"');

      expect(reply.status).not.toHaveBeenCalled();
      expect(headers['Content-Range']).toBeUndefined();
      expect(headers['Content-Length']).toBe(500);
      expect(mockCreateReadStream).toHaveBeenCalledWith('/tmp/book.pdf');
    });

    it('serves suffix ranges and clamps an end past the file', async () => {
      const { controller, bookService } = makeController();
      mockFile(bookService);

      const suffix = makeReply();
      await controller.serveFile(1, makeUser(), 'bytes=-100', suffix.reply);
      expect(suffix.headers['Content-Range']).toBe('bytes 400-499/500');

      const clamped = makeReply();
      await controller.serveFile(1, makeUser(), 'bytes=450-9999', clamped.reply);
      expect(clamped.reply.status).toHaveBeenCalledWith(206);
      expect(clamped.headers['Content-Range']).toBe('bytes 450-499/500');
      expect(clamped.headers['Content-Length']).toBe(50);
    });

    it('answers 304 when If-None-Match matches on a plain GET', async () => {
      const { controller, bookService } = makeController();
      const first = makeReply();
      mockFile(bookService);
      await controller.serveFile(1, makeUser(), undefined, first.reply);
      mockCreateReadStream.mockClear();

      const { reply } = makeReply();
      await controller.serveFile(1, makeUser(), undefined, reply, undefined, first.headers['ETag'] as string);

      expect(reply.status).toHaveBeenCalledWith(304);
      expect(mockCreateReadStream).not.toHaveBeenCalled();
    });

    it('honours Range on the download route with the same validators as serve', async () => {
      const { controller, bookService } = makeController();
      mockFile(bookService, 'epub');
      const served = makeReply();
      await controller.serveFile(1, makeUser(), undefined, served.reply);
      mockCreateReadStream.mockClear();

      const { reply, headers } = makeReply();
      await controller.downloadFile(1, makeUser(), reply, 'bytes=100-199', served.headers['ETag'] as string);

      expect(headers['ETag']).toBe(served.headers['ETag']);
      expect(headers['Content-Disposition']).toContain('attachment');
      expect(reply.status).toHaveBeenCalledWith(206);
      expect(headers['Content-Range']).toBe('bytes 100-199/500');
      expect(mockCreateReadStream).toHaveBeenCalledWith('/tmp/book.epub', { start: 100, end: 199 });
    });

    it('opts every raw file route out of response compression', () => {
      for (const handler of ['serveFile', 'downloadFile', 'downloadAudiolessEpub', 'getCover', 'getThumbnail'] as const) {
        expect(Reflect.getMetadata(FASTIFY_ROUTE_CONFIG_METADATA, BookController.prototype[handler])).toEqual({ compress: false });
      }
    });
  });

  it.each([
    {
      method: 'bulkRefreshMetadata' as const,
      kind: 'book-refresh-metadata',
      action: AuditAction.BookBulkMetadataRefresh,
      one: 'Bulk refreshed metadata for 1 book',
      many: 'Bulk refreshed metadata for 3 books',
    },
    {
      method: 'bulkReExtractCover' as const,
      kind: 'book-re-extract-cover',
      action: AuditAction.BookBulkCoverReextract,
      one: 'Bulk re-extracted covers for 1 book',
      many: 'Bulk re-extracted covers for 3 books',
    },
    {
      method: 'bulkEmbedAudioCover' as const,
      kind: 'book-embed-audio-cover',
      action: AuditAction.BookBulkEmbedAudioCover,
      one: 'Bulk embedded audiobook covers for 1 book',
      many: 'Bulk embedded audiobook covers for 3 books',
    },
  ])('starts a $kind bulk run on the resolved selection and audits the resolved count', async ({ method, kind, action, one, many }) => {
    const { controller, bookService, bulkRuns } = makeController();
    const { reply } = makeReply();
    const user = makeUser();
    const dto = { query: { libraryId: 3 } };
    bookService.resolveSelectionToIds.mockResolvedValue([4, 5, 6]);

    await controller[method](dto as never, user, reply);

    expect(bookService.resolveSelectionToIds).toHaveBeenCalledWith(dto, user, 'editor');
    expect(bulkRuns.startAndStream).toHaveBeenCalledWith(
      reply,
      expect.objectContaining({ kind, subjectIds: [4, 5, 6], actor: user, audit: expect.objectContaining({ action, resource: AuditResource.Book }) }),
    );
    const { audit } = bulkRuns.startAndStream.mock.calls[0]![1] as { audit: { description: (count: number) => string } };
    expect(audit.description(1)).toBe(one);
    expect(audit.description(3)).toBe(many);
  });

  it('passes ignoreCache to a bulk metadata refresh run only when asked', async () => {
    const { controller, bulkRuns } = makeController();
    const user = makeUser();

    await controller.bulkRefreshMetadata({ bookIds: [9], ignoreCache: true }, user, makeReply().reply);
    await controller.bulkRefreshMetadata({ bookIds: [9] }, user, makeReply().reply);

    expect(bulkRuns.startAndStream.mock.calls[0]![1]).toEqual(expect.objectContaining({ options: { ignoreCache: true } }));
    expect(bulkRuns.startAndStream.mock.calls[1]![1]).toEqual(expect.objectContaining({ options: {} }));
  });

  it('forwards explicit reading dates through the bulk status route', async () => {
    const { controller, bookService } = makeController();
    const user = makeUser();
    const dto = { bookIds: [7, 9], status: 'read' as const, startedAt: '2026-01-01', finishedAt: null };
    bookService.resolveSelectionToIds.mockResolvedValue([7, 9]);

    await controller.bulkSetStatus(dto, user);

    expect(bookService.resolveSelectionToIds).toHaveBeenCalledWith(dto, user);
    expect(bookService.bulkSetStatus).toHaveBeenCalledWith([7, 9], dto, user);
  });

  it.each(['bulkRefreshMetadata', 'bulkReExtractCover', 'bulkEmbedAudioCover'] as const)(
    'rejects an unauthorized %s selection before starting SSE',
    async (method) => {
      const { controller, bookService, bulkRuns } = makeController();
      const { reply, raw } = makeReply();
      const user = makeUser();
      const error = new ForbiddenException('Editor access required');
      bookService.resolveSelectionToIds.mockRejectedValue(error);

      await expect(controller[method]({ bookIds: [9] }, user, reply)).rejects.toBe(error);

      expect(bookService.resolveSelectionToIds).toHaveBeenCalledWith({ bookIds: [9] }, user, 'editor');
      expect(bulkRuns.startAndStream).not.toHaveBeenCalled();
      expect(raw.writeHead).not.toHaveBeenCalled();
      expect(raw.write).not.toHaveBeenCalled();
    },
  );

  describe('bulk run streams', () => {
    function makeStreamingController(unfinished = 0) {
      const { controller, bookService } = makeController();
      const registry = new BulkRunHandlerRegistry();
      for (const Handler of [BookRefreshMetadataBulkHandler, BookReExtractCoverBulkHandler, BookEmbedAudioCoverBulkHandler]) {
        new Handler(registry, bookService as never).onModuleInit();
      }
      // Mirrors the repository's atomic check: no row once the account holds `max` unfinished runs.
      const repo = {
        insertWithinLimit: vi.fn((_values: unknown, max: number) => Promise.resolve(unfinished >= max ? null : { id: 'run-1' })),
        findById: vi.fn(),
      };
      const service = new BulkRunsService(
        repo as never,
        registry,
        new BulkRunStreams(),
        { wake: vi.fn() } as never,
        { notify: vi.fn() } as never,
        { emit: vi.fn() } as never,
      );
      (controller as unknown as { bulkRuns: BulkRunsService }).bulkRuns = service;
      return { controller, bookService, repo };
    }

    it.each([
      { method: 'bulkRefreshMetadata' as const, done: { done: true, processed: 0, failed: 0 } },
      { method: 'bulkReExtractCover' as const, done: { done: true, processed: 0, updated: 0 } },
      { method: 'bulkEmbedAudioCover' as const, done: { done: true, processed: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: false } },
    ])('answers an empty $method selection with the empty done event and creates no run', async ({ method, done }) => {
      const { controller, bookService, repo } = makeStreamingController();
      const { reply, raw } = makeReply();
      bookService.resolveSelectionToIds.mockResolvedValue([]);

      await controller[method]({ query: {} } as never, makeUser(), reply);

      expect(raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'text/event-stream' }));
      expect(raw.write).toHaveBeenCalledOnce();
      expect(raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify(done)}\n\n`);
      expect(raw.end).toHaveBeenCalled();
      expect(repo.insertWithinLimit).not.toHaveBeenCalled();
    });

    it.each(['bulkRefreshMetadata', 'bulkReExtractCover', 'bulkEmbedAudioCover'] as const)(
      'answers %s with 429 before the stream when ten runs are unfinished',
      async (method) => {
        const { controller, repo } = makeStreamingController(BULK_RUN_MAX_UNFINISHED);
        const { reply, raw } = makeReply();

        const result = controller[method]({ bookIds: [9] }, makeUser(), reply);

        await expect(result).rejects.toBeInstanceOf(HttpException);
        await expect(result).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
        expect(repo.insertWithinLimit).toHaveBeenCalledOnce();
        await expect(repo.insertWithinLimit.mock.results[0]!.value).resolves.toBeNull();
        expect(raw.writeHead).not.toHaveBeenCalled();
        expect(raw.write).not.toHaveBeenCalled();
      },
    );
  });

  it('embeds the audiobook cover of one book for the calling user', async () => {
    const { controller, bookService } = makeController();
    const user = makeUser();
    bookService.embedAudioCover.mockResolvedValue({ status: 'success', fieldsWritten: ['audioCoverBytes'], durationMs: 4 });

    await expect(controller.embedAudioCover(42, user)).resolves.toEqual({ status: 'success', fieldsWritten: ['audioCoverBytes'], durationMs: 4 });

    expect(bookService.embedAudioCover).toHaveBeenCalledWith(42, user);
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

    await controller.getThumbnail(7, makeUser(), reply, { t: '1234567890' }, undefined);
    expect(headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
  });

  it('throws NotFoundException when thumbnail is missing', async () => {
    const { controller, bookService } = makeController();
    const { reply } = makeReply();
    bookService.getThumbnailPath.mockResolvedValue(null);

    await expect(controller.getThumbnail(7, makeUser(), reply, undefined, undefined)).rejects.toThrow(NotFoundException);
  });

  it('delegates re-extract-cover endpoint to the single-book cover flow', async () => {
    const { controller, bookService } = makeController();
    bookService.reExtractCover.mockResolvedValue({ processed: 1, updated: 1 });
    const user = makeUser();

    await expect(controller.reExtractCover(42, user)).resolves.toEqual({ processed: 1, updated: 1 });

    expect(bookService.reExtractCover).toHaveBeenCalledWith(42, user, undefined);
  });

  it('passes an explicit medium through re-extract-cover', async () => {
    const { controller, bookService } = makeController();
    const user = makeUser();
    bookService.reExtractCover.mockResolvedValue({ processed: 1, updated: 1 });

    await controller.reExtractCover(42, user, { medium: 'audio' });

    expect(bookService.reExtractCover).toHaveBeenCalledWith(42, user, 'audio');
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
      positionSeconds: null,
      mediaOverlayFragment: null,
      mediaOverlaySectionIndex: null,
      koboLocationSource: null,
      koboLocationType: null,
      koboLocationValue: null,
      koboContentSourceProgressPercent: null,
      koreaderProgress: null,
      narrationPercentage: null,
      narrationUpdatedAt: null,
      textUpdatedAt: null,
    });
    expect(bookService.getProgress).toHaveBeenCalledWith(user.id, 9, user);
  });

  it('delegates progress mutation endpoints to service', async () => {
    const { controller, bookService } = makeController();
    const user = makeUser();

    await controller.saveFileProgress(9, { percentage: 25 } as never, user);
    await controller.clearFileProgress(9, user);

    expect(bookService.saveProgress).toHaveBeenCalledWith(user.id, 9, { percentage: 25 }, user);
    expect(bookService.clearFileProgress).toHaveBeenCalledWith(user.id, 9, user);
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
    bookService.getIsbnCandidates.mockResolvedValue({ readable: true, candidates: [] });
    bookService.getKoboState.mockResolvedValue({ eligibleForKoboSync: false, syncCollections: [], readingState: null, snapshots: [] });
    bookService.getDetail.mockResolvedValue({ id: 7, title: 'Detail' });

    await controller.updateMetadata(7, { title: 'New' } as never, user);
    await controller.updateAddedAt(7, { addedAt: '2020-06-15' }, user);
    await controller.updateMetadataAndLocks(7, { metadata: { goodreadsId: '123' }, lockedFields: ['goodreadsId'] } as never, user);
    await controller.bulkSetMetadata({ bookIds: [7, 8], field: 'language', value: 'fr' } as never, user);
    await controller.updateMetadataLocks(7, { lockedFields: ['title'] } as never, user);
    await controller.refreshMetadata(7, 'true', user);
    await controller.getMetadataFromFile(7, user);
    await controller.getIsbnCandidates(7, user);
    await controller.getKoboState(7, user);
    await controller.setReadStatus(7, { status: 'reading' } as never, user);
    await controller.getDetail(7, user);

    expect(bookService.updateMetadata).toHaveBeenCalledWith(7, { title: 'New' }, user, { postSaveMode: 'schedule' });
    expect(bookService.updateAddedAt).toHaveBeenCalledWith(7, { addedAt: '2020-06-15' }, user);
    expect(bookService.updateMetadataAndLocks).toHaveBeenCalledWith(7, { metadata: { goodreadsId: '123' }, lockedFields: ['goodreadsId'] }, user, {
      postSaveMode: 'schedule',
    });
    expect(bookService.bulkSetMetadata).toHaveBeenCalledWith([7, 8], 'language', 'fr', user);
    expect(bookService.updateMetadataLocks).toHaveBeenCalledWith(7, ['title'], user);
    expect(bookService.refreshMetadata).toHaveBeenCalledWith(7, true, user);
    expect(bookService.getMetadataFromFile).toHaveBeenCalledWith(7, user);
    expect(bookService.getIsbnCandidates).toHaveBeenCalledWith(7, user);
    expect(bookService.getKoboState).toHaveBeenCalledWith(7, user);
    expect(bookService.setReadStatus).toHaveBeenCalledWith(7, { status: 'reading' }, user);
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

  it('invokes auditable descriptions for bulk and metadata actions', () => {
    const deleteAudit = Reflect.getMetadata(AUDITABLE_KEY, BookController.prototype.deleteBooks) as {
      getResourceId: (
        req: unknown,
        response: { total: number; books: { id: number; title: string | null }[]; omitted: number },
      ) => number | undefined;
      getMeta: (req: unknown, response: { total: number; books: { id: number; title: string | null }[]; omitted: number }) => Record<string, unknown>;
      description: (req: unknown, response: { total: number; books: { id: number; title: string | null }[]; omitted: number }) => string;
    };
    const embedAudit = Reflect.getMetadata(AUDITABLE_KEY, BookController.prototype.embedAudioCover) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }) => string;
    };
    const bulkSetMetadataAudit = Reflect.getMetadata(AUDITABLE_KEY, BookController.prototype.bulkSetMetadata) as {
      description: (req: { body: { bookIds?: number[]; field?: string } }) => string;
    };
    const updateMetadataAudit = Reflect.getMetadata(AUDITABLE_KEY, BookController.prototype.updateMetadata) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }) => string;
    };
    const updateAddedAtAudit = Reflect.getMetadata(AUDITABLE_KEY, BookController.prototype.updateAddedAt) as {
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
      when: (req: { query?: Record<string, string> }) => boolean;
    };

    const singleDeletion = { total: 1, books: [{ id: 1, title: 'Dune' }], omitted: 0 };
    const bulkDeletion = { total: 2, books: [{ id: 1, title: 'Dune' }], omitted: 1 };
    expect(deleteAudit.description({}, singleDeletion)).toBe('Deleted "Dune" (#1)');
    expect(deleteAudit.description({}, bulkDeletion)).toBe('Deleted 2 books');
    expect(deleteAudit.getResourceId({}, singleDeletion)).toBe(1);
    expect(deleteAudit.getResourceId({}, bulkDeletion)).toBeUndefined();
    expect(deleteAudit.getMeta({}, bulkDeletion)).toEqual(bulkDeletion);
    // The bulk run routes audit once the selection is resolved, so a query selection logs its real count.
    for (const method of ['bulkRefreshMetadata', 'bulkReExtractCover', 'bulkEmbedAudioCover'] as const) {
      expect(Reflect.getMetadata(AUDITABLE_KEY, BookController.prototype[method])).toBeUndefined();
    }
    expect(embedAudit.getResourceId({ params: { id: '42' } })).toBe(42);
    expect(embedAudit.description({ params: { id: '42' } })).toBe('Embedded audiobook cover in read-along EPUB of book #42');
    expect(bulkSetMetadataAudit.description({ body: { bookIds: [1, 2], field: 'language' } })).toBe('Bulk set language for 2 books');
    expect(updateMetadataAudit.getResourceId({ params: { id: '44' } })).toBe(44);
    expect(updateMetadataAudit.description({ params: { id: '44' } })).toBe('Updated metadata for book #44');
    expect(updateAddedAtAudit.getResourceId({ params: { id: '44' } })).toBe(44);
    expect(updateAddedAtAudit.description({ params: { id: '44' } })).toBe('Updated added date for book #44');
    expect(Reflect.getMetadata(PERMISSION_KEY, BookController.prototype.updateAddedAt)).toBe(Permission.LibraryEditMetadata);
    expect(updateMetadataAndLocksAudit.getResourceId({ params: { id: '44' } })).toBe(44);
    expect(updateMetadataAndLocksAudit.description({ params: { id: '44' } })).toBe('Updated metadata and locks for book #44');
    expect(updateLocksAudit.getResourceId({ params: { id: '44' } })).toBe(44);
    expect(updateLocksAudit.description({ params: { id: '44' } })).toBe('Updated metadata locks for book #44');
    expect(refreshAudit.getResourceId({ params: { id: '44' } })).toBe(44);
    expect(refreshAudit.description({ params: { id: '44' } })).toBe('Refreshed metadata for book #44');
    expect(refreshAudit.when({ query: {} })).toBe(true);
    expect(refreshAudit.when({ query: { preview: 'false' } })).toBe(true);
    expect(refreshAudit.when({ query: { preview: 'true' } })).toBe(false);
  });

  it('marks bulk-edit endpoints as demo-restricted', () => {
    const message = 'Demo-restricted account cannot perform bulk edits';
    const bulkMethods = [
      BookController.prototype.bulkRefreshMetadata,
      BookController.prototype.bulkReExtractCover,
      BookController.prototype.bulkEmbedAudioCover,
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

  // Both routes previously verified library access only, so a library editor without delete
  // rights could remove a file from disk, and the web client already assumed otherwise.
  it('gates per-file mutations on the same permissions as the book-level routes', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, BookController.prototype.deleteFile)).toBe(Permission.LibraryDeleteBooks);
    expect(Reflect.getMetadata(PERMISSION_KEY, BookController.prototype.renameFile)).toBe(Permission.LibraryEditMetadata);
  });

  // Progress is the caller's own, so clearing it stays available to every account with access.
  it('leaves per-file progress clearing ungated', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, BookController.prototype.clearFileProgress)).toBeUndefined();
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

  it('requires mutation permissions for per-file rename and delete', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, BookController.prototype.renameFile)).toBe(Permission.LibraryEditMetadata);
    expect(Reflect.getMetadata(PERMISSION_KEY, BookController.prototype.deleteFile)).toBe(Permission.LibraryDeleteBooks);
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
