vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('../metadata/lib/pdf-parser', () => ({
  parsePdfFile: vi.fn(),
}));

vi.mock('../metadata/lib/epub', () => ({
  extractEpubMetadata: vi.fn(),
}));

vi.mock('../metadata/lib/mobi-parser', () => ({
  parseMobiFile: vi.fn(),
}));

vi.mock('../metadata/lib/cbz-metadata', () => ({
  extractCbzMetadata: vi.fn(),
  extractCbrMetadata: vi.fn(),
  extractCb7Metadata: vi.fn(),
}));

vi.mock('../metadata/lib/fb2-parser', () => ({
  parseFb2File: vi.fn(),
}));

vi.mock('../metadata/lib/cover', () => ({
  extractCover: vi.fn(),
  generateThumbnail: vi.fn(),
  imageExt: vi.fn(),
}));

import { Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import type { MockedFunction } from 'vitest';

import { extractEpubMetadata } from '../metadata/lib/epub';
import { parseMobiFile } from '../metadata/lib/mobi-parser';
import { extractCb7Metadata, extractCbrMetadata, extractCbzMetadata } from '../metadata/lib/cbz-metadata';
import { parseFb2File } from '../metadata/lib/fb2-parser';
import { extractCover, generateThumbnail, imageExt } from '../metadata/lib/cover';
import { parsePdfFile } from '../metadata/lib/pdf-parser';
import { BookBucketMetadataService } from './book-bucket-metadata.service';

const mockMkdir = mkdir as MockedFunction<typeof mkdir>;
const mockWriteFile = writeFile as MockedFunction<typeof writeFile>;
const mockExtractCover = extractCover as MockedFunction<typeof extractCover>;
const mockGenerateThumbnail = generateThumbnail as MockedFunction<typeof generateThumbnail>;
const mockImageExt = imageExt as MockedFunction<typeof imageExt>;
const mockParsePdfFile = parsePdfFile as MockedFunction<typeof parsePdfFile>;
const mockExtractEpubMetadata = extractEpubMetadata as MockedFunction<typeof extractEpubMetadata>;
const mockParseMobiFile = parseMobiFile as MockedFunction<typeof parseMobiFile>;
const mockExtractCbzMetadata = extractCbzMetadata as MockedFunction<typeof extractCbzMetadata>;
const mockExtractCbrMetadata = extractCbrMetadata as MockedFunction<typeof extractCbrMetadata>;
const mockExtractCb7Metadata = extractCb7Metadata as MockedFunction<typeof extractCb7Metadata>;
const mockParseFb2File = parseFb2File as MockedFunction<typeof parseFb2File>;

describe('BookBucketMetadataService', () => {
  const repo = {
    update: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    repo.update.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockExtractCover.mockResolvedValue(null);
    mockGenerateThumbnail.mockResolvedValue(Buffer.from('thumb'));
    mockImageExt.mockReturnValue('png');
    mockParsePdfFile.mockResolvedValue(null);
    mockExtractEpubMetadata.mockResolvedValue(null);
    mockParseMobiFile.mockResolvedValue(null);
    mockExtractCbzMetadata.mockResolvedValue(null);
    mockExtractCbrMetadata.mockResolvedValue(null);
    mockExtractCb7Metadata.mockResolvedValue(null);
    mockParseFb2File.mockResolvedValue(null);
  });

  it('extractAndSave(pdf) reuses a single parse result for metadata and cover persistence', async () => {
    mockParsePdfFile.mockResolvedValue({
      title: 'PDF Title',
      subtitle: null,
      description: null,
      publisher: 'PDF Publisher',
      publishedYear: null,
      language: null,
      authors: [{ name: 'Author A', sortName: null }],
      genres: ['Genre A'],
      tags: [],
      isbn10: null,
      isbn13: null,
      seriesName: null,
      seriesIndex: null,
      rating: null,
      pageCount: 200,
      googleBooksId: null,
      goodreadsId: null,
      amazonId: null,
      hardcoverId: null,
      openLibraryId: null,
      itunesId: null,
      coverBuffer: Buffer.from('cover'),
    });

    const service = new BookBucketMetadataService(repo as never);

    await service.extractAndSave(5, '/tmp/book.pdf', 'pdf', '/tmp/covers');

    expect(mockParsePdfFile).toHaveBeenCalledTimes(1);
    expect(mockParsePdfFile).toHaveBeenCalledWith(
      '/tmp/book.pdf',
      expect.objectContaining({
        extractCover: true,
        onWarning: expect.any(Function),
      }),
    );
    expect(mockExtractCover).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenNthCalledWith(1, 5, { status: 'extracting' });
    expect(repo.update).toHaveBeenNthCalledWith(2, 5, {
      embeddedMetadata: {
        title: 'PDF Title',
        publisher: 'PDF Publisher',
        pageCount: 200,
        authors: ['Author A'],
        genres: ['Genre A'],
      },
      coverPath: '/tmp/covers/5.png',
      status: 'ready',
    });
    expect(mockMkdir).toHaveBeenCalledWith('/tmp/covers', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith('/tmp/covers/5.png', Buffer.from('cover'));
    expect(mockWriteFile).toHaveBeenCalledWith('/tmp/covers/5_thumb.jpg', Buffer.from('thumb'));
  });

  it('extractAndSave(pdf) leaves coverPath null when no cover bytes are available', async () => {
    mockParsePdfFile.mockResolvedValue({
      title: 'PDF Title',
      subtitle: null,
      description: null,
      publisher: null,
      publishedYear: null,
      language: null,
      authors: [],
      genres: [],
      tags: [],
      isbn10: null,
      isbn13: null,
      seriesName: null,
      seriesIndex: null,
      rating: null,
      pageCount: 12,
      googleBooksId: null,
      goodreadsId: null,
      amazonId: null,
      hardcoverId: null,
      openLibraryId: null,
      itunesId: null,
      coverBuffer: null,
    });

    const service = new BookBucketMetadataService(repo as never);

    await service.extractAndSave(6, '/tmp/book.pdf', 'pdf', '/tmp/covers');

    expect(repo.update).toHaveBeenNthCalledWith(2, 6, {
      embeddedMetadata: {
        title: 'PDF Title',
        publisher: undefined,
        pageCount: 12,
        authors: undefined,
        genres: undefined,
      },
      coverPath: null,
      status: 'ready',
    });
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('extractAndSave(non-pdf) falls back to generic extraction path and keeps cover null when not found', async () => {
    const service = new BookBucketMetadataService(repo as never);

    await service.extractAndSave(7, '/tmp/book.bin', 'unknown', '/tmp/covers');

    expect(mockExtractCover).toHaveBeenCalledWith('/tmp/book.bin', 'unknown');
    expect(repo.update).toHaveBeenNthCalledWith(2, 7, {
      embeddedMetadata: {},
      coverPath: null,
      status: 'ready',
    });
  });

  it('extractAndSave writes error status when metadata extraction fails', async () => {
    mockParsePdfFile.mockRejectedValueOnce(new Error('parse failure'));
    const service = new BookBucketMetadataService(repo as never);

    await service.extractAndSave(8, '/tmp/broken.pdf', 'pdf', '/tmp/covers');

    expect(repo.update).toHaveBeenNthCalledWith(2, 8, {
      status: 'error',
      errorMessage: 'parse failure',
    });
  });

  it('logPdfParseWarning emits distinct messages for large-buffer and parser-warning scenarios', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new BookBucketMetadataService(repo as never);

    (service as any).logPdfParseWarning({
      code: 'buffered-large-pdf',
      absolutePath: '/tmp/large.pdf',
      sizeBytes: 5000,
      thresholdBytes: 4000,
    });
    (service as any).logPdfParseWarning({
      code: 'xmp_parse_failed',
      absolutePath: '/tmp/bad.pdf',
      errorClass: 'Error',
      errorMessage: 'invalid xmp',
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('buffered-large-pdf'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('xmp_parse_failed'));
  });

  it('extractMetadata maps epub parser output with non-empty authors and tags', async () => {
    mockExtractEpubMetadata.mockResolvedValue({
      title: 'Epub Title',
      subtitle: 'Epub Sub',
      description: 'Desc',
      publisher: 'Pub',
      publishedYear: 2001,
      language: 'en',
      isbn10: '123456789X',
      isbn13: '9780306406157',
      seriesName: 'Series',
      seriesIndex: 1.5,
      authors: [{ name: 'Author A', sortName: null }],
      tags: ['Sci-Fi'],
    } as never);
    const service = new BookBucketMetadataService(repo as never);

    await expect((service as any).extractMetadata('/tmp/book.epub', 'epub')).resolves.toEqual({
      title: 'Epub Title',
      subtitle: 'Epub Sub',
      description: 'Desc',
      publisher: 'Pub',
      publishedYear: 2001,
      language: 'en',
      isbn10: '123456789X',
      isbn13: '9780306406157',
      seriesName: 'Series',
      seriesIndex: 1.5,
      authors: ['Author A'],
      genres: ['Sci-Fi'],
    });
  });

  it('extractMetadata handles mobi-family formats and parses year prefix when valid', async () => {
    mockParseMobiFile.mockResolvedValue({
      title: 'Mobi Title',
      description: 'Mobi Desc',
      publisher: 'Mobi Pub',
      publishedDate: '1999-01-01',
      language: 'en',
      isbn: '9780306406157',
      authors: ['Author A'],
      tags: ['Tag 1'],
    } as never);
    const service = new BookBucketMetadataService(repo as never);

    await expect((service as any).extractMetadata('/tmp/book.azw3', 'azw3')).resolves.toEqual({
      title: 'Mobi Title',
      description: 'Mobi Desc',
      publisher: 'Mobi Pub',
      publishedYear: 1999,
      language: 'en',
      isbn13: '9780306406157',
      authors: ['Author A'],
      genres: ['Tag 1'],
    });
    await expect((service as any).extractMetadata('/tmp/book.azw', 'azw')).resolves.toEqual(
      expect.objectContaining({
        title: 'Mobi Title',
      }),
    );
  });

  it('extractMetadata maps cbz/cbr/cb7 and fb2 parser outputs', async () => {
    mockExtractCbzMetadata.mockResolvedValue({
      title: 'Comic Z',
      description: null,
      publisher: 'Pub',
      publishedYear: 2020,
      language: 'en',
      seriesName: 'Series',
      seriesIndex: 1,
      authors: [{ name: 'Artist Z', sortName: null }],
      tags: ['Action'],
    } as never);
    mockExtractCbrMetadata.mockResolvedValue({
      title: 'Comic R',
      description: 'Desc',
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      authors: [],
      tags: [],
    } as never);
    mockExtractCb7Metadata.mockResolvedValue({
      title: 'Comic 7',
      description: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      authors: [{ name: 'Artist 7', sortName: null }],
      tags: ['Tag7'],
    } as never);
    mockParseFb2File.mockResolvedValue({
      title: 'FB2 Book',
      description: 'FB2 Desc',
      publishedYear: 1990,
      language: 'ru',
      seriesName: 'FB2 Series',
      seriesIndex: 2,
      authors: [{ name: 'FB2 Author', sortName: null }],
      genres: ['Drama'],
    } as never);
    const service = new BookBucketMetadataService(repo as never);

    await expect((service as any).extractMetadata('/tmp/comic.cbz', 'cbz')).resolves.toEqual(
      expect.objectContaining({
        title: 'Comic Z',
        authors: ['Artist Z'],
        genres: ['Action'],
      }),
    );
    await expect((service as any).extractMetadata('/tmp/comic.cbr', 'cbr')).resolves.toEqual({
      title: 'Comic R',
      description: 'Desc',
      publisher: undefined,
      publishedYear: undefined,
      language: undefined,
      seriesName: undefined,
      seriesIndex: undefined,
      authors: undefined,
      genres: undefined,
    });
    await expect((service as any).extractMetadata('/tmp/comic.cb7', 'cb7')).resolves.toEqual(
      expect.objectContaining({
        title: 'Comic 7',
        authors: ['Artist 7'],
        genres: ['Tag7'],
      }),
    );
    await expect((service as any).extractMetadata('/tmp/book.fb2', 'fb2')).resolves.toEqual(
      expect.objectContaining({
        title: 'FB2 Book',
        authors: ['FB2 Author'],
        genres: ['Drama'],
      }),
    );
  });
});
