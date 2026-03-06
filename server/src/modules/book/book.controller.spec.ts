import { NotFoundException } from '@nestjs/common';
import archiver from 'archiver';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

import type { RequestUser } from '../../common/types/request-user';
import { BookController } from './book.controller';

jest.mock('archiver', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    pipe: jest.fn(),
    file: jest.fn(),
    finalize: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    createReadStream: jest.fn(() => ({ stream: true })),
  };
});

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return {
    ...actual,
    stat: jest.fn(),
  };
});

const mockStat = stat as jest.MockedFunction<typeof stat>;
const mockCreateReadStream = createReadStream as jest.MockedFunction<typeof createReadStream>;

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
    roles: [],
  };
}

function makeReply() {
  const headers: Record<string, unknown> = {};
  const raw = {
    setHeader: jest.fn((key: string, value: unknown) => {
      headers[key] = value;
    }),
    writeHead: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  };

  const reply = {
    raw,
    status: jest.fn(),
    header: jest.fn(),
    type: jest.fn(),
    send: jest.fn(),
  };

  reply.status.mockImplementation(() => reply as never);
  reply.header.mockImplementation((key: string, value: unknown) => {
    headers[key] = value;
    return reply as never;
  });
  reply.type.mockImplementation(() => reply as never);
  reply.send.mockImplementation(() => reply as never);

  return { reply: reply as never, raw, headers };
}

function makeController() {
  const bookService = {
    embedAll: jest.fn(),
    deleteBooks: jest.fn(),
    searchAcrossLibraries: jest.fn(),
    globalQuery: jest.fn(),
    bulkRefreshMetadata: jest.fn(),
    bulkReExtractCover: jest.fn(),
    getExportFiles: jest.fn(),
    getCoverPath: jest.fn(),
    getThumbnailPath: jest.fn(),
    getFileInfo: jest.fn(),
    resolveDownloadFilename: jest.fn(),
    getProgress: jest.fn(),
    saveProgress: jest.fn(),
    updateMetadata: jest.fn(),
    refreshMetadata: jest.fn(),
    verifyBookAccess: jest.fn(),
    getKoboState: jest.fn(),
    getDetail: jest.fn(),
  };
  const fileWriteRepo = {
    findWriteLog: jest.fn(),
  };

  return {
    controller: new BookController(bookService as never, fileWriteRepo as never),
    bookService,
    fileWriteRepo,
  };
}

describe('BookController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    bookService.bulkRefreshMetadata.mockImplementation(async (_bookIds: number[], _user: RequestUser, onProgress: (bookId: number) => void) => {
      onProgress(9);
      return { processed: 1, failed: 0 };
    });

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

    const archiverMock = archiver as unknown as jest.Mock;
    expect(archiverMock).toHaveBeenCalledWith('zip', { zlib: { level: 0 } });
    const archive = archiverMock.mock.results[0].value;

    expect(archive.pipe).toHaveBeenCalledWith(raw);
    expect(archive.file).toHaveBeenCalledWith('/books/a.epub', { name: 'A.epub' });
    expect(archive.file).toHaveBeenCalledWith('/books/b.epub', { name: 'B.epub' });
    expect(archive.finalize).toHaveBeenCalled();
  });

  it('verifies access before returning file write log entries', async () => {
    const { controller, bookService, fileWriteRepo } = makeController();
    bookService.verifyBookAccess.mockResolvedValue(undefined);
    fileWriteRepo.findWriteLog.mockResolvedValue([{ id: 1 }]);

    const result = await controller.getWriteLog(12, makeUser());

    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(12, expect.any(Object));
    expect(result).toEqual({ entries: [{ id: 1 }] });
  });
});
