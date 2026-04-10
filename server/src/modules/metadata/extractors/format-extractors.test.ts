import type { MockedFunction } from 'vitest';

vi.mock('../lib/epub', () => ({
  extractEpubMetadata: vi.fn(),
}));

vi.mock('../lib/cover-epub', () => ({
  extractEpubCover: vi.fn(),
}));

vi.mock('../lib/fb2-parser', () => ({
  parseFb2File: vi.fn(),
}));

vi.mock('../lib/cover-fb2', () => ({
  extractFb2Cover: vi.fn(),
}));

vi.mock('../lib/cbz-metadata', () => ({
  extractCbzMetadata: vi.fn(),
  extractCbrMetadata: vi.fn(),
  extractCb7Metadata: vi.fn(),
}));

vi.mock('../lib/cover-cbz', () => ({
  extractCbzCover: vi.fn(),
}));

vi.mock('../lib/cover-cbr', () => ({
  extractCbrCover: vi.fn(),
}));

vi.mock('../lib/cover-cb7', () => ({
  extractCb7Cover: vi.fn(),
}));

vi.mock('../lib/filename-parser', () => ({
  parseBookFilename: vi.fn(),
}));

vi.mock('../lib/mobi-parser', () => ({
  parseMobiFile: vi.fn(),
  extractMobiCover: vi.fn(),
}));

vi.mock('../lib/pdf-parser', () => ({
  parsePdfFile: vi.fn(),
}));

vi.mock('./audio.extractor', () => ({
  extractAudioMetadata: vi.fn(),
}));

import { extractEpubCover } from '../lib/cover-epub';
import { extractFb2Cover } from '../lib/cover-fb2';
import { extractCbrCover } from '../lib/cover-cbr';
import { extractCbzCover } from '../lib/cover-cbz';
import { extractCbrMetadata, extractCbzMetadata } from '../lib/cbz-metadata';
import { parseBookFilename } from '../lib/filename-parser';
import { parseFb2File } from '../lib/fb2-parser';
import { extractEpubMetadata } from '../lib/epub';
import { extractMobiCover, parseMobiFile } from '../lib/mobi-parser';
import { parsePdfFile } from '../lib/pdf-parser';
import { extractAudioMetadata } from './audio.extractor';
import { AudioFormatExtractor } from './audio-format.extractor';
import { ComicFormatExtractor } from './comic-format.extractor';
import { EpubFormatExtractor } from './epub-format.extractor';
import { Fb2FormatExtractor } from './fb2-format.extractor';
import { MobiFormatExtractor } from './mobi-format.extractor';
import { PdfFormatExtractor } from './pdf-format.extractor';

const mockExtractEpubMetadata = extractEpubMetadata as MockedFunction<typeof extractEpubMetadata>;
const mockExtractEpubCover = extractEpubCover as MockedFunction<typeof extractEpubCover>;
const mockParseFb2File = parseFb2File as MockedFunction<typeof parseFb2File>;
const mockExtractFb2Cover = extractFb2Cover as MockedFunction<typeof extractFb2Cover>;
const mockExtractCbzMetadata = extractCbzMetadata as MockedFunction<typeof extractCbzMetadata>;
const mockExtractCbrMetadata = extractCbrMetadata as MockedFunction<typeof extractCbrMetadata>;
const mockExtractCbzCover = extractCbzCover as MockedFunction<typeof extractCbzCover>;
const mockExtractCbrCover = extractCbrCover as MockedFunction<typeof extractCbrCover>;
const mockParseBookFilename = parseBookFilename as MockedFunction<typeof parseBookFilename>;
const mockParseMobiFile = parseMobiFile as MockedFunction<typeof parseMobiFile>;
const mockExtractMobiCover = extractMobiCover as MockedFunction<typeof extractMobiCover>;
const mockParsePdfFile = parsePdfFile as MockedFunction<typeof parsePdfFile>;
const mockExtractAudioMetadata = extractAudioMetadata as MockedFunction<typeof extractAudioMetadata>;

describe('metadata format extractors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseBookFilename.mockReturnValue({ title: 'Fallback Title', publishedYear: 2001 });
  });

  it('epub extractor returns null when metadata cannot be parsed', async () => {
    mockExtractEpubMetadata.mockResolvedValue(null);
    mockExtractEpubCover.mockResolvedValue(Buffer.from('cover'));

    await expect(new EpubFormatExtractor().extract('/books/test.epub')).resolves.toBeNull();
  });

  it('epub extractor falls back to tags when genres are missing and tolerates cover extraction errors', async () => {
    mockExtractEpubMetadata.mockResolvedValue({
      title: 'Dune',
      subtitle: 'Book One',
      description: null,
      isbn10: null,
      isbn13: null,
      publisher: 'Ace',
      publishedYear: 1965,
      language: 'en',
      seriesName: null,
      seriesIndex: null,
      authors: [{ name: 'Frank Herbert', sortName: null }],
      genres: [],
      tags: ['Science Fiction'],
    });
    mockExtractEpubCover.mockRejectedValue(new Error('cover unavailable'));

    await expect(new EpubFormatExtractor().extract('/books/test.epub')).resolves.toEqual(
      expect.objectContaining({
        title: 'Dune',
        genres: ['Science Fiction'],
        cover: null,
      }),
    );
  });

  it('fb2 extractor maps parsed metadata and nulls cover when extraction fails', async () => {
    mockParseFb2File.mockResolvedValue({
      title: 'Roadside Picnic',
      description: 'Sci-fi classic',
      publishedYear: 1972,
      language: 'ru',
      seriesName: null,
      seriesIndex: null,
      authors: [{ name: 'Arkady Strugatsky', sortName: null }],
      genres: ['Science Fiction'],
    });
    mockExtractFb2Cover.mockRejectedValue(new Error('missing binary'));

    await expect(new Fb2FormatExtractor().extract('/books/test.fb2')).resolves.toEqual(
      expect.objectContaining({
        title: 'Roadside Picnic',
        genres: ['Science Fiction'],
        cover: null,
      }),
    );
  });

  it('comic extractor uses filename fallback when embedded metadata is missing', async () => {
    mockExtractCbzMetadata.mockResolvedValue(null);
    mockExtractCbzCover.mockResolvedValue(Buffer.from('cover'));
    mockParseBookFilename.mockReturnValue({ title: 'Saga Vol 1', publishedYear: 2014 });

    await expect(new ComicFormatExtractor('cbz').extract('/books/saga.cbz')).resolves.toEqual(
      expect.objectContaining({
        title: 'Saga Vol 1',
        publishedYear: 2014,
        authors: [],
        genres: [],
      }),
    );
  });

  it('comic extractor prefers explicit metadata fields and keeps comic metadata payload', async () => {
    mockExtractCbrMetadata.mockResolvedValue({
      title: 'Batman',
      description: 'Issue details',
      publisher: 'DC',
      publishedYear: 2020,
      language: 'en',
      seriesName: 'Batman',
      seriesIndex: 55,
      authors: [{ name: 'Writer', sortName: null }],
      genres: ['Comics'],
      tags: ['Superhero'],
      comicMetadata: { issueNumber: '55', volumeName: 'Batman' },
    });
    mockExtractCbrCover.mockResolvedValue(null);

    await expect(new ComicFormatExtractor('cbr').extract('/books/batman.cbr')).resolves.toEqual(
      expect.objectContaining({
        title: 'Batman',
        genres: ['Comics'],
        comicMetadata: { issueNumber: '55', volumeName: 'Batman' },
      }),
    );
  });

  it('mobi extractor parses year from publishedDate and tolerates missing cover', async () => {
    mockParseMobiFile.mockResolvedValue({
      title: 'Snow Crash',
      description: null,
      isbn: '9780553380958',
      publisher: 'Bantam',
      publishedDate: '1992-06-01',
      language: 'en',
      authors: ['Neal Stephenson'],
      tags: ['Cyberpunk'],
    });
    mockExtractMobiCover.mockRejectedValue(new Error('cover unavailable'));

    await expect(new MobiFormatExtractor().extract('/books/snow-crash.mobi')).resolves.toEqual(
      expect.objectContaining({
        publishedYear: 1992,
        cover: null,
      }),
    );
  });

  it('pdf extractor returns null for unparseable PDFs', async () => {
    mockParsePdfFile.mockResolvedValue(null);

    await expect(new PdfFormatExtractor().extract('/books/test.pdf')).resolves.toBeNull();
  });

  it('pdf extractor passes parser options and falls back to filename fields when title is missing', async () => {
    const onWarning = vi.fn();
    mockParsePdfFile.mockResolvedValue({
      title: null,
      subtitle: null,
      description: null,
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      authors: [],
      genres: [],
      tags: [],
      rating: null,
      googleBooksId: null,
      goodreadsId: null,
      amazonId: null,
      hardcoverId: null,
      openLibraryId: null,
      itunesId: null,
      coverBuffer: null,
      pageCount: 320,
    });
    mockParseBookFilename.mockReturnValue({ title: 'Filename Title', publishedYear: 2003 });

    const result = await new PdfFormatExtractor({ extractCover: true, onWarning }).extract('/books/test.pdf');

    expect(mockParsePdfFile).toHaveBeenCalledWith(
      '/books/test.pdf',
      expect.objectContaining({
        extractCover: true,
        onWarning,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        title: 'Filename Title',
        publishedYear: 2003,
        pageCount: 320,
      }),
    );
  });

  it('audio extractor maps core metadata, narrators, duration, and chapters', async () => {
    mockExtractAudioMetadata.mockResolvedValue({
      title: 'Project Hail Mary',
      description: 'Audiobook',
      publisher: 'Random House',
      publishedYear: 2021,
      language: 'en',
      authors: [{ name: 'Andy Weir', sortName: null }],
      narrators: ['Ray Porter'],
      durationSeconds: 3600,
      chapters: [{ title: 'Chapter 1', startMs: 0 }],
      coverBytes: Buffer.from('cover'),
    });

    await expect(new AudioFormatExtractor().extract('/books/hail-mary.m4b')).resolves.toEqual(
      expect.objectContaining({
        title: 'Project Hail Mary',
        narrators: ['Ray Porter'],
        durationSeconds: 3600,
        chapters: [{ title: 'Chapter 1', startMs: 0 }],
        cover: Buffer.from('cover'),
      }),
    );
  });
});
