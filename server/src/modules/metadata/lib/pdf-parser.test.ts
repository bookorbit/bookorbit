vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
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

vi.mock('./pdf-poppler-metadata', () => ({
  extractPopplerPdfMetadata: vi.fn(),
}));

vi.mock('./pdf-parse-worker-runner', () => ({
  parsePdfFileInWorker: vi.fn(),
}));

import { readFile, stat } from 'fs/promises';
import type { MockedFunction } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { extractPdfCover } from './pdf-cover';
import { extractPopplerPdfMetadata } from './pdf-poppler-metadata';
import { parsePdfFile, PDF_BUFFER_WARNING_BYTES, type PdfParsed } from './pdf-parser';
import { parsePdfFileInWorker } from './pdf-parse-worker-runner';
import { extractXmpXml, parseXmp } from './pdf-xmp-reader';

const mockReadFile = readFile as MockedFunction<typeof readFile>;
const mockStat = stat as MockedFunction<typeof stat>;
const mockPdfLoad = PDFDocument.load as MockedFunction<typeof PDFDocument.load>;
const mockExtractXmpXml = extractXmpXml as MockedFunction<typeof extractXmpXml>;
const mockParseXmp = parseXmp as MockedFunction<typeof parseXmp>;
const mockExtractPdfCover = extractPdfCover as MockedFunction<typeof extractPdfCover>;
const mockExtractPopplerPdfMetadata = extractPopplerPdfMetadata as MockedFunction<typeof extractPopplerPdfMetadata>;
const mockParsePdfFileInWorker = parsePdfFileInWorker as MockedFunction<typeof parsePdfFileInWorker>;

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

function makeParsed(overrides: Partial<PdfParsed> = {}): PdfParsed {
  return {
    title: 'Worker Title',
    subtitle: null,
    authors: [{ name: 'Worker Author', sortName: null }],
    description: null,
    publisher: null,
    publishedYear: null,
    language: null,
    genres: [],
    tags: [],
    isbn10: null,
    isbn13: null,
    seriesName: null,
    seriesIndex: null,
    rating: null,
    pageCount: 100,
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
    coverBuffer: null,
    ...overrides,
  };
}

describe('parsePdfFile', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockStat.mockResolvedValue({ size: PDF_BUFFER_WARNING_BYTES - 1 } as never);
    mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7') as never);
    mockPdfLoad.mockResolvedValue(makePdfDoc() as never);
    mockExtractXmpXml.mockReturnValue(null);
    mockParseXmp.mockReturnValue(null);
    mockExtractPdfCover.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));
    mockExtractPopplerPdfMetadata.mockResolvedValue(null);
    mockParsePdfFileInWorker.mockResolvedValue({ parsed: makeParsed(), warnings: [] });
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
      hardcoverEditionId: '8941973',
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
        hardcoverEditionId: '8941973',
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

  it('uses Poppler XMP metadata for encrypted PDFs instead of encrypted pdf-lib strings', async () => {
    mockPdfLoad.mockResolvedValue(
      makePdfDoc({
        isEncrypted: true,
        getTitle: () => 'hfá\u0012G²\u0017Ã$ÎŁe',
        getAuthor: () => 'hfá\u0012G²',
        getKeywords: () => 'ihè\u00171Wü"',
      }) as never,
    );
    mockExtractPopplerPdfMetadata.mockResolvedValue({
      title: 'Lonely Planet - Southern Italy',
      author: 'Lonely Planet',
      subject: null,
      keywords: 'Magazine',
      creator: 'Adobe InDesign CS6 (Windows)',
      producer: 'Adobe PDF Library 10.0.1',
      pageCount: 299,
      xmpXml: '<xmp/>',
    });
    mockParseXmp.mockReturnValue({
      title: 'Lonely Planet - Southern Italy',
      subtitle: null,
      description: null,
      publisher: null,
      publishedYear: 2015,
      language: 'en',
      authors: [{ name: 'Lonely Planet', sortName: null }],
      genres: [],
      tags: ['Magazine'],
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
      hardcoverEditionId: null,
      openLibraryId: null,
      ranobedbId: null,
      itunesId: null,
    });

    const parsed = await parsePdfFile('/books/southern-italy.pdf');

    expect(mockExtractPopplerPdfMetadata).toHaveBeenCalledWith('/books/southern-italy.pdf');
    expect(mockExtractXmpXml).not.toHaveBeenCalled();
    expect(parsed).toEqual(
      expect.objectContaining({
        title: 'Lonely Planet - Southern Italy',
        authors: [{ name: 'Lonely Planet', sortName: null }],
        tags: ['Magazine'],
        publishedYear: 2015,
        language: 'en',
        pageCount: 299,
      }),
    );
  });

  it('uses Poppler Info metadata for encrypted PDFs when decrypted XMP is absent', async () => {
    mockPdfLoad.mockResolvedValue(
      makePdfDoc({
        isEncrypted: true,
        getTitle: () => 'o\u0001ÍžÐ_<ÐK',
        getAuthor: () => 'o\u0001ÍžÐ',
        getKeywords: () => 'n\u000fÄıÆOrå',
      }) as never,
    );
    mockExtractPopplerPdfMetadata.mockResolvedValue({
      title: 'Lonely Planet - Greece',
      author: 'Lonely Planet',
      subject: 'Travel guide',
      keywords: 'Magazine',
      creator: 'Adobe InDesign CS6 (Windows)',
      producer: 'Adobe PDF Library 10.0.1',
      pageCount: 755,
      xmpXml: null,
    });

    const parsed = await parsePdfFile('/books/greece.pdf');

    expect(mockExtractXmpXml).not.toHaveBeenCalled();
    expect(parsed).toEqual(
      expect.objectContaining({
        title: 'Lonely Planet - Greece',
        authors: [{ name: 'Lonely Planet', sortName: null }],
        description: 'Travel guide',
        tags: ['Magazine'],
        pageCount: 755,
      }),
    );
  });

  it('does not persist encrypted pdf-lib metadata when the encrypted fallback fails', async () => {
    mockPdfLoad.mockResolvedValue(
      makePdfDoc({
        isEncrypted: true,
        getTitle: () => 'hfá\u0012G²\u0017Ã$ÎŁe',
        getAuthor: () => 'hfá\u0012G²',
        getKeywords: () => 'ihè\u00171Wü"',
      }) as never,
    );
    mockExtractPopplerPdfMetadata.mockRejectedValue(new Error('pdfinfo missing'));
    const onWarning = vi.fn();

    const parsed = await parsePdfFile('/books/encrypted.pdf', { onWarning });

    expect(mockExtractXmpXml).not.toHaveBeenCalled();
    expect(parsed).toEqual(
      expect.objectContaining({
        title: null,
        authors: [],
        description: null,
        tags: [],
        pageCount: 123,
      }),
    );
    expect(onWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'encrypted-metadata-fallback-failed',
        absolutePath: '/books/encrypted.pdf',
        errorClass: 'Error',
        errorMessage: 'pdfinfo missing',
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
    mockStat.mockResolvedValue({ size: PDF_BUFFER_WARNING_BYTES } as never);
    const onWarning = vi.fn();

    const parsed = await parsePdfFile('/books/large.pdf', { onWarning });

    expect(parsed).toEqual(expect.objectContaining({ title: 'Worker Title' }));
    expect(onWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'buffered-large-pdf',
        absolutePath: '/books/large.pdf',
        sizeBytes: PDF_BUFFER_WARNING_BYTES,
        thresholdBytes: PDF_BUFFER_WARNING_BYTES,
      }),
    );
    expect(mockParsePdfFileInWorker).toHaveBeenCalledWith({
      absolutePath: '/books/large.pdf',
      extractCover: false,
    });
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockPdfLoad).not.toHaveBeenCalled();
  });

  it('replays large PDF worker warnings through the caller warning handler', async () => {
    mockStat.mockResolvedValue({ size: PDF_BUFFER_WARNING_BYTES + 1 } as never);
    mockParsePdfFileInWorker.mockResolvedValue({
      parsed: makeParsed(),
      warnings: [
        {
          code: 'cover-extraction-failed',
          absolutePath: '/books/large.pdf',
          errorClass: 'Error',
          errorMessage: 'pdftoppm missing',
        },
      ],
    });
    const onWarning = vi.fn();

    await parsePdfFile('/books/large.pdf', { extractCover: true, onWarning });

    expect(mockParsePdfFileInWorker).toHaveBeenCalledWith({
      absolutePath: '/books/large.pdf',
      extractCover: true,
    });
    expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({ code: 'buffered-large-pdf' }));
    expect(onWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'cover-extraction-failed',
        errorMessage: 'pdftoppm missing',
      }),
    );
  });

  it('returns null and emits a parse warning when the large PDF worker fails', async () => {
    mockStat.mockResolvedValue({ size: PDF_BUFFER_WARNING_BYTES + 1 } as never);
    mockParsePdfFileInWorker.mockRejectedValue(new Error('worker failed'));
    const onWarning = vi.fn();

    await expect(parsePdfFile('/books/large.pdf', { onWarning })).resolves.toBeNull();
    expect(onWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'parse-failed',
        absolutePath: '/books/large.pdf',
        errorClass: 'Error',
        errorMessage: 'worker failed',
      }),
    );
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockPdfLoad).not.toHaveBeenCalled();
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
      hardcoverEditionId: null,
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
      hardcoverEditionId: null,
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
