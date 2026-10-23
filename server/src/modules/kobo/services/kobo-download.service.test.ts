vi.mock('fs/promises', () => ({ open: vi.fn(), stat: vi.fn(), mkdtemp: vi.fn(), rm: vi.fn() }));
vi.mock('fs', () => ({ createReadStream: vi.fn() }));
vi.mock('../../../common/utils/file-hash.utils', () => ({ computeFileHashFromHandle: vi.fn() }));

import { ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitter } from 'events';
import { createReadStream } from 'fs';
import { mkdtemp, open, rm, stat } from 'fs/promises';

import { computeFileHashFromHandle } from '../../../common/utils/file-hash.utils';
import { AudiolessEpubService } from '../../book/audioless-epub.service';
import { KoboDownloadRepository } from '../kobo-download.repository';
import { KoboBookAccessService } from './kobo-book-access.service';
import { KepubConversionService } from './kepub-conversion.service';
import { KoboSettingsService } from './kobo-settings.service';
import { KoboDownloadHashRegistrationService } from './kobo-download-hash-registration.service';
import { KoboDownloadService } from './kobo-download.service';

const DELIVERED_HASH = 'a'.repeat(32);
const ORIGINAL_HASH = 'b'.repeat(32);
const TEMP_DIR = '/runtime-temp/kobo-download';
const SOURCE = '/books/source.epub';
const CONVERTED = '/app-data/.kepub-cache/11/converted.kepub.epub';
const STRIPPED = `${TEMP_DIR}/book.epub`;
const SOURCE_FILE = {
  id: 22,
  format: 'epub',
  absolutePath: SOURCE,
  fileHash: ORIGINAL_HASH,
  sizeBytes: 5 * 1024 * 1024,
  mediaOverlayAvailable: false,
};
const statMock = vi.mocked(stat);
const openMock = vi.mocked(open);
const hashMock = vi.mocked(computeFileHashFromHandle);
const readStreamMock = vi.mocked(createReadStream);

function makeDeps() {
  return {
    repository: {
      findBook: vi.fn().mockResolvedValue({ id: 11, primaryFileId: 22 }),
      findPrimaryFile: vi.fn().mockResolvedValue(SOURCE_FILE),
      registerDeliveredHash: vi.fn().mockResolvedValue(undefined),
    },
    conversion: { getKepubPath: vi.fn().mockResolvedValue(CONVERTED) },
    settings: { getSettings: vi.fn().mockResolvedValue({ convertToKepub: true, forceEnableHyphenation: false, kepubConversionLimitMb: 10 }) },
    access: { assertBookAccessible: vi.fn().mockResolvedValue(undefined) },
    audioless: { writeArchive: vi.fn().mockResolvedValue({ removedEntries: 9, sanitizedEntries: 9 }) },
  };
}

function makeReply() {
  return { header: vi.fn().mockReturnThis(), type: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function errno(code: string) {
  return Object.assign(new Error('Filesystem operation failed'), { code });
}

describe('KoboDownloadService', () => {
  let deps: ReturnType<typeof makeDeps>;
  let service: KoboDownloadService;
  let reply: ReturnType<typeof makeReply>;
  let stream: EventEmitter & { destroy: ReturnType<typeof vi.fn> };
  let handle: { stat: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; createReadStream: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.resetAllMocks();
    deps = makeDeps();
    reply = makeReply();
    stream = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    handle = {
      stat: vi.fn().mockImplementation(() => statMock('' as never)),
      close: vi.fn().mockResolvedValue(undefined),
      createReadStream: vi.fn().mockImplementation(() => readStreamMock(openMock.mock.calls.at(-1)![0] as never)),
    };
    openMock.mockResolvedValue(handle as never);
    statMock.mockResolvedValue({ size: 4096 } as never);
    hashMock.mockResolvedValue(DELIVERED_HASH);
    vi.mocked(mkdtemp).mockResolvedValue(TEMP_DIR as never);
    vi.mocked(rm).mockResolvedValue(undefined);
    readStreamMock.mockReturnValue(stream as never);
    const module = await Test.createTestingModule({
      providers: [
        KoboDownloadService,
        { provide: KoboDownloadRepository, useValue: deps.repository },
        { provide: KoboDownloadHashRegistrationService, useValue: { record: deps.repository.registerDeliveredHash } },
        { provide: KepubConversionService, useValue: deps.conversion },
        { provide: KoboSettingsService, useValue: deps.settings },
        { provide: KoboBookAccessService, useValue: deps.access },
        { provide: AudiolessEpubService, useValue: deps.audioless },
      ],
    }).compile();
    service = module.get(KoboDownloadService);
  });

  function setFile(patch: Record<string, unknown>) {
    deps.repository.findPrimaryFile.mockResolvedValue({ ...SOURCE_FILE, ...patch });
  }

  // Every delivery branch runs the public method with real preparation/streaming logic.
  it.each([
    { name: 'PDF', format: 'pdf', path: '/books/source.pdf', conversion: false, mime: 'application/pdf', extension: 'pdf' },
    {
      name: 'native KEPUB',
      format: 'kepub',
      path: '/books/source.kepub.epub',
      conversion: false,
      mime: 'application/epub+zip',
      extension: 'kepub.epub',
    },
    { name: 'converted EPUB', format: 'epub', path: SOURCE, conversion: true, mime: 'application/epub+zip', extension: 'kepub.epub' },
    { name: 'unknown format', format: 'other', path: '/books/source.other', conversion: false, mime: 'application/octet-stream', extension: 'other' },
    { name: 'uppercase EPUB', format: 'EPUB', path: SOURCE, conversion: true, mime: 'application/epub+zip', extension: 'kepub.epub' },
    { name: 'missing stored format', format: null, path: SOURCE, conversion: true, mime: 'application/epub+zip', extension: 'kepub.epub' },
  ])('registers the delivered bytes for $name', async ({ format, path, conversion, mime, extension }) => {
    setFile({ format, absolutePath: path });
    await service.streamBook(7, 11, reply as never);
    const deliveredPath = conversion ? CONVERTED : path;
    expect(openMock).toHaveBeenCalledExactlyOnceWith(deliveredPath, 'r');
    expect(hashMock).toHaveBeenCalledExactlyOnceWith(handle);
    expect(handle.createReadStream).toHaveBeenCalledWith({ start: 0 });
    expect(deps.repository.registerDeliveredHash).toHaveBeenCalledExactlyOnceWith(22, DELIVERED_HASH);
    expect(readStreamMock).toHaveBeenCalledExactlyOnceWith(deliveredPath);
    expect(reply.send).toHaveBeenCalledWith(stream);
    expect(reply.type).toHaveBeenCalledWith(mime);
    expect(reply.header).toHaveBeenCalledWith('Content-Length', 4096);
    expect(reply.header).toHaveBeenCalledWith('Content-Disposition', `attachment; filename="book-22.${extension}"`);
    expect(deps.conversion.getKepubPath).toHaveBeenCalledTimes(conversion ? 1 : 0);
  });

  it.each([
    { name: 'conversion disabled', settings: { convertToKepub: false }, size: 1024 },
    { name: 'over size limit', settings: { convertToKepub: true }, size: 11 * 1024 * 1024 },
  ])('registers an original EPUB when $name', async ({ settings, size }) => {
    deps.settings.getSettings.mockResolvedValue({ forceEnableHyphenation: false, kepubConversionLimitMb: 10, ...settings });
    setFile({ sizeBytes: size });
    await service.streamBook(7, 11, reply as never);
    expect(deps.conversion.getKepubPath).not.toHaveBeenCalled();
    expect(openMock).toHaveBeenCalledWith(SOURCE, 'r');
    expect(deps.repository.registerDeliveredHash).toHaveBeenCalledWith(22, DELIVERED_HASH);
    expect(readStreamMock).toHaveBeenCalledWith(SOURCE);
  });

  it.each([10 * 1024 * 1024, 0, null])('converts at the exact limit or without a known size (%s)', async (sizeBytes) => {
    setFile({ sizeBytes });
    await service.streamBook(7, 11, reply as never);
    expect(openMock).toHaveBeenCalledWith(CONVERTED, 'r');
  });

  it('passes original source identity and hyphenation to conversion but registers the resulting identity', async () => {
    deps.settings.getSettings.mockResolvedValue({ convertToKepub: true, forceEnableHyphenation: true, kepubConversionLimitMb: 10 });
    await service.streamBook(7, 11, reply as never);
    expect(deps.conversion.getKepubPath).toHaveBeenCalledWith({
      sourcePath: SOURCE,
      fileHash: ORIGINAL_HASH,
      bookId: 11,
      hyphenate: true,
      audioless: false,
    });
    expect(deps.repository.registerDeliveredHash).not.toHaveBeenCalledWith(22, ORIGINAL_HASH);
  });

  it('registers each cached delivery, including a different authorized user', async () => {
    await service.streamBook(7, 11, reply as never);
    await service.streamBook(8, 11, makeReply() as never);
    expect(deps.access.assertBookAccessible.mock.calls).toEqual([
      [7, 11],
      [8, 11],
    ]);
    expect(openMock.mock.calls).toEqual([
      [CONVERTED, 'r'],
      [CONVERTED, 'r'],
    ]);
    expect(deps.repository.registerDeliveredHash.mock.calls).toEqual([
      [22, DELIVERED_HASH],
      [22, DELIVERED_HASH],
    ]);
  });

  it('uses a nohash conversion key without confusing it with the delivered hash', async () => {
    setFile({ fileHash: null });
    await service.streamBook(7, 11, reply as never);
    expect(deps.conversion.getKepubPath).toHaveBeenCalledWith(expect.objectContaining({ fileHash: 'nohash' }));
    expect(deps.repository.registerDeliveredHash).toHaveBeenCalledWith(22, DELIVERED_HASH);
  });

  it.each([
    { name: 'conversion succeeds', enabled: true, oversized: false, failed: false, path: CONVERTED },
    { name: 'conversion disabled', enabled: false, oversized: false, failed: false, path: STRIPPED },
    { name: 'stripped copy over limit', enabled: true, oversized: true, failed: false, path: STRIPPED },
    { name: 'conversion fails', enabled: true, oversized: false, failed: true, path: STRIPPED },
  ])('registers the final narration-free file when $name', async ({ enabled, oversized, failed, path }) => {
    setFile({ mediaOverlayAvailable: true, sizeBytes: 1500 * 1024 * 1024 });
    deps.settings.getSettings.mockResolvedValue({ convertToKepub: enabled, forceEnableHyphenation: false, kepubConversionLimitMb: 10 });
    statMock.mockResolvedValueOnce({ size: (oversized ? 11 : 2) * 1024 * 1024 } as never);
    if (failed) deps.conversion.getKepubPath.mockRejectedValue(new Error('Conversion failed'));
    await service.streamBook(7, 11, reply as never);
    expect(deps.audioless.writeArchive).toHaveBeenCalledWith(SOURCE, STRIPPED);
    expect(openMock).toHaveBeenCalledExactlyOnceWith(path, 'r');
    expect(readStreamMock).toHaveBeenCalledWith(path);
    expect(deps.repository.registerDeliveredHash).toHaveBeenCalledWith(22, DELIVERED_HASH);
    expect(rm).not.toHaveBeenCalled();
    stream.emit('close');
    expect(rm).toHaveBeenCalledExactlyOnceWith(TEMP_DIR, { recursive: true, force: true });
    if (enabled && !oversized)
      expect(deps.conversion.getKepubPath).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: STRIPPED, audioless: true }));
  });

  it.each([false, true])('falls back safely when narration stripping fails (conversion=%s)', async (convertToKepub) => {
    setFile({ mediaOverlayAvailable: true });
    deps.settings.getSettings.mockResolvedValue({ convertToKepub, forceEnableHyphenation: false, kepubConversionLimitMb: 10 });
    deps.audioless.writeArchive.mockRejectedValue(new Error('Invalid archive'));
    await service.streamBook(7, 11, reply as never);
    expect(rm).toHaveBeenCalledExactlyOnceWith(TEMP_DIR, { recursive: true, force: true });
    expect(openMock).toHaveBeenCalledWith(convertToKepub ? CONVERTED : SOURCE, 'r');
    if (convertToKepub) expect(deps.conversion.getKepubPath).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: SOURCE, audioless: false }));
    stream.emit('close');
    expect(rm).toHaveBeenCalledTimes(1);
  });

  it('registers the actual original EPUB if both transformations fail', async () => {
    setFile({ mediaOverlayAvailable: true });
    deps.audioless.writeArchive.mockRejectedValue(new Error('Invalid archive'));
    deps.conversion.getKepubPath.mockRejectedValue(new Error('Conversion failed'));
    await service.streamBook(7, 11, reply as never);
    expect(openMock).toHaveBeenCalledExactlyOnceWith(SOURCE, 'r');
    expect(readStreamMock).toHaveBeenCalledWith(SOURCE);
  });

  it('does not prepare or register a book that is missing', async () => {
    deps.repository.findBook.mockResolvedValue(undefined);
    await expect(service.streamBook(7, 11, reply as never)).rejects.toThrow(NotFoundException);
    expect(deps.access.assertBookAccessible).not.toHaveBeenCalled();
    expect(deps.repository.findPrimaryFile).not.toHaveBeenCalled();
    expect(hashMock).not.toHaveBeenCalled();
  });

  it('does not inspect, convert, hash or register an inaccessible book', async () => {
    deps.access.assertBookAccessible.mockRejectedValue(new ForbiddenException());
    await expect(service.streamBook(7, 11, reply as never)).rejects.toThrow(ForbiddenException);
    expect(deps.repository.findPrimaryFile).not.toHaveBeenCalled();
    expect(deps.conversion.getKepubPath).not.toHaveBeenCalled();
    expect(hashMock).not.toHaveBeenCalled();
    expect(deps.repository.registerDeliveredHash).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('requires a content file belonging to the requested book', async () => {
    deps.repository.findPrimaryFile.mockResolvedValue(undefined);
    await expect(service.streamBook(7, 11, reply as never)).rejects.toThrow('No file found for this book');
    expect(deps.repository.findPrimaryFile).toHaveBeenCalledWith(11, 22);
    expect(hashMock).not.toHaveBeenCalled();
  });

  it('does not substitute another file when there is no primary file', async () => {
    deps.repository.findBook.mockResolvedValue({ id: 11, primaryFileId: null });
    deps.repository.findPrimaryFile.mockResolvedValue(undefined);
    await expect(service.streamBook(7, 11, reply as never)).rejects.toThrow(NotFoundException);
    expect(deps.repository.findPrimaryFile).toHaveBeenCalledWith(11, -1);
  });

  it('waits for hashing before registering or streaming', async () => {
    const hashing = deferred<string>();
    hashMock.mockReturnValue(hashing.promise);
    const download = service.streamBook(7, 11, reply as never);
    await vi.waitFor(() => expect(hashMock).toHaveBeenCalled());
    expect(deps.repository.registerDeliveredHash).not.toHaveBeenCalled();
    expect(reply.header).not.toHaveBeenCalled();
    expect(readStreamMock).not.toHaveBeenCalled();
    hashing.resolve(DELIVERED_HASH);
    await download;
    expect(reply.send).toHaveBeenCalled();
  });

  it('waits for identity persistence before sending headers or bytes', async () => {
    const registration = deferred<void>();
    deps.repository.registerDeliveredHash.mockReturnValue(registration.promise);
    const download = service.streamBook(7, 11, reply as never);
    await vi.waitFor(() => expect(deps.repository.registerDeliveredHash).toHaveBeenCalled());
    expect(reply.header).not.toHaveBeenCalled();
    expect(readStreamMock).not.toHaveBeenCalled();
    registration.resolve();
    await download;
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it.each(['ENOENT', 'ENOTDIR'])('reports a missing delivered file (%s) without a hash link', async (code) => {
    hashMock.mockRejectedValue(errno(code));
    await expect(service.streamBook(7, 11, reply as never)).rejects.toThrow(NotFoundException);
    expect(deps.repository.registerDeliveredHash).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it.each(['hash', 'stat', 'stream'])('does not silently deliver an unregistered fallback after a %s failure', async (stage) => {
    const failure = new Error('Preparation failed');
    if (stage === 'hash') hashMock.mockRejectedValue(failure);
    if (stage === 'stat') statMock.mockRejectedValue(failure);
    if (stage === 'stream')
      readStreamMock.mockImplementation(() => {
        throw failure;
      });
    await expect(service.streamBook(7, 11, reply as never)).rejects.toThrow(InternalServerErrorException);
    expect(deps.conversion.getKepubPath).toHaveBeenCalledTimes(1);
    expect(hashMock).toHaveBeenCalledExactlyOnceWith(handle);
    expect(reply.send).not.toHaveBeenCalled();
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it('continues streaming when identity registration unexpectedly rejects', async () => {
    deps.repository.registerDeliveredHash.mockRejectedValue(new Error('Database unavailable'));
    await expect(service.streamBook(7, 11, reply as never)).resolves.toBeUndefined();
    expect(reply.send).toHaveBeenCalledWith(stream);
    expect(handle.close).not.toHaveBeenCalled();
  });

  it('streams narration-free files despite registration failure and cleans up after close', async () => {
    setFile({ mediaOverlayAvailable: true });
    deps.repository.registerDeliveredHash.mockRejectedValue(new Error('Database unavailable'));
    vi.mocked(rm).mockRejectedValue(new Error('Cleanup failed'));
    await expect(service.streamBook(7, 11, reply as never)).resolves.toBeUndefined();
    expect(reply.send).toHaveBeenCalledWith(stream);
    expect(rm).not.toHaveBeenCalled();
    stream.emit('close');
    expect(rm).toHaveBeenCalledExactlyOnceWith(TEMP_DIR, { recursive: true, force: true });
  });
});
