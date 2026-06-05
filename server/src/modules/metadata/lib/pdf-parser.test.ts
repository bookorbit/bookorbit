vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('pdf-lib', () => ({
  PDFDocument: {
    load: vi.fn(),
  },
}));

vi.mock('./pdf-xmp-reader', () => ({
  extractXmpXml: vi.fn(),
  parseXmp: vi.fn(),
}));

vi.mock('./pdf-cover', () => ({
  extractPdfCover: vi.fn(),
}));

import { readFile } from 'fs/promises';
import type { MockedFunction } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { extractPdfCover } from './pdf-cover';
import { parsePdfFile, PDF_BUFFER_WARNING_BYTES } from './pdf-parser';
import { extractXmpXml, parseXmp } from './pdf-xmp-reader';

const mockReadFile = readFile as MockedFunction<typeof readFile>;
const mockPdfLoad = PDFDocument.load as MockedFunction<typeof PDFDocument.load>;
const mockExtractXmpXml = extractXmpXml as MockedFunction<typeof extractXmpXml>;
const mockParseXmp = parseXmp as MockedFunction<typeof parseXmp>;
const mockExtractPdfCover = extractPdfCover as MockedFunction<typeof extractPdfCover>;

function makePdfDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getTitle: () => 'Info Title',
    getAuthor: () => 'Author One; Author Two',
    getCreator: () => null,
    getProducer: () => null,
    getSubject: () => 'Info Subject',
    getKeywords: () => 'tag1, tag2',
    getPageCount: () => 123,
    ...overrides,
  };
}

describe('parsePdfFile', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7') as never);
    mockPdfLoad.mockResolvedValue(makePdfDoc() as never);
    mockExtractXmpXml.mockReturnValue(null);
    mockParseXmp.mockReturnValue(null);
    mockExtractPdfCover.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('prefers XMP metadata and includes extracted cover when requested', async () => {
    mockExtractXmpXml.mockReturnValue('<xmp/>');
    mockParseXmp.mockReturnValue({
      title: 'XMP Title',
      subtitle: 'XMP Subtitle',
      description: 'XMP Description',
      publisher: 'XMP Publisher',
      publishedYear: 2001,
      language: 'en',
      authors: [{ name: 'XMP Author', sortName: null }],
      genres: ['Sci-Fi'],
      tags: ['favorite'],
      isbn10: '0123456789',
      isbn13: '9780123456789',
      seriesName: 'Series',
      seriesIndex: 2,
      rating: 4.5,
      pageCount: 999,
      googleBooksId: 'g1',
      goodreadsId: 'gr1',
      amazonId: 'a1',
      hardcoverId: 'h1',
      openLibraryId: 'ol1',
      ranobedbId: 'ranobe-1',
      itunesId: 'it1',
    });

    const parsed = await parsePdfFile('/books/book.pdf', { extractCover: true });

    expect(parsed).toEqual(
      expect.objectContaining({
        title: 'XMP Title',
        authors: [{ name: 'XMP Author', sortName: null }],
        tags: ['favorite'],
        ranobedbId: 'ranobe-1',
        pageCount: 999,
        coverBuffer: Buffer.from([0xff, 0xd8, 0xff]),
      }),
    );
    expect(mockExtractPdfCover).toHaveBeenCalledWith('/books/book.pdf');
  });

  it('falls back to Info dictionary fields when no XMP is present', async () => {
    const parsed = await parsePdfFile('/books/book.pdf');

    expect(parsed).toEqual(
      expect.objectContaining({
        title: 'Info Title',
        authors: [
          { name: 'Author One', sortName: null },
          { name: 'Author Two', sortName: null },
        ],
        description: 'Info Subject',
        tags: ['tag1', 'tag2'],
        coverBuffer: null,
      }),
    );
  });

  it('skips cover extraction by default for metadata-only callers', async () => {
    const parsed = await parsePdfFile('/books/book.pdf');

    expect(parsed).toEqual(expect.objectContaining({ title: 'Info Title', coverBuffer: null }));
    expect(mockExtractPdfCover).not.toHaveBeenCalled();
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it('returns null coverBuffer and emits a warning when cover extraction fails', async () => {
    mockExtractPdfCover.mockRejectedValue(new Error('pdftoppm missing'));
    const onWarning = vi.fn();

    const parsed = await parsePdfFile('/books/book.pdf', {
      extractCover: true,
      onWarning,
    });

    expect(parsed).toEqual(expect.objectContaining({ title: 'Info Title', coverBuffer: null }));
    expect(onWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'cover-extraction-failed',
        absolutePath: '/books/book.pdf',
        errorClass: 'Error',
        errorMessage: 'pdftoppm missing',
      }),
    );
  });

  it('emits a warning when a large PDF must be buffered in memory', async () => {
    mockReadFile.mockResolvedValue(Buffer.alloc(PDF_BUFFER_WARNING_BYTES) as never);
    const onWarning = vi.fn();

    await parsePdfFile('/books/large.pdf', { onWarning });

    expect(onWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'buffered-large-pdf',
        absolutePath: '/books/large.pdf',
        sizeBytes: PDF_BUFFER_WARNING_BYTES,
        thresholdBytes: PDF_BUFFER_WARNING_BYTES,
      }),
    );
  });

  it('falls back to the native PDF page count when XMP omits bookorbit:pageCount', async () => {
    mockExtractXmpXml.mockReturnValue('<xmp/>');
    mockParseXmp.mockReturnValue({
      title: 'XMP Title',
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
      pageCount: null,
      googleBooksId: null,
      goodreadsId: null,
      amazonId: null,
      hardcoverId: null,
      openLibraryId: null,
      ranobedbId: null,
      itunesId: null,
    });

    const parsed = await parsePdfFile('/books/book.pdf');

    expect(parsed?.pageCount).toBe(123);
  });

  it('does not fall back to Info dictionary publisher/pageCount for bookorbit-authored PDFs when XMP is present', async () => {
    mockPdfLoad.mockResolvedValue(
      makePdfDoc({
        getCreator: () => 'bookorbit',
        getProducer: () => 'Legacy Publisher',
      }) as never,
    );
    mockExtractXmpXml.mockReturnValue('<xmp/>');
    mockParseXmp.mockReturnValue({
      title: 'XMP Title',
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
      pageCount: null,
      googleBooksId: null,
      goodreadsId: null,
      amazonId: null,
      hardcoverId: null,
      openLibraryId: null,
      ranobedbId: null,
      itunesId: null,
    });

    const parsed = await parsePdfFile('/books/book.pdf');

    expect(parsed?.publisher).toBeNull();
    expect(parsed?.pageCount).toBeNull();
  });

  it('falls back to legacy BookOrbit producer metadata when XMP publisher is absent', async () => {
    mockPdfLoad.mockResolvedValue(
      makePdfDoc({
        getCreator: () => 'bookorbit',
        getProducer: () => 'Legacy Publisher',
      }) as never,
    );

    const parsed = await parsePdfFile('/books/book.pdf');

    expect(parsed?.publisher).toBe('Legacy Publisher');
  });

  it('returns null and emits a parse warning when the PDF cannot be read', async () => {
    mockPdfLoad.mockRejectedValue(new Error('invalid pdf'));
    const onWarning = vi.fn();

    await expect(parsePdfFile('/books/bad.pdf', { onWarning })).resolves.toBeNull();
    expect(onWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'parse-failed',
        absolutePath: '/books/bad.pdf',
        errorClass: 'Error',
        errorMessage: 'invalid pdf',
      }),
    );
  });
});
