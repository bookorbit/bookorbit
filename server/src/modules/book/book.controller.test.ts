import { NotFoundException } from '@nestjs/common';
import type { MockedFunction } from 'vitest';
import archiver from 'archiver';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

import type { RequestUser } from '../../common/types/request-user';
import { BookController } from './book.controller';

vi.mock('archiver', () => ({
  __esModule: true,
  default: vi.fn(() => ({
    pipe: vi.fn(),
    file: vi.fn(),
    on: vi.fn().mockReturnThis(),
    abort: vi.fn(),
    finalize: vi.fn().mockResolvedValue(undefined),
  })),
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

function makeController() {
  const bookService = {
    embedAll: vi.fn(),
    deleteBooks: vi.fn(),
    searchAcrossLibraries: vi.fn(),
    globalQuery: vi.fn(),
    bulkRefreshMetadata: vi.fn(),
    bulkReExtractCover: vi.fn(),
    getExportFiles: vi.fn(),
    getCoverPath: vi.fn(),
    getThumbnailPath: vi.fn(),
    getFileInfo: vi.fn(),
    resolveDownloadFilename: vi.fn(),
    getProgress: vi.fn(),
    getBookProgress: vi.fn(),
    saveProgress: vi.fn(),
    updateMetadata: vi.fn(),
    refreshMetadata: vi.fn(),
    verifyBookAccess: vi.fn(),
    getKoboState: vi.fn(),
    getDetail: vi.fn(),
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

    await expect(controller.getCover(7, makeUser(), reply, undefined)).rejects.toThrow(NotFoundException);
  });

  it('returns 304 when cover etag matches', async () => {
    const { controller, bookService } = makeController();
    const { reply } = makeReply();
    bookService.getCoverPath.mockResolvedValue('/tmp/cover.jpg');
    mockStat.mockResolvedValue({ mtimeMs: 1234 } as never);

    await controller.getCover(7, makeUser(), reply, '"1234"');

    expect(reply.status).toHaveBeenCalledWith(304);
    expect(reply.send).toHaveBeenCalled();
    expect(mockCreateReadStream).not.toHaveBeenCalled();
  });

  it('streams cover with computed content type and cache headers', async () => {
    const { controller, bookService } = makeController();
    const { reply, headers } = makeReply();
    bookService.getCoverPath.mockResolvedValue('/tmp/cover.png');
    mockStat.mockResolvedValue({ mtimeMs: 4321 } as never);

    await controller.getCover(7, makeUser(), reply, undefined);

    expect(headers['Cache-Control']).toBe('no-cache');
    expect(headers['ETag']).toBe('"4321"');
    expect(reply.type).toHaveBeenCalledWith('image/png');
    expect(mockCreateReadStream).toHaveBeenCalledWith('/tmp/cover.png');
    expect(reply.send).toHaveBeenCalled();
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

    await controller.serveFile(1, makeUser(), undefined, '1', reply);

    expect(headers['Accept-Ranges']).toBe('bytes');
    expect(headers['Content-Disposition']).toBe(`attachment; filename="caf_.epub"; filename*=UTF-8''caf%C3%A9.epub`);
    expect(reply.type).toHaveBeenCalledWith('application/epub+zip');
    expect(mockCreateReadStream).toHaveBeenCalledWith('/tmp/book.epub');
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

    await controller.serveFile(1, makeUser(), 'bytes=10-19', undefined, reply);

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

    await controller.serveFile(1, makeUser(), 'bytes=120-130', undefined, reply);

    expect(reply.status).toHaveBeenCalledWith(416);
    expect(headers['Content-Range']).toBe('bytes */100');
    expect(mockCreateReadStream).not.toHaveBeenCalled();
  });

  it('streams server-sent events for bulk metadata refresh progress', async () => {
    const { controller, bookService } = makeController();
    const { reply, raw } = makeReply();
    bookService.bulkRefreshMetadata.mockImplementation(
      (_bookIds: number[], _user: RequestUser, onProgress: (bookId: number) => void, options?: { isCancelled?: () => boolean }) => {
        expect(options?.isCancelled?.()).toBe(false);
        onProgress(9);
        return Promise.resolve({ processed: 1, failed: 0 });
      },
    );

    await controller.bulkRefreshMetadata({ bookIds: [9] }, makeUser(), reply);

    expect(raw.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    expect(raw.write).toHaveBeenNthCalledWith(1, `data: ${JSON.stringify({ bookId: 9 })}\n\n`);
    expect(raw.write).toHaveBeenNthCalledWith(2, `data: ${JSON.stringify({ done: true, processed: 1, failed: 0 })}\n\n`);
    expect(raw.end).toHaveBeenCalled();
  });

  it('stops sending SSE done event when client disconnects', async () => {
    const { controller, bookService } = makeController();
    const { reply, raw, emitRawEvent } = makeReply();
    bookService.bulkRefreshMetadata.mockImplementation((_bookIds: number[], _user: RequestUser, onProgress: (bookId: number) => void) => {
      onProgress(9);
      emitRawEvent('close');
      return Promise.resolve({ processed: 1, failed: 0 });
    });

    await controller.bulkRefreshMetadata({ bookIds: [9] }, makeUser(), reply);

    expect(raw.write).toHaveBeenCalledTimes(1);
    expect(raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ bookId: 9 })}\n\n`);
    expect(raw.end).not.toHaveBeenCalled();
  });

  it('archives exported files into a zip stream', async () => {
    const { controller, bookService } = makeController();
    const { reply, raw } = makeReply();
    bookService.getExportFiles.mockResolvedValue([
      { absolutePath: '/books/a.epub', zipPath: 'A.epub' },
      { absolutePath: '/books/b.epub', zipPath: 'B.epub' },
    ]);

    await controller.exportBooks({ bookIds: [1, 2], allFormats: false }, makeUser(), reply);

    expect(raw.setHeader).toHaveBeenCalledWith('Content-Type', 'application/zip');
    expect(raw.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="books.zip"');

    const archiverMock = archiver as unknown as vi.Mock;
    expect(archiverMock).toHaveBeenCalledWith('zip', { zlib: { level: 0 } });
    const archive = archiverMock.mock.results[0].value;

    expect(archive.pipe).toHaveBeenCalledWith(raw);
    expect(archive.file).toHaveBeenCalledWith('/books/a.epub', { name: 'A.epub' });
    expect(archive.file).toHaveBeenCalledWith('/books/b.epub', { name: 'B.epub' });
    expect(archive.finalize).toHaveBeenCalled();
  });

  it('aborts archive export and swallows finalize errors after client disconnect', async () => {
    const { controller, bookService } = makeController();
    const { reply, emitRawEvent } = makeReply();
    bookService.getExportFiles.mockResolvedValue([{ absolutePath: '/books/a.epub', zipPath: 'A.epub' }]);
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
    (archiver as unknown as vi.Mock).mockReturnValueOnce(archive);

    await expect(controller.exportBooks({ bookIds: [1], allFormats: false }, makeUser(), reply)).resolves.toBeUndefined();
    expect(archive.abort).toHaveBeenCalled();
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
});
