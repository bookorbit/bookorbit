vi.mock('fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('fs', () => ({ createReadStream: vi.fn() }));
vi.mock('zlib', async () => {
  const actual = await vi.importActual<typeof import('zlib')>('zlib');
  return { ...actual, createInflateRaw: vi.fn() };
});
vi.mock('node-unrar-js', () => ({ createExtractorFromData: vi.fn() }));
vi.mock('../../../common/sevenzip', () => ({ getSevenZip: vi.fn() }));

import { NotFoundException } from '@nestjs/common';
import { createReadStream } from 'fs';
import { readFile } from 'fs/promises';
import { createExtractorFromData } from 'node-unrar-js';
import { createInflateRaw, deflateRawSync } from 'zlib';

import { getSevenZip } from '../../../common/sevenzip';
import { CbzService } from './cbz.service';

const mockReadFile = readFile as MockedFunction<typeof readFile>;
const mockCreateReadStream = createReadStream as unknown as MockedFunction<typeof createReadStream>;
const mockCreateInflateRaw = createInflateRaw as unknown as MockedFunction<typeof createInflateRaw>;
const mockCreateExtractorFromData = createExtractorFromData as MockedFunction<typeof createExtractorFromData>;
const mockGetSevenZip = getSevenZip as MockedFunction<typeof getSevenZip>;

interface ZipEntrySpec {
  name: string;
  data: Buffer;
  compression?: 0 | 8;
  dataDescriptor?: boolean;
  omitDescriptor?: boolean;
}

function buildCbzBuffer(entries: ZipEntrySpec[]): Buffer {
  const chunks: Buffer[] = [];

  for (const entry of entries) {
    const fileName = Buffer.from(entry.name, 'utf-8');
    const payload = entry.compression === 8 ? deflateRawSync(entry.data) : entry.data;

    const header = Buffer.alloc(30 + fileName.length);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(entry.dataDescriptor ? 0x0008 : 0, 6);
    header.writeUInt16LE(entry.compression ?? 0, 8);
    header.writeUInt32LE(entry.dataDescriptor ? 0 : payload.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(fileName.length, 26);
    header.writeUInt16LE(0, 28);
    fileName.copy(header, 30);

    chunks.push(header, payload);

    if (entry.dataDescriptor && !entry.omitDescriptor) {
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(0, 4);
      descriptor.writeUInt32LE(payload.length, 8);
      descriptor.writeUInt32LE(entry.data.length, 12);
      chunks.push(descriptor);
    }
  }

  return Buffer.concat(chunks);
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
  });

  it('counts visible CBZ images and caches the parsed index', async () => {
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbz', absolutePath: '/books/one.cbz' });
    mockReadFile.mockResolvedValue(
      buildCbzBuffer([
        { name: '.hidden.jpg', data: Buffer.from([1]) },
        { name: 'notes.txt', data: Buffer.from('hi') },
        { name: '10.jpg', data: Buffer.from([10, 10]) },
        { name: '2.png', data: Buffer.from([2, 2]) },
      ]) as unknown as Awaited<ReturnType<typeof readFile>>,
    );

    await expect(service.getPageCount(1, user)).resolves.toBe(2);
    await expect(service.getPageCount(1, user)).resolves.toBe(2);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it('streams DEFLATE CBZ entries in natural order and pipes through inflate', async () => {
    const inflatedStream = { kind: 'inflated' };
    const rawStream = { pipe: vi.fn().mockReturnValue(inflatedStream) };
    const inflateStream = { kind: 'inflate-transform' };

    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbz', absolutePath: '/books/two.cbz' });
    mockReadFile.mockResolvedValue(
      buildCbzBuffer([
        { name: '10.jpg', data: Buffer.from([10]), compression: 8 },
        { name: '2.jpg', data: Buffer.from([2]), compression: 8 },
      ]) as unknown as Awaited<ReturnType<typeof readFile>>,
    );
    mockCreateReadStream.mockReturnValue(rawStream as unknown as ReturnType<typeof createReadStream>);
    mockCreateInflateRaw.mockReturnValue(inflateStream as ReturnType<typeof createInflateRaw>);

    const result = await service.streamPage(2, 0, user);

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
    mockReadFile.mockResolvedValue(
      buildCbzBuffer([{ name: 'cover.png', data: Buffer.from([3, 3]), compression: 0 }]) as unknown as Awaited<ReturnType<typeof readFile>>,
    );
    mockCreateReadStream.mockReturnValue(rawStream as unknown as ReturnType<typeof createReadStream>);

    const result = await service.streamPage(3, 0, user);

    expect(mockCreateInflateRaw).not.toHaveBeenCalled();
    expect(result.stream).toBe(rawStream);
    expect(result.mimeType).toBe('image/png');
  });

  it('resolves data-descriptor CBZ entries and ignores unresolved ones', async () => {
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbz', absolutePath: '/books/four.cbz' });
    mockReadFile.mockResolvedValue(
      buildCbzBuffer([
        { name: 'broken.jpg', data: Buffer.from([1, 2]), compression: 8, dataDescriptor: true, omitDescriptor: true },
        { name: 'ok.jpg', data: Buffer.from([4, 5]), compression: 8, dataDescriptor: true },
      ]) as unknown as Awaited<ReturnType<typeof readFile>>,
    );

    await expect(service.getPageCount(4, user)).resolves.toBe(1);
  });

  it('throws for CBZ page indexes outside bounds', async () => {
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbz', absolutePath: '/books/five.cbz' });
    mockReadFile.mockResolvedValue(buildCbzBuffer([{ name: 'only.jpg', data: Buffer.from([1]) }]) as unknown as Awaited<ReturnType<typeof readFile>>);

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
    const streamed = await service.streamPage(6, 0, user);
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

  it('throws for CBR page indexes outside bounds', async () => {
    bookService.verifyFileAccess.mockResolvedValue({ format: 'cbr', absolutePath: '/books/seven.cbr' });
    mockReadFile.mockResolvedValue(Buffer.from('rar') as unknown as Awaited<ReturnType<typeof readFile>>);
    mockCreateExtractorFromData.mockResolvedValueOnce({
      getFileList: () => ({ fileHeaders: [{ name: '1.jpg', flags: { directory: false } }] }),
    } as any);

    await expect(service.streamPage(7, 1, user)).rejects.toThrow(NotFoundException);
  });

  it('extracts CB7 pages once and reuses cached page list', async () => {
    const fsApi = {
      open: vi.fn().mockReturnValue(3),
      write: vi.fn(),
      close: vi.fn(),
      mkdir: vi.fn(),
      readdir: vi.fn().mockReturnValue(['.', '..', '10.jpg', '2.png', '.hidden.jpg', 'notes.txt']),
      readFile: vi.fn().mockReturnValue(Uint8Array.from([1, 2, 3])),
    };
    const sevenZip = { FS: fsApi, callMain: vi.fn() };

    bookService.verifyFileAccess.mockResolvedValue({ format: 'cb7', absolutePath: '/books/eight.cb7' });
    mockReadFile.mockResolvedValue(Buffer.from('7z') as unknown as Awaited<ReturnType<typeof readFile>>);
    mockGetSevenZip.mockResolvedValue(sevenZip as any);

    await expect(service.getPageCount(8, user)).resolves.toBe(2);
    const result = await service.streamPage(8, 0, user);
    await expect(readStream(result.stream)).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(result.mimeType).toBe('image/png');
    expect(fsApi.readFile).toHaveBeenCalledWith('/p8/2.png');
    expect(sevenZip.callMain).toHaveBeenCalledTimes(1);
  });

  it('throws for unsupported formats and CB7 index bounds', async () => {
    bookService.verifyFileAccess
      .mockResolvedValueOnce({ format: 'pdf', absolutePath: '/books/nine.pdf' })
      .mockResolvedValueOnce({ format: 'pdf', absolutePath: '/books/nine.pdf' })
      .mockResolvedValueOnce({ format: 'cb7', absolutePath: '/books/nine.cb7' });

    const fsApi = {
      open: vi.fn().mockReturnValue(4),
      write: vi.fn(),
      close: vi.fn(),
      mkdir: vi.fn(),
      readdir: vi.fn().mockReturnValue(['.', '..', '1.jpg']),
      readFile: vi.fn(),
    };
    mockGetSevenZip.mockResolvedValue({ FS: fsApi, callMain: vi.fn() } as any);
    mockReadFile.mockResolvedValue(Buffer.from('7z') as unknown as Awaited<ReturnType<typeof readFile>>);

    await expect(service.getPageCount(9, user)).rejects.toThrow(NotFoundException);
    await expect(service.streamPage(9, 0, user)).rejects.toThrow(NotFoundException);
    await expect(service.streamPage(9, 1, user)).rejects.toThrow(NotFoundException);
  });
});
