import { readFile } from 'fs/promises';
import { PDFDocument } from 'pdf-lib';

import { BOOKORBIT_NS_PREFIX } from '../../../common/bookorbit-ns';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { extractPdfCover } from './pdf-cover';
import { extractXmpXml, parseXmp, type XmpParsed } from './pdf-xmp-reader';

export interface PdfParsed {
  title: string | null;
  subtitle: string | null;
  authors: { name: string; sortName: string | null }[];
  description: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  genres: string[];
  tags: string[];
  isbn10: string | null;
  isbn13: string | null;
  seriesName: string | null;
  seriesIndex: number | null;
  rating: number | null;
  pageCount: number | null;
  googleBooksId: string | null;
  goodreadsId: string | null;
  amazonId: string | null;
  hardcoverId: string | null;
  openLibraryId: string | null;
  ranobedbId: string | null;
  itunesId: string | null;
  coverBuffer: Buffer | null;
}

export interface PdfParseWarning {
  code: 'buffered-large-pdf' | 'cover-extraction-failed' | 'parse-failed';
  absolutePath: string;
  errorClass?: string;
  errorMessage?: string;
  sizeBytes?: number;
  thresholdBytes?: number;
}

export interface PdfParseOptions {
  extractCover?: boolean;
  onWarning?: (warning: PdfParseWarning) => void;
}

export const PDF_BUFFER_WARNING_BYTES = 25 * 1024 * 1024;

function clean(value: string | undefined): string | null {
  if (!value) return null;
  const s = value.trim();
  return s.length > 0 ? s : null;
}

function splitCommaList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function createWarning(code: PdfParseWarning['code'], absolutePath: string, error: unknown): PdfParseWarning {
  const errorClass = error instanceof Error ? error.name : 'Error';
  const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
  return { code, absolutePath, errorClass, errorMessage };
}

function createLargeBufferWarning(absolutePath: string, sizeBytes: number): PdfParseWarning {
  return {
    code: 'buffered-large-pdf',
    absolutePath,
    sizeBytes,
    thresholdBytes: PDF_BUFFER_WARNING_BYTES,
  };
}

export async function parsePdfFile(absolutePath: string, options: PdfParseOptions = {}): Promise<PdfParsed | null> {
  try {
    const buf = await readFile(absolutePath);
    if (buf.length >= PDF_BUFFER_WARNING_BYTES) {
      options.onWarning?.(createLargeBufferWarning(absolutePath, buf.length));
    }
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });

    // XMP is the authoritative source; Info Dictionary is fallback-only.
    const xmpXml = extractXmpXml(doc);
    const xmp: XmpParsed | null = xmpXml ? parseXmp(xmpXml) : null;
    const hasXmp = xmp !== null;

    const infoTitle = clean(doc.getTitle());
    const infoAuthorRaw = clean(doc.getAuthor());
    const infoCreator = clean(doc.getCreator());
    const infoProducer = clean(doc.getProducer());
    const infoSubject = clean(doc.getSubject());
    const infoKeywords = splitCommaList(clean(doc.getKeywords()));
    const isBookorbitInfo = infoCreator === BOOKORBIT_NS_PREFIX;

    const infoAuthors = infoAuthorRaw
      ? infoAuthorRaw
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((name) => ({ name, sortName: null }))
      : [];

    let coverBuffer: Buffer | null = null;
    if (options.extractCover === true) {
      try {
        coverBuffer = await extractPdfCover(absolutePath);
      } catch (error) {
        options.onWarning?.(createWarning('cover-extraction-failed', absolutePath, error));
      }
    }

    return {
      title: hasXmp ? xmp.title : infoTitle,
      subtitle: xmp?.subtitle ?? null,
      authors: hasXmp ? xmp.authors : infoAuthors,
      description: hasXmp ? xmp.description : infoSubject,
      publisher: hasXmp ? (xmp.publisher ?? null) : isBookorbitInfo ? infoProducer : null,
      publishedYear: xmp?.publishedYear ?? null,
      language: xmp?.language ?? null,
      genres: xmp?.genres?.length ? xmp.genres : [],
      // Info Dict keywords are genres+tags mixed; only use as tags when XMP is absent.
      tags: hasXmp ? xmp.tags : infoKeywords,
      isbn10: xmp?.isbn10 ?? null,
      isbn13: xmp?.isbn13 ?? null,
      seriesName: xmp?.seriesName ?? null,
      seriesIndex: xmp?.seriesIndex ?? null,
      rating: xmp?.rating ?? null,
      pageCount: hasXmp ? (xmp.pageCount ?? (isBookorbitInfo ? null : doc.getPageCount())) : doc.getPageCount(),
      googleBooksId: xmp?.googleBooksId ?? null,
      goodreadsId: xmp?.goodreadsId ?? null,
      amazonId: xmp?.amazonId ?? null,
      hardcoverId: xmp?.hardcoverId ?? null,
      openLibraryId: xmp?.openLibraryId ?? null,
      ranobedbId: xmp?.ranobedbId ?? null,
      itunesId: xmp?.itunesId ?? null,
      coverBuffer,
    };
  } catch (error) {
    options.onWarning?.(createWarning('parse-failed', absolutePath, error));
    return null;
  }
}
