vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('fs', () => ({
  createReadStream: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

import { NotFoundException } from '@nestjs/common';
import { execFile } from 'child_process';
import { createReadStream } from 'fs';
import { mkdir, stat } from 'fs/promises';

import { KoboDownloadService } from './kobo-download.service';

const statMock = vi.mocked(stat);
const mkdirMock = vi.mocked(mkdir);
const createReadStreamMock = vi.mocked(createReadStream);
const execFileMock = vi.mocked(execFile);

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
    config: { get: vi.fn().mockReturnValue('/app-data') },
    kepubifyBinaryService: { getBinaryPath: vi.fn() },
    settingsService: { getSettings: vi.fn() },
    bookAccessService: { assertBookAccessible: vi.fn() },
  };
}

describe('KoboDownloadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when target book does not exist', async () => {
    const deps = makeDeps();
    deps.db.query.books.findFirst.mockResolvedValue(null);
    const service = new KoboDownloadService(
      deps.db as never,
      deps.config as never,
      deps.kepubifyBinaryService as never,
      deps.settingsService as never,
      deps.bookAccessService as never,
    );

    await expect(service.streamBook(7, 11, makeReply() as never)).rejects.toThrow(NotFoundException);
  });

  it('throws when book file is missing after access check', async () => {
    const deps = makeDeps();
    deps.db.query.books.findFirst.mockResolvedValue({ id: 11, primaryFileId: 22 });
    deps.db.query.bookFiles.findFirst.mockResolvedValue(null);
    deps.bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
    const service = new KoboDownloadService(
      deps.db as never,
      deps.config as never,
      deps.kepubifyBinaryService as never,
      deps.settingsService as never,
      deps.bookAccessService as never,
    );

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
      hash: 'hash',
      sizeBytes: 100,
    });
    deps.bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
    const service = new KoboDownloadService(
      deps.db as never,
      deps.config as never,
      deps.kepubifyBinaryService as never,
      deps.settingsService as never,
      deps.bookAccessService as never,
    );
    const streamFileSpy = vi.spyOn(service as any, 'streamFile').mockResolvedValue(undefined);

    await service.streamBook(7, 11, makeReply() as never);

    expect(streamFileSpy).toHaveBeenCalledWith('/books/file.pdf', 22, 'pdf', expect.anything());
  });

  it('converts epub to kepub when enabled and within conversion size limit', async () => {
    const deps = makeDeps();
    deps.db.query.books.findFirst.mockResolvedValue({ id: 11, primaryFileId: 22 });
    deps.db.query.bookFiles.findFirst.mockResolvedValue({
      id: 22,
      format: 'epub',
      absolutePath: '/books/file.epub',
      hash: 'h1',
      sizeBytes: 5 * 1024 * 1024,
    });
    deps.bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
    deps.settingsService.getSettings.mockResolvedValue({
      convertToKepub: true,
      forceEnableHyphenation: true,
      kepubConversionLimitMb: 10,
    });
    const service = new KoboDownloadService(
      deps.db as never,
      deps.config as never,
      deps.kepubifyBinaryService as never,
      deps.settingsService as never,
      deps.bookAccessService as never,
    );
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
      hash: null,
      sizeBytes: 20 * 1024 * 1024,
    });
    deps.bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
    deps.settingsService.getSettings.mockResolvedValue({
      convertToKepub: true,
      forceEnableHyphenation: false,
      kepubConversionLimitMb: 10,
    });
    const service = new KoboDownloadService(
      deps.db as never,
      deps.config as never,
      deps.kepubifyBinaryService as never,
      deps.settingsService as never,
      deps.bookAccessService as never,
    );
    const streamFileSpy = vi.spyOn(service as any, 'streamFile').mockResolvedValue(undefined);

    await service.streamBook(7, 11, makeReply() as never);

    expect(streamFileSpy).toHaveBeenCalledWith('/books/file.epub', 22, 'epub', expect.anything());
  });

  it('streamFile writes headers and stream payload and throws when source path is missing', async () => {
    const deps = makeDeps();
    const service = new KoboDownloadService(
      deps.db as never,
      deps.config as never,
      deps.kepubifyBinaryService as never,
      deps.settingsService as never,
      deps.bookAccessService as never,
    );
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

  it('streamKepub serves cached files when present', async () => {
    const deps = makeDeps();
    const service = new KoboDownloadService(
      deps.db as never,
      deps.config as never,
      deps.kepubifyBinaryService as never,
      deps.settingsService as never,
      deps.bookAccessService as never,
    );
    statMock.mockResolvedValueOnce({} as never);
    const streamFileSpy = vi.spyOn(service as any, 'streamFile').mockResolvedValue(undefined);

    await (service as any).streamKepub('/books/source.epub', 'abc', 44, 55, false, makeReply());

    expect(streamFileSpy).toHaveBeenCalledWith('/app-data/.kepub-cache/44/abc.kepub.epub', 55, 'kepub.epub', expect.anything());
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('streamKepub converts and caches on miss, then falls back when conversion fails', async () => {
    const deps = makeDeps();
    deps.kepubifyBinaryService.getBinaryPath.mockResolvedValue('/tools/kepubify');
    const service = new KoboDownloadService(
      deps.db as never,
      deps.config as never,
      deps.kepubifyBinaryService as never,
      deps.settingsService as never,
      deps.bookAccessService as never,
    );
    const streamFileSpy = vi.spyOn(service as any, 'streamFile').mockResolvedValue(undefined);

    statMock.mockRejectedValueOnce(new Error('cache miss'));
    execFileMock.mockImplementation((_path, _args, cb) => cb?.(null, '', ''));

    await (service as any).streamKepub('/books/source.epub', 'hash', 44, 55, true, makeReply());

    expect(mkdirMock).toHaveBeenCalledWith('/app-data/.kepub-cache/44', { recursive: true });
    expect(execFileMock).toHaveBeenCalledWith(
      '/tools/kepubify',
      ['--hyphenate', '--output', '/app-data/.kepub-cache/44/hash-hyph.kepub.epub', '/books/source.epub'],
      expect.any(Function),
    );
    expect(streamFileSpy).toHaveBeenCalledWith('/app-data/.kepub-cache/44/hash-hyph.kepub.epub', 55, 'kepub.epub', expect.anything());

    statMock.mockRejectedValueOnce(new Error('cache miss'));
    execFileMock.mockImplementationOnce((_path, _args, cb) => cb?.(new Error('convert failed')));
    await (service as any).streamKepub('/books/source.epub', 'hash', 44, 55, false, makeReply());
    expect(streamFileSpy).toHaveBeenLastCalledWith('/books/source.epub', 55, 'epub', expect.anything());
  });
});
