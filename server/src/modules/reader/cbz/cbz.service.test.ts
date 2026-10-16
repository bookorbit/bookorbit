vi.mock('fs/promises', () => ({ open: vi.fn(), readFile: vi.fn(), stat: vi.fn() }));
vi.mock('fs', () => ({ createReadStream: vi.fn() }));
vi.mock('zlib', async () => {
  const actual = await vi.importActual<typeof import('zlib')>('zlib');
  return { ...actual, createInflateRaw: vi.fn() };
});
vi.mock('node-unrar-js', () => {
  class MockUnrarError extends Error {
    reason: string;

    constructor(message = 'unrar error', reason = 'ERAR_BAD_ARCHIVE') {
      super(message);
      this.reason = reason;
    }
  }

  return { createExtractorFromData: vi.fn(), UnrarError: MockUnrarError };
});
vi.mock('../../../common/sevenzip', () => ({ getSevenZip: vi.fn(), createSevenZipTempId: vi.fn() }));
vi.mock('../../../common/comic-format-detect', () => ({
  detectComicContainerFormat: vi.fn().mockImplementation((_path: string, fmt: string) => Promise.resolve(fmt)),
}));

import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createReadStream } from 'fs';
import { open, readFile, stat } from 'fs/promises';
import { createExtractorFromData } from 'node-unrar-js';
import { createInflateRaw, deflateRawSync } from 'zlib';

import { createSevenZipTempId, getSevenZip } from '../../../common/sevenzip';
import { detectComicContainerFormat } from '../../../common/comic-format-detect';
import { CbzService, matchesIfNoneMatch, type ComicPageResult } from './cbz.service';
import { FakeSevenZip } from './test-helpers';

const mockReadFile = readFile as MockedFunction<typeof readFile>;
const mockStat = stat as MockedFunction<typeof stat>;
const mockCreateSevenZipTempId = createSevenZipTempId as MockedFunction<typeof createSevenZipTempId>;
const mockOpen = open as MockedFunction<typeof open>;
const mockCreateReadStream = createReadStream as unknown as MockedFunction<typeof createReadStream>;
const mockCreateInflateRaw = createInflateRaw as unknown as MockedFunction<typeof createInflateRaw>;
const mockCreateExtractorFromData = createExtractorFromData as MockedFunction<typeof createExtractorFromData>;
const mockGetSevenZip = getSevenZip as MockedFunction<typeof getSevenZip>;
const mockDetectComicContainerFormat = detectComicContainerFormat as MockedFunction<typeof detectComicContainerFormat>;

interface ZipEntrySpec {
  name: string;
  data: Buffer;
  compression?: 0 | 8;
  dataDescriptor?: boolean;
  omitDescriptor?: boolean;
}

function buildCbzBuffer(entries: ZipEntrySpec[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const fileName = Buffer.from(entry.name, 'utf-8');
    const payload = entry.compression === 8 ? deflateRawSync(entry.data) : entry.data;
    const flags = entry.dataDescriptor ? 0x0008 : 0;

    const header = Buffer.alloc(30 + fileName.length);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(entry.compression ?? 0, 8);
    header.writeUInt32LE(entry.dataDescriptor ? 0 : payload.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(fileName.length, 26);
    header.writeUInt16LE(0, 28);
    fileName.copy(header, 30);

    localChunks.push(header, payload);

    if (entry.dataDescriptor && !entry.omitDescriptor) {
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(0, 4);
      descriptor.writeUInt32LE(payload.length, 8);
      descriptor.writeUInt32LE(entry.data.length, 12);
      localChunks.push(descriptor);
    }

    const central = Buffer.alloc(46 + fileName.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(entry.compression ?? 0, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(localOffset, 42);
    fileName.copy(central, 46);
    centralChunks.push(central);

    localOffset += header.length + payload.length + (entry.dataDescriptor && !entry.omitDescriptor ? 16 : 0);
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);

  return Buffer.concat([...localChunks, centralDirectory, eocd]);
}

function mockCbzFile(buf: Buffer): void {
  mockOpen.mockImplementation(() => {
    const handle = {
      stat: vi.fn().mockResolvedValue({ size: buf.length }),
      close: vi.fn().mockResolvedValue(undefined),
      read: vi.fn((target: Buffer, targetOffset: number, length: number, position: number) => {
        if (position >= buf.length) return Promise.resolve({ bytesRead: 0, buffer: target });
        const bytesRead = buf.copy(target, targetOffset, position, Math.min(position + length, buf.length));
        return Promise.resolve({ bytesRead, buffer: target });
      }),
    };
    return Promise.resolve(handle as unknown as Awaited<ReturnType<typeof open>>);
  });
}

function fileStats(mtimeMs: number, size: number): Awaited<ReturnType<typeof stat>> {
  return { mtimeMs, size } as Awaited<ReturnType<typeof stat>>;
}

function served(result: ComicPageResult): Extract<ComicPageResult, { notModified: false }> {
  if (result.notModified) throw new Error('expected page bytes, got notModified');
  return result;
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('CbzService', () => {
  const user = { id: 9, isSuperuser: false, permissions: [] } as any;
  const bookService = { verifyFileAccess: vi.fn() };

  let service: CbzService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new CbzService(bookService as any);
    mockDetectComicContainerFormat.mockImplementation((_path, fmt) => Promise.resolve(fmt));
    mockStat.mockResolvedValue(fileStats(1_000, 100));
    let tempIds = 0;
    mockCreateSevenZipTempId.mockImplementation((prefix) => `${prefix}_${++tempIds}`);
  });

  it('counts visible CBZ images and caches the parsed index', async () => {
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbz', absolutePath: '/books/one.cbz' });
    mockCbzFile(
      buildCbzBuffer([
        { name: '.hidden.jpg', data: Buffer.from([1]) },
        { name: 'notes.txt', data: Buffer.from('hi') },
        { name: '10.jpg', data: Buffer.from([10, 10]) },
        { name: '2.png', data: Buffer.from([2, 2]) },
      ]),
    );

    await expect(service.getPageCount(1, user)).resolves.toBe(2);
    await expect(service.getPageCount(1, user)).resolves.toBe(2);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('streams DEFLATE CBZ entries in natural order and pipes through inflate', async () => {
    const inflatedStream = { kind: 'inflated' };
    const rawStream = { pipe: vi.fn().mockReturnValue(inflatedStream) };
    const inflateStream = { kind: 'inflate-transform' };

    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbz', absolutePath: '/books/two.cbz' });
    mockCbzFile(
      buildCbzBuffer([
        { name: '10.jpg', data: Buffer.from([10]), compression: 8 },
        { name: '2.jpg', data: Buffer.from([2]), compression: 8 },
      ]),
    );
    mockCreateReadStream.mockReturnValue(rawStream as unknown as ReturnType<typeof createReadStream>);
    mockCreateInflateRaw.mockReturnValue(inflateStream as ReturnType<typeof createInflateRaw>);

    const result = served(await service.streamPage(2, 0, user));

    expect(mockCreateReadStream).toHaveBeenCalledWith(
      '/books/two.cbz',
      expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) }),
    );
    expect(rawStream.pipe).toHaveBeenCalledWith(inflateStream);
    expect(result.stream).toBe(inflatedStream);
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('streams STORED CBZ entries without inflate', async () => {
    const rawStream = { kind: 'raw-stream' };

    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbz', absolutePath: '/books/three.cbz' });
    mockCbzFile(buildCbzBuffer([{ name: 'cover.png', data: Buffer.from([3, 3]), compression: 0 }]));
    mockCreateReadStream.mockReturnValue(rawStream as unknown as ReturnType<typeof createReadStream>);

    const result = served(await service.streamPage(3, 0, user));

    expect(mockCreateInflateRaw).not.toHaveBeenCalled();
    expect(result.stream).toBe(rawStream);
    expect(result.mimeType).toBe('image/png');
  });

  it('resolves data-descriptor CBZ entries from the central directory', async () => {
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbz', absolutePath: '/books/four.cbz' });
    mockCbzFile(
      buildCbzBuffer([
        { name: 'descriptor-1.jpg', data: Buffer.from([1, 2]), compression: 8, dataDescriptor: true },
        { name: 'ok.jpg', data: Buffer.from([4, 5]), compression: 8, dataDescriptor: true },
      ]),
    );

    await expect(service.getPageCount(4, user)).resolves.toBe(2);
  });

  it('throws for CBZ page indexes outside bounds', async () => {
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbz', absolutePath: '/books/five.cbz' });
    mockCbzFile(buildCbzBuffer([{ name: 'only.jpg', data: Buffer.from([1]) }]));

    await expect(service.streamPage(5, -1, user)).rejects.toThrow(NotFoundException);
    await expect(service.streamPage(5, 1, user)).rejects.toThrow(NotFoundException);
  });

  it('counts CBR pages and streams extracted data', async () => {
    const rarBytes = Buffer.from('rar-bytes');
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbr', absolutePath: '/books/six.cbr' });
    mockReadFile.mockResolvedValue(rarBytes as unknown as Awaited<ReturnType<typeof readFile>>);
    mockCreateExtractorFromData
      .mockResolvedValueOnce({
        getFileList: () => ({
          fileHeaders: [
            { name: '10.jpg', flags: { directory: false } },
            { name: '2.jpg', flags: { directory: false } },
            { name: 'notes.txt', flags: { directory: false } },
            { name: '.hidden.jpg', flags: { directory: false } },
          ],
        }),
      } as any)
      .mockResolvedValueOnce({
        extract: () => ({
          files: [{ fileHeader: { flags: { directory: false } }, extraction: Uint8Array.from([7, 8, 9]) }],
        }),
      } as any);

    await expect(service.getPageCount(6, user)).resolves.toBe(2);
    const streamed = served(await service.streamPage(6, 0, user));
    await expect(readStream(streamed.stream)).resolves.toEqual(Buffer.from([7, 8, 9]));
    expect(streamed.mimeType).toBe('image/jpeg');
    await expect(service.getPageCount(6, user)).resolves.toBe(2);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it('throws when CBR extraction does not produce the requested file', async () => {
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbr', absolutePath: '/books/seven.cbr' });
    mockReadFile.mockResolvedValue(Buffer.from('rar') as unknown as Awaited<ReturnType<typeof readFile>>);
    mockCreateExtractorFromData
      .mockResolvedValueOnce({
        getFileList: () => ({ fileHeaders: [{ name: '1.jpg', flags: { directory: false } }] }),
      } as any)
      .mockResolvedValueOnce({
        extract: () => ({ files: [{ fileHeader: { flags: { directory: true } }, extraction: Uint8Array.from([1]) }] }),
      } as any);

    await expect(service.streamPage(7, 0, user)).rejects.toThrow(NotFoundException);
  });

  it('wraps invalid CBR archive list errors as unprocessable archives', async () => {
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbr', absolutePath: '/books/bad.cbr' });
    mockReadFile.mockResolvedValue(Buffer.from('not-rar') as unknown as Awaited<ReturnType<typeof readFile>>);
    mockCreateExtractorFromData.mockResolvedValueOnce({
      getFileList: () => {
        throw Object.assign(new Error('File is not RAR archive'), { reason: 'ERAR_BAD_ARCHIVE' });
      },
    } as any);

    let error: unknown;
    try {
      await service.getPageCount(13, user);
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as Error).message).toBe('CBR archive is unreadable: File is not RAR archive');
  });

  it('wraps invalid CBR page extraction errors as unprocessable pages', async () => {
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbr', absolutePath: '/books/bad-page.cbr' });
    mockReadFile.mockResolvedValue(Buffer.from('rar') as unknown as Awaited<ReturnType<typeof readFile>>);
    mockCreateExtractorFromData
      .mockResolvedValueOnce({
        getFileList: () => ({ fileHeaders: [{ name: '1.jpg', flags: { directory: false } }] }),
      } as any)
      .mockResolvedValueOnce({
        extract: () => {
          throw Object.assign(new Error('corrupt page'), { reason: 'ERAR_BAD_DATA' });
        },
      } as any);

    let error: unknown;
    try {
      await service.streamPage(14, 0, user);
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as Error).message).toBe('CBR page is unreadable: corrupt page');
  });

  it('throws for CBR page indexes outside bounds', async () => {
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbr', absolutePath: '/books/seven.cbr' });
    mockReadFile.mockResolvedValue(Buffer.from('rar') as unknown as Awaited<ReturnType<typeof readFile>>);
    mockCreateExtractorFromData.mockResolvedValueOnce({
      getFileList: () => ({ fileHeaders: [{ name: '1.jpg', flags: { directory: false } }] }),
    } as any);

    await expect(service.streamPage(7, 1, user)).rejects.toThrow(NotFoundException);
  });

  it('extracts CB7 pages once with folders kept, reuses the page list and drops the archive copy', async () => {
    const sevenZip = new FakeSevenZip({ '10.jpg': 'ten', '2.png': 'two', '.hidden.jpg': 'h', 'notes.txt': 'n' });
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cb7', absolutePath: '/books/eight.cb7' });
    mockReadFile.mockResolvedValue(Buffer.from('7z') as unknown as Awaited<ReturnType<typeof readFile>>);
    mockGetSevenZip.mockResolvedValue(sevenZip as any);

    await expect(service.getPageCount(8, user)).resolves.toBe(2);
    const result = served(await service.streamPage(8, 0, user));
    await expect(readStream(result.stream)).resolves.toEqual(Buffer.from('two'));
    expect(result.mimeType).toBe('image/png');
    expect(sevenZip.calls).toEqual([['x', '/comic8_1.7z', '-o/comic8_1', '-y']]);
    expect(sevenZip.paths()).not.toContain('/comic8_1.7z');
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it('keeps CB7 pages that share a name in different folders, in file-name order', async () => {
    const sevenZip = new FakeSevenZip({
      'ch2/001.jpg': 'c2p1',
      'ch1/002.jpg': 'c1p2',
      'ch1/001.jpg': 'c1p1',
      'ch1/.hidden.jpg': 'hidden',
      '.thumbs/x.jpg': 'thumb',
    });
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cb7', absolutePath: '/books/nested.cb7' });
    mockReadFile.mockResolvedValue(Buffer.from('7z') as unknown as Awaited<ReturnType<typeof readFile>>);
    mockGetSevenZip.mockResolvedValue(sevenZip as any);

    await expect(service.getPageCount(15, user)).resolves.toBe(4);
    const pages: string[] = [];
    for (let index = 0; index < 4; index++) {
      pages.push((await readStream(served(await service.streamPage(15, index, user)).stream)).toString());
    }
    expect(pages).toEqual(['c1p1', 'c2p1', 'c1p2', 'thumb']);
  });

  it('removes the CB7 working files when extraction fails', async () => {
    const sevenZip = new FakeSevenZip({ '1.jpg': 'one' });
    vi.spyOn(sevenZip, 'callMain').mockImplementation(() => {
      throw new Error('7z exited');
    });
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cb7', absolutePath: '/books/broken.cb7' });
    mockReadFile.mockResolvedValue(Buffer.from('7z') as unknown as Awaited<ReturnType<typeof readFile>>);
    mockGetSevenZip.mockResolvedValue(sevenZip as any);

    await expect(service.getPageCount(16, user)).rejects.toThrow('7z exited');
    expect(sevenZip.paths()).toEqual([]);
  });

  it('throws for unsupported formats and CB7 index bounds', async () => {
    bookService.verifyFileAccess
      .mockResolvedValueOnce({ format: 'pdf', absolutePath: '/books/nine.pdf' })
      .mockResolvedValueOnce({ format: 'pdf', absolutePath: '/books/nine.pdf' })
      .mockResolvedValueOnce({ format: 'cb7', absolutePath: '/books/nine.cb7' });
    mockGetSevenZip.mockResolvedValue(new FakeSevenZip({ '1.jpg': 'one' }) as any);
    mockReadFile.mockResolvedValue(Buffer.from('7z') as unknown as Awaited<ReturnType<typeof readFile>>);

    await expect(service.getPageCount(9, user)).rejects.toThrow('Unsupported comic format: pdf');
    await expect(service.streamPage(9, 0, user)).rejects.toThrow(NotFoundException);
    await expect(service.streamPage(9, 1, user)).rejects.toThrow('Page 1 out of range');
    expect(mockStat).toHaveBeenCalledTimes(1);
  });

  it('reads a CBZ-stored-as-RAR using the CBR reader when magic bytes detect RAR', async () => {
    mockDetectComicContainerFormat.mockResolvedValue('cbr');
    const rarBytes = Buffer.from('fake-rar');
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbz', absolutePath: '/books/mislabelled.cbz' });
    mockReadFile.mockResolvedValue(rarBytes as unknown as Awaited<ReturnType<typeof readFile>>);
    mockCreateExtractorFromData
      .mockResolvedValueOnce({
        getFileList: () => ({ fileHeaders: [{ name: '1.jpg', flags: { directory: false } }] }),
      } as any)
      .mockResolvedValueOnce({
        extract: () => ({ files: [{ fileHeader: { flags: { directory: false } }, extraction: Uint8Array.from([1, 2, 3]) }] }),
      } as any);

    await expect(service.getPageCount(10, user)).resolves.toBe(1);
    const result = served(await service.streamPage(10, 0, user));
    await expect(readStream(result.stream)).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(mockDetectComicContainerFormat).toHaveBeenCalledWith('/books/mislabelled.cbz', 'cbz');
  });

  it('reads a CBR-stored-as-ZIP using the CBZ reader when magic bytes detect ZIP', async () => {
    mockDetectComicContainerFormat.mockResolvedValue('cbz');
    const rawStream = { kind: 'raw-stream' };
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbr', absolutePath: '/books/mislabelled.cbr' });
    mockCbzFile(buildCbzBuffer([{ name: 'cover.jpg', data: Buffer.from([0xff, 0xd8]) }]));
    mockCreateReadStream.mockReturnValue(rawStream as unknown as ReturnType<typeof createReadStream>);

    await expect(service.getPageCount(11, user)).resolves.toBe(1);
    const result = served(await service.streamPage(11, 0, user));
    expect(result.stream).toBe(rawStream);
    expect(mockDetectComicContainerFormat).toHaveBeenCalledWith('/books/mislabelled.cbr', 'cbr');
  });

  it('caches resolved format and calls detectComicContainerFormat only once per fileId', async () => {
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbz', absolutePath: '/books/cached.cbz' });
    mockCbzFile(buildCbzBuffer([{ name: '1.jpg', data: Buffer.from([1]) }]));

    await service.getPageCount(12, user);
    await service.getPageCount(12, user);

    expect(mockDetectComicContainerFormat).toHaveBeenCalledTimes(1);
  });

  describe('when the file changes on disk', () => {
    it('reuses a CBZ index while the file is unchanged and rebuilds it after a rewrite', async () => {
      bookService.verifyFileAccess.mockResolvedValue({ format: 'cbz', absolutePath: '/books/patched.cbz' });
      mockCbzFile(buildCbzBuffer([{ name: '1.jpg', data: Buffer.from([1]) }]));

      await expect(service.getPageCount(20, user)).resolves.toBe(1);
      await expect(service.getPageCount(20, user)).resolves.toBe(1);
      expect(mockOpen).toHaveBeenCalledTimes(1);

      mockCbzFile(
        buildCbzBuffer([
          { name: 'ComicInfo.xml', data: Buffer.from('<x/>') },
          { name: '1.jpg', data: Buffer.from([1]) },
          { name: '2.jpg', data: Buffer.from([2]) },
        ]),
      );
      mockStat.mockResolvedValue(fileStats(2_000, 100));

      await expect(service.getPageCount(20, user)).resolves.toBe(2);
      expect(mockOpen).toHaveBeenCalledTimes(2);
      expect(mockDetectComicContainerFormat).toHaveBeenCalledTimes(2);
    });

    it('treats a size change with the same mtime as a new version of a CBR', async () => {
      bookService.verifyFileAccess.mockResolvedValue({ format: 'cbr', absolutePath: '/books/resized.cbr' });
      mockReadFile.mockResolvedValue(Buffer.from('rar') as unknown as Awaited<ReturnType<typeof readFile>>);
      mockCreateExtractorFromData
        .mockResolvedValueOnce({ getFileList: () => ({ fileHeaders: [{ name: '1.jpg', flags: { directory: false } }] }) } as any)
        .mockResolvedValueOnce({
          getFileList: () => ({
            fileHeaders: [
              { name: '1.jpg', flags: { directory: false } },
              { name: '2.jpg', flags: { directory: false } },
            ],
          }),
        } as any);

      await expect(service.getPageCount(21, user)).resolves.toBe(1);
      mockStat.mockResolvedValue(fileStats(1_000, 250));
      await expect(service.getPageCount(21, user)).resolves.toBe(2);
      expect(mockReadFile).toHaveBeenCalledTimes(2);
    });

    it('drops the previous CB7 extraction and serves pages from the new one', async () => {
      const sevenZip = new FakeSevenZip({ 'ch1/001.jpg': 'old' });
      bookService.verifyFileAccess.mockResolvedValue({ format: 'cb7', absolutePath: '/books/rewritten.cb7' });
      mockReadFile.mockResolvedValue(Buffer.from('7z') as unknown as Awaited<ReturnType<typeof readFile>>);
      mockGetSevenZip.mockResolvedValue(sevenZip as any);

      await expect(service.getPageCount(22, user)).resolves.toBe(1);
      expect(sevenZip.paths()).toContain('/comic22_1/ch1/001.jpg');

      sevenZip.archive = { 'ch1/001.jpg': 'new', 'ch1/002.jpg': 'next' };
      mockStat.mockResolvedValue(fileStats(2_000, 100));

      await expect(service.getPageCount(22, user)).resolves.toBe(2);
      expect(sevenZip.paths().filter((path) => path.startsWith('/comic22_1'))).toEqual([]);
      await expect(readStream(served(await service.streamPage(22, 0, user)).stream)).resolves.toEqual(Buffer.from('new'));
    });
  });

  describe('unreadable or missing files', () => {
    it('answers 422 for a corrupt CBZ instead of an empty comic, and does not cache the failure', async () => {
      bookService.verifyFileAccess.mockResolvedValue({ format: 'cbz', absolutePath: '/books/corrupt.cbz' });
      mockCbzFile(Buffer.from('this is not a zip archive, only some text'));

      await expect(service.getPageCount(23, user)).rejects.toThrow(UnprocessableEntityException);
      await expect(service.streamPage(23, 0, user)).rejects.toThrow('CBZ archive is unreadable');

      mockCbzFile(buildCbzBuffer([{ name: '1.jpg', data: Buffer.from([1]) }]));
      await expect(service.getPageCount(23, user)).resolves.toBe(1);
    });

    it('still answers an empty page list for a readable CBZ with no images', async () => {
      bookService.verifyFileAccess.mockResolvedValue({ format: 'cbz', absolutePath: '/books/empty.cbz' });
      mockCbzFile(buildCbzBuffer([{ name: 'ComicInfo.xml', data: Buffer.from('<x/>') }]));

      await expect(service.getPageCount(24, user)).resolves.toBe(0);
    });

    it('reports a comic missing on disk as not found without reading it', async () => {
      bookService.verifyFileAccess.mockResolvedValue({ format: 'cbz', absolutePath: '/books/gone.cbz' });
      mockStat.mockRejectedValue(Object.assign(new Error('no such file'), { code: 'ENOENT' }));

      await expect(service.getPageCount(25, user)).rejects.toThrow('Comic file is missing on disk');
      expect(mockOpen).not.toHaveBeenCalled();
    });
  });

  describe('page validators', () => {
    beforeEach(() => {
      bookService.verifyFileAccess.mockResolvedValue({ format: 'cbr', absolutePath: '/books/validated.cbr' });
      mockReadFile.mockResolvedValue(Buffer.from('rar') as unknown as Awaited<ReturnType<typeof readFile>>);
      mockCreateExtractorFromData.mockImplementation(
        () =>
          Promise.resolve({
            getFileList: () => ({
              fileHeaders: [
                { name: '1.jpg', flags: { directory: false } },
                { name: '2.jpg', flags: { directory: false } },
              ],
            }),
            extract: () => ({ files: [{ fileHeader: { flags: { directory: false } }, extraction: Uint8Array.from([1]) }] }),
          }) as any,
      );
    });

    it('gives each page of each file version its own ETag', async () => {
      const first = (await service.streamPage(26, 0, user)).etag;
      const again = (await service.streamPage(26, 0, user)).etag;
      const second = (await service.streamPage(26, 1, user)).etag;
      const otherFile = (await service.streamPage(27, 0, user)).etag;
      mockStat.mockResolvedValue(fileStats(2_000, 100));
      const rewritten = (await service.streamPage(26, 0, user)).etag;

      expect(first).toMatch(/^"[A-Za-z0-9_-]+"$/);
      expect(again).toBe(first);
      expect(new Set([first, second, otherFile, rewritten]).size).toBe(4);
    });

    it('answers notModified without extracting the page when the client already holds it', async () => {
      const { etag } = await service.streamPage(26, 1, user);
      const extractionsBefore = mockCreateExtractorFromData.mock.calls.length;

      await expect(service.streamPage(26, 1, user, etag)).resolves.toEqual({ notModified: true, etag });
      await expect(service.streamPage(26, 1, user, `"something-else", W/${etag}`)).resolves.toEqual({ notModified: true, etag });
      expect(mockCreateExtractorFromData).toHaveBeenCalledTimes(extractionsBefore);
      expect(bookService.verifyFileAccess).toHaveBeenCalledTimes(3);
    });

    it('serves the page again once the file has changed', async () => {
      const { etag } = await service.streamPage(26, 0, user);
      mockStat.mockResolvedValue(fileStats(2_000, 100));

      const result = await service.streamPage(26, 0, user, etag);

      expect(result.notModified).toBe(false);
      expect(result.etag).not.toBe(etag);
    });

    it('checks access before answering notModified', async () => {
      const { etag } = await service.streamPage(26, 0, user);
      bookService.verifyFileAccess.mockRejectedValueOnce(new NotFoundException('No file with id 26'));

      await expect(service.streamPage(26, 0, user, etag)).rejects.toThrow(NotFoundException);
    });
  });

  describe('matchesIfNoneMatch', () => {
    it.each([
      ['"abc"', true],
      ['W/"abc"', true],
      ['"x", "abc"', true],
      ['"abcd"', false],
      ['abc', false],
      ['*', false],
      [undefined, false],
      ['', false],
    ])('%j matches "abc": %s', (header, expected) => {
      expect(matchesIfNoneMatch(header, '"abc"')).toBe(expected);
    });
  });
});
