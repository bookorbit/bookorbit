vi.mock('fs/promises', () => ({
  stat: vi.fn(),
}));

vi.mock('fs', () => ({
  createReadStream: vi.fn(),
}));

import { NotFoundException } from '@nestjs/common';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

import { KoboDownloadService } from './kobo-download.service';

const statMock = vi.mocked(stat);
const createReadStreamMock = vi.mocked(createReadStream);

function makeReply() {
  return {
    header: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

function makeDeps() {
  return {
    db: {
      query: {
        books: { findFirst: vi.fn() },
        bookFiles: { findFirst: vi.fn() },
      },
    },
    kepubConversionService: { getKepubPath: vi.fn() },
    settingsService: { getSettings: vi.fn() },
    bookAccessService: { assertBookAccessible: vi.fn() },
  };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new KoboDownloadService(
    deps.db as never,
    deps.kepubConversionService as never,
    deps.settingsService as never,
    deps.bookAccessService as never,
  );
}

describe('KoboDownloadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when target book does not exist', async () => {
    const deps = makeDeps();
    deps.db.query.books.findFirst.mockResolvedValue(null);
    const service = makeService(deps);

    await expect(service.streamBook(7, 11, makeReply() as never)).rejects.toThrow(NotFoundException);
  });

  it('throws when book file is missing after access check', async () => {
    const deps = makeDeps();
    deps.db.query.books.findFirst.mockResolvedValue({ id: 11, primaryFileId: 22 });
    deps.db.query.bookFiles.findFirst.mockResolvedValue(null);
    deps.bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
    const service = makeService(deps);

    await expect(service.streamBook(7, 11, makeReply() as never)).rejects.toThrow('No file found for this book');
    expect(deps.bookAccessService.assertBookAccessible).toHaveBeenCalledWith(7, 11);
  });

  it('uses direct file streaming for pdf files', async () => {
    const deps = makeDeps();
    deps.db.query.books.findFirst.mockResolvedValue({ id: 11, primaryFileId: 22 });
    deps.db.query.bookFiles.findFirst.mockResolvedValue({
      id: 22,
      format: 'pdf',
      absolutePath: '/books/file.pdf',
      fileHash: 'hash',
      sizeBytes: 100,
    });
    deps.bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
    const service = makeService(deps);
    const streamFileSpy = vi.spyOn(service as any, 'streamFile').mockResolvedValue(undefined);

    await service.streamBook(7, 11, makeReply() as never);

    expect(streamFileSpy).toHaveBeenCalledWith('/books/file.pdf', 22, 'pdf', expect.anything());
  });

  it('streams native kepub files without conversion', async () => {
    const deps = makeDeps();
    deps.db.query.books.findFirst.mockResolvedValue({ id: 11, primaryFileId: 22 });
    deps.db.query.bookFiles.findFirst.mockResolvedValue({
      id: 22,
      format: 'kepub',
      absolutePath: '/books/file.kepub.epub',
      fileHash: 'h1',
      sizeBytes: 5 * 1024 * 1024,
    });
    deps.bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
    const service = makeService(deps);
    const streamFileSpy = vi.spyOn(service as any, 'streamFile').mockResolvedValue(undefined);

    await service.streamBook(7, 11, makeReply() as never);

    expect(streamFileSpy).toHaveBeenCalledWith('/books/file.kepub.epub', 22, 'kepub.epub', expect.anything());
    expect(deps.settingsService.getSettings).not.toHaveBeenCalled();
    expect(deps.kepubConversionService.getKepubPath).not.toHaveBeenCalled();
  });

  it('converts epub to kepub when enabled and within conversion size limit', async () => {
    const deps = makeDeps();
    deps.db.query.books.findFirst.mockResolvedValue({ id: 11, primaryFileId: 22 });
    deps.db.query.bookFiles.findFirst.mockResolvedValue({
      id: 22,
      format: 'epub',
      absolutePath: '/books/file.epub',
      fileHash: 'h1',
      sizeBytes: 5 * 1024 * 1024,
    });
    deps.bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
    deps.settingsService.getSettings.mockResolvedValue({
      convertToKepub: true,
      forceEnableHyphenation: true,
      kepubConversionLimitMb: 10,
      twoWayProgressSync: false,
    });
    const service = makeService(deps);
    const streamKepubSpy = vi.spyOn(service as any, 'streamKepub').mockResolvedValue(undefined);

    await service.streamBook(7, 11, makeReply() as never);

    expect(streamKepubSpy).toHaveBeenCalledWith('/books/file.epub', 'h1', 11, 22, true, expect.anything());
  });

  it('falls back to epub stream when conversion is disabled or over limit', async () => {
    const deps = makeDeps();
    deps.db.query.books.findFirst.mockResolvedValue({ id: 11, primaryFileId: 22 });
    deps.db.query.bookFiles.findFirst.mockResolvedValue({
      id: 22,
      format: 'epub',
      absolutePath: '/books/file.epub',
      fileHash: null,
      sizeBytes: 20 * 1024 * 1024,
    });
    deps.bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
    deps.settingsService.getSettings.mockResolvedValue({
      convertToKepub: true,
      forceEnableHyphenation: false,
      kepubConversionLimitMb: 10,
      twoWayProgressSync: false,
    });
    const service = makeService(deps);
    const streamFileSpy = vi.spyOn(service as any, 'streamFile').mockResolvedValue(undefined);

    await service.streamBook(7, 11, makeReply() as never);

    expect(streamFileSpy).toHaveBeenCalledWith('/books/file.epub', 22, 'epub', expect.anything());
  });

  it('streamFile writes headers and stream payload and throws when source path is missing', async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    const reply = makeReply();
    const stream = {} as never;
    statMock.mockResolvedValueOnce({ size: 1234 } as never);
    createReadStreamMock.mockReturnValue(stream);

    await (service as any).streamFile('/books/book.epub', 99, 'epub', reply);

    expect(reply.header).toHaveBeenCalledWith('Content-Length', 1234);
    expect(reply.header).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="book-99.epub"');
    expect(reply.type).toHaveBeenCalledWith('application/epub+zip');
    expect(reply.send).toHaveBeenCalledWith(stream);

    statMock.mockRejectedValueOnce(new Error('missing'));
    await expect((service as any).streamFile('/books/missing.epub', 99, 'epub', reply)).rejects.toThrow(NotFoundException);
  });

  it('streamFile uses application/epub+zip for kepub.epub format', async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    const reply = makeReply();
    statMock.mockResolvedValueOnce({ size: 4096 } as never);
    createReadStreamMock.mockReturnValue({} as never);

    await (service as any).streamFile('/cache/44/hash.kepub.epub', 55, 'kepub.epub', reply);

    expect(reply.type).toHaveBeenCalledWith('application/epub+zip');
    expect(reply.header).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="book-55.kepub.epub"');
  });

  it('streamFile falls back to application/octet-stream for unknown formats', async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    const reply = makeReply();
    statMock.mockResolvedValueOnce({ size: 100 } as never);
    createReadStreamMock.mockReturnValue({} as never);

    await (service as any).streamFile('/books/book.xyz', 10, 'xyz', reply);

    expect(reply.type).toHaveBeenCalledWith('application/octet-stream');
  });

  it('streamKepub streams the shared conversion path', async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    deps.kepubConversionService.getKepubPath.mockResolvedValue('/app-data/.kepub-cache/44/abc.kepub.epub');
    const streamFileSpy = vi.spyOn(service as any, 'streamFile').mockResolvedValue(undefined);

    await (service as any).streamKepub('/books/source.epub', 'abc', 44, 55, false, makeReply());

    expect(deps.kepubConversionService.getKepubPath).toHaveBeenCalledWith({
      sourcePath: '/books/source.epub',
      fileHash: 'abc',
      bookId: 44,
      hyphenate: false,
    });
    expect(streamFileSpy).toHaveBeenCalledWith('/app-data/.kepub-cache/44/abc.kepub.epub', 55, 'kepub.epub', expect.anything());
  });

  it('streamKepub falls back when conversion fails', async () => {
    const deps = makeDeps();
    deps.kepubConversionService.getKepubPath.mockRejectedValue(new Error('convert failed'));
    const service = makeService(deps);
    const streamFileSpy = vi.spyOn(service as any, 'streamFile').mockResolvedValue(undefined);

    await (service as any).streamKepub('/books/source.epub', 'hash', 44, 55, false, makeReply());

    expect(streamFileSpy).toHaveBeenLastCalledWith('/books/source.epub', 55, 'epub', expect.anything());
  });
});
