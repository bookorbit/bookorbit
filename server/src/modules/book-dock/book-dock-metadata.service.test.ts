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

vi.mock('../metadata/extractors/audio.extractor', () => ({
  extractAudioMetadata: vi.fn(),
}));

import { Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import type { MockedFunction } from 'vitest';
import type { ParsedOpf } from '../metadata/lib/opf-parser';

import { extractEpubMetadata } from '../metadata/lib/epub';
import { parseMobiFile } from '../metadata/lib/mobi-parser';
import { extractCb7Metadata, extractCbrMetadata, extractCbzMetadata } from '../metadata/lib/cbz-metadata';
import { parseFb2File } from '../metadata/lib/fb2-parser';
import { extractCover, generateThumbnail, imageExt } from '../metadata/lib/cover';
import { extractAudioMetadata, type AudioExtractResult } from '../metadata/extractors/audio.extractor';
import { parsePdfFile } from '../metadata/lib/pdf-parser';
import { BookDockMetadataService } from './book-dock-metadata.service';

function makeAudioResult(overrides?: Partial<AudioExtractResult>): AudioExtractResult {
  return {
    title: null,
    subtitle: null,
    authors: [],
    narrators: [],
    publisher: null,
    publishedYear: null,
    description: null,
    language: null,
    seriesName: null,
    seriesIndex: null,
    genres: [],
    audibleId: null,
    durationSeconds: null,
    chapters: [],
    coverBytes: null,
    ...overrides,
  };
}

function makeParsedOpf(overrides: Partial<ParsedOpf> = {}): ParsedOpf {
  return {
    title: null,
    subtitle: null,
    description: null,
    isbn10: null,
    isbn13: null,
    publisher: null,
    publishedYear: null,
    language: null,
    pageCount: null,
    rating: null,
    seriesName: null,
    seriesIndex: null,
    authors: [],
    genres: [],
    tags: [],
    googleBooksId: null,
    goodreadsId: null,
    amazonId: null,
    hardcoverId: null,
    hardcoverEditionId: null,
    openLibraryId: null,
    ranobedbId: null,
    koboId: null,
    lubimyczytacId: null,
    aladinId: null,
    itunesId: null,
    customMetadata: {},
    coverHref: null,
    ...overrides,
  };
}

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
const mockExtractAudioMetadata = extractAudioMetadata as MockedFunction<typeof extractAudioMetadata>;

describe('BookDockMetadataService', () => {
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
    mockExtractAudioMetadata.mockResolvedValue(makeAudioResult());
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
      hardcoverEditionId: null,
      openLibraryId: null,
      itunesId: null,
      coverBuffer: Buffer.from('cover'),
    });

    const service = new BookDockMetadataService(repo as never);

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
      hardcoverEditionId: null,
      openLibraryId: null,
      itunesId: null,
      coverBuffer: null,
    });

    const service = new BookDockMetadataService(repo as never);

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
    const service = new BookDockMetadataService(repo as never);

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
    const service = new BookDockMetadataService(repo as never);

    await service.extractAndSave(8, '/tmp/broken.pdf', 'pdf', '/tmp/covers');

    expect(repo.update).toHaveBeenNthCalledWith(2, 8, {
      status: 'error',
      errorMessage: 'parse failure',
    });
  });

  it('logPdfParseWarning emits distinct messages for large-buffer and parser-warning scenarios', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new BookDockMetadataService(repo as never);

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

  it('extractMetadata maps epub subjects and Calibre page count instead of BookOrbit tags', async () => {
    mockExtractEpubMetadata.mockResolvedValue(
      makeParsedOpf({
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
        pageCount: 598,
        authors: [{ name: 'Author A', sortName: null }],
        genres: ['Krimi & Thriller'],
        tags: ['Imported Tag'],
      }),
    );
    const service = new BookDockMetadataService(repo as never);

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
      pageCount: 598,
      authors: ['Author A'],
      genres: ['Krimi & Thriller'],
    });
  });

  it('extractMetadata leaves epub genres empty when only BookOrbit tags are present', async () => {
    mockExtractEpubMetadata.mockResolvedValue(
      makeParsedOpf({
        title: 'Tagged Epub',
        tags: ['Imported Tag'],
      }),
    );
    const service = new BookDockMetadataService(repo as never);

    const metadata = await (service as any).extractMetadata('/tmp/tagged.epub', 'epub');

    expect(metadata.title).toBe('Tagged Epub');
    expect(metadata.genres).toBeUndefined();
    expect(metadata.pageCount).toBeUndefined();
  });

  it('extractAndSave(epub) stores subject genres and page count in embedded metadata', async () => {
    mockExtractEpubMetadata.mockResolvedValue(
      makeParsedOpf({
        title: '1794',
        isbn13: '9783492317948',
        seriesName: 'Winge und Cardell',
        seriesIndex: 2,
        pageCount: 598,
        authors: [{ name: 'Niklas Natt och Dag', sortName: 'Dag, Niklas Natt och' }],
        genres: ['Krimi & Thriller'],
        tags: [],
      }),
    );
    const service = new BookDockMetadataService(repo as never);

    await service.extractAndSave(13, '/tmp/1794.epub', 'epub', '/tmp/covers');

    expect(mockExtractCover).toHaveBeenCalledWith('/tmp/1794.epub', 'epub');
    expect(repo.update).toHaveBeenNthCalledWith(
      2,
      13,
      expect.objectContaining({
        embeddedMetadata: expect.objectContaining({
          title: '1794',
          isbn13: '9783492317948',
          seriesName: 'Winge und Cardell',
          seriesIndex: 2,
          pageCount: 598,
          authors: ['Niklas Natt och Dag'],
          genres: ['Krimi & Thriller'],
        }),
        coverPath: null,
        status: 'ready',
      }),
    );
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
    const service = new BookDockMetadataService(repo as never);

    await expect((service as any).extractMetadata('/tmp/book.azw3', 'azw3')).resolves.toEqual({
      title: 'Mobi Title',
      description: 'Mobi Desc',
      publisher: 'Mobi Pub',
      publishedDate: '1999-01-01',
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
    const service = new BookDockMetadataService(repo as never);

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

  it('extractAndSave(m4b) extracts chapters, duration, narrators and embedded cover in a single parse', async () => {
    mockExtractAudioMetadata.mockResolvedValue(
      makeAudioResult({
        title: 'Artificial Condition',
        subtitle: 'The Murderbot Diaries',
        authors: [{ name: 'Martha Wells', sortName: null }],
        narrators: ['Kevin R. Free'],
        publisher: 'Recorded Books',
        publishedYear: 2018,
        description: 'Murderbot returns.',
        language: 'en',
        seriesName: 'The Murderbot Diaries',
        seriesIndex: 2,
        genres: ['Science Fiction'],
        durationSeconds: 12218,
        chapters: [
          { title: 'Chapter 1', startMs: 0 },
          { title: 'Chapter 2', startMs: 804850 },
        ],
        coverBytes: Buffer.from('cover'),
      }),
    );
    mockImageExt.mockReturnValue('jpg');

    const service = new BookDockMetadataService(repo as never);

    await service.extractAndSave(10, '/tmp/book.m4b', 'm4b', '/tmp/covers');

    expect(mockExtractAudioMetadata).toHaveBeenCalledTimes(1);
    expect(mockExtractAudioMetadata).toHaveBeenCalledWith('/tmp/book.m4b');
    expect(mockExtractCover).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenNthCalledWith(2, 10, {
      embeddedMetadata: {
        title: 'Artificial Condition',
        subtitle: 'The Murderbot Diaries',
        description: 'Murderbot returns.',
        publisher: 'Recorded Books',
        publishedYear: 2018,
        language: 'en',
        seriesName: 'The Murderbot Diaries',
        seriesIndex: 2,
        authors: ['Martha Wells'],
        narrators: ['Kevin R. Free'],
        genres: ['Science Fiction'],
        durationSeconds: 12218,
        chapters: [
          { title: 'Chapter 1', startMs: 0 },
          { title: 'Chapter 2', startMs: 804850 },
        ],
      },
      coverPath: '/tmp/covers/10.jpg',
      status: 'ready',
    });
    expect(mockWriteFile).toHaveBeenCalledWith('/tmp/covers/10.jpg', Buffer.from('cover'));
  });

  it('extractAndSave(mp3) omits absent fields and leaves cover null when there is no embedded art', async () => {
    mockExtractAudioMetadata.mockResolvedValue(
      makeAudioResult({
        title: 'Solo Track',
        durationSeconds: 3600,
        chapters: [],
        coverBytes: null,
      }),
    );

    const service = new BookDockMetadataService(repo as never);

    await service.extractAndSave(11, '/tmp/book.mp3', 'mp3', '/tmp/covers');

    const patch = repo.update.mock.calls[1]?.[1] as {
      embeddedMetadata: Record<string, unknown>;
      coverPath: string | null;
      status: string;
    };
    expect(patch.status).toBe('ready');
    expect(patch.coverPath).toBeNull();
    expect(patch.embeddedMetadata).toEqual(expect.objectContaining({ title: 'Solo Track', durationSeconds: 3600 }));
    expect(patch.embeddedMetadata.chapters).toBeUndefined();
    expect(patch.embeddedMetadata.narrators).toBeUndefined();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('extractAndSave(audio) stays ready with empty metadata when the file has no readable tags', async () => {
    mockExtractAudioMetadata.mockResolvedValue(makeAudioResult());

    const service = new BookDockMetadataService(repo as never);

    await service.extractAndSave(12, '/tmp/empty.flac', 'flac', '/tmp/covers');

    const patch = repo.update.mock.calls[1]?.[1] as { embeddedMetadata: Record<string, unknown>; coverPath: string | null; status: string };
    expect(patch.status).toBe('ready');
    expect(patch.coverPath).toBeNull();
    expect(Object.values(patch.embeddedMetadata).every((value) => value === undefined)).toBe(true);
  });

  it.each(['m4b', 'm4a', 'mp3', 'opus', 'ogg', 'flac'])(
    'routes %s uploads through the audio extractor, not the generic cover path',
    async (format) => {
      mockExtractAudioMetadata.mockResolvedValue(makeAudioResult({ durationSeconds: 100 }));

      const service = new BookDockMetadataService(repo as never);

      await service.extractAndSave(1, `/tmp/audio.${format}`, format, '/tmp/covers');

      expect(mockExtractAudioMetadata).toHaveBeenCalledWith(`/tmp/audio.${format}`);
      expect(mockExtractCover).not.toHaveBeenCalled();
    },
  );
});
