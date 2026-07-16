import { Logger } from '@nestjs/common';

import type { ParsedBookData } from './extractors/format-extractor.interface';
import { MetadataExtractionService } from './metadata-extraction.service';

const mocks = vi.hoisted(() => ({
  audio: vi.fn(),
  cover: vi.fn(),
  comic: {
    cbz: vi.fn(),
    cbr: vi.fn(),
    cb7: vi.fn(),
  },
  epub: vi.fn(),
  fb2: vi.fn(),
  mobi: vi.fn(),
  opf: vi.fn(),
  pdf: vi.fn(),
  pdfOptions: undefined as { onWarning?: (warning: Record<string, unknown>) => void; extractCover?: boolean } | undefined,
}));

vi.mock('./lib/cover', () => ({
  extractCover: mocks.cover,
}));

vi.mock('./extractors/audio-format.extractor', () => ({
  AudioFormatExtractor: class AudioFormatExtractor {
    extract = mocks.audio;
  },
}));

vi.mock('./extractors/comic-format.extractor', () => ({
  ComicFormatExtractor: class ComicFormatExtractor {
    extract: ReturnType<typeof vi.fn>;

    constructor(format: keyof typeof mocks.comic) {
      this.extract = mocks.comic[format];
    }
  },
}));

vi.mock('./extractors/epub-format.extractor', () => ({
  EpubFormatExtractor: class EpubFormatExtractor {
    extract = mocks.epub;
  },
}));

vi.mock('./extractors/fb2-format.extractor', () => ({
  Fb2FormatExtractor: class Fb2FormatExtractor {
    extract = mocks.fb2;
  },
}));

vi.mock('./extractors/mobi-format.extractor', () => ({
  MobiFormatExtractor: class MobiFormatExtractor {
    extract = mocks.mobi;
  },
}));

vi.mock('./extractors/opf-format.extractor', () => ({
  OpfFormatExtractor: class OpfFormatExtractor {
    extract = mocks.opf;
  },
}));

vi.mock('./extractors/pdf-format.extractor', () => ({
  PdfFormatExtractor: class PdfFormatExtractor {
    extract = mocks.pdf;

    constructor(options: typeof mocks.pdfOptions) {
      mocks.pdfOptions = options;
    }
  },
}));

const extracted: ParsedBookData = {
  title: 'Canonical title',
  authors: [{ name: 'Author', sortName: null }],
  genres: ['Fantasy'],
  cover: Buffer.from('cover'),
};

describe('MetadataExtractionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pdfOptions = undefined;
    for (const extractor of [
      mocks.audio,
      mocks.comic.cbz,
      mocks.comic.cbr,
      mocks.comic.cb7,
      mocks.epub,
      mocks.fb2,
      mocks.mobi,
      mocks.opf,
      mocks.pdf,
    ]) {
      extractor.mockResolvedValue(extracted);
    }
    mocks.cover.mockResolvedValue(null);
  });

  it.each([
    ['epub', mocks.epub],
    ['kepub', mocks.epub],
    ['opf', mocks.opf],
    ['pdf', mocks.pdf],
    ['mobi', mocks.mobi],
    ['azw3', mocks.mobi],
    ['azw', mocks.mobi],
    ['cbz', mocks.comic.cbz],
    ['cbr', mocks.comic.cbr],
    ['cb7', mocks.comic.cb7],
    ['fb2', mocks.fb2],
    ['m4b', mocks.audio],
    ['mp3', mocks.audio],
    ['m4a', mocks.audio],
    ['opus', mocks.audio],
    ['ogg', mocks.audio],
    ['flac', mocks.audio],
  ])('routes %s through its canonical extractor', async (format, extractor) => {
    const service = new MetadataExtractionService();

    await expect(service.extract(`/books/book.${format}`, format)).resolves.toBe(extracted);

    expect(service.supports(format)).toBe(true);
    expect(extractor).toHaveBeenCalledWith(`/books/book.${format}`);
  });

  it('returns null for unsupported formats without invoking an extractor', async () => {
    const service = new MetadataExtractionService();

    await expect(service.extract('/books/book.txt', 'txt')).resolves.toBeNull();

    expect(service.supports('txt')).toBe(false);
    expect(mocks.epub).not.toHaveBeenCalled();
    expect(mocks.audio).not.toHaveBeenCalled();
  });

  it('preserves null extraction results and propagates extractor failures', async () => {
    const service = new MetadataExtractionService();
    mocks.epub.mockResolvedValueOnce(null);
    mocks.pdf.mockRejectedValueOnce(new Error('pdf failed'));

    await expect(service.extract('/books/empty.epub', 'epub')).resolves.toBeNull();
    await expect(service.extract('/books/bad.pdf', 'pdf')).rejects.toThrow('pdf failed');
  });

  it('uses the shared cover fallback only when canonical metadata is unavailable', async () => {
    const service = new MetadataExtractionService();
    mocks.epub.mockResolvedValueOnce(null);
    mocks.cover.mockResolvedValueOnce(Buffer.from('fallback-cover'));

    await expect(service.extractWithCoverFallback('/books/cover-only.epub', 'epub')).resolves.toEqual({
      metadata: null,
      cover: Buffer.from('fallback-cover'),
    });
    expect(mocks.cover).toHaveBeenCalledWith('/books/cover-only.epub', 'epub');

    await expect(service.extractWithCoverFallback('/books/complete.epub', 'epub')).resolves.toEqual({
      metadata: extracted,
      cover: extracted.cover,
    });
    expect(mocks.cover).toHaveBeenCalledTimes(1);
  });

  it('enables PDF cover extraction and sanitizes parser warnings', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    new MetadataExtractionService();

    expect(mocks.pdfOptions?.extractCover).toBe(true);
    mocks.pdfOptions?.onWarning?.({
      code: 'cover-extraction-failed',
      absolutePath: '/books/bad\npath.pdf',
      errorClass: 'Error',
      errorMessage: 'bad\nmessage',
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('path="/books/bad path.pdf"'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('error="bad message"'));

    mocks.pdfOptions?.onWarning?.({
      code: 'buffered-large-pdf',
      absolutePath: '/books/large.pdf',
      sizeBytes: 10_000_000,
      thresholdBytes: 5_000_000,
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('sizeBytes=10000000 thresholdBytes=5000000'));
  });
});
