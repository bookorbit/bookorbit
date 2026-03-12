import { exec } from 'child_process';
import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { PDFDocument } from 'pdf-lib';

import { extractXmpXml, parseXmp, type XmpParsed } from './pdf-xmp-reader';

const execAsync = promisify(exec);

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
  itunesId: string | null;
  coverBuffer: Buffer | null;
}

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

async function extractPdfCover(absolutePath: string): Promise<Buffer | null> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'pdf-cover-'));
  try {
    const outPrefix = join(tmpDir, 'cover');
    await execAsync(`pdftoppm -jpeg -r 150 -f 1 -l 1 "${absolutePath}" "${outPrefix}"`);
    const files = await readdir(tmpDir);
    const coverFile = files.find((f) => f.endsWith('.jpg'));
    if (!coverFile) return null;
    return await readFile(join(tmpDir, coverFile));
  } catch {
    return null;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export async function parsePdfFile(absolutePath: string): Promise<PdfParsed | null> {
  try {
    const buf = await readFile(absolutePath);
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });

    // XMP is the authoritative source — richer and semantically correct.
    // Info Dictionary is used only as fallback for fields XMP doesn't cover.
    const xmpXml = extractXmpXml(doc);
    const xmp: XmpParsed | null = xmpXml ? parseXmp(xmpXml) : null;

    const infoTitle = clean(doc.getTitle());
    const infoAuthorRaw = clean(doc.getAuthor());
    const infoSubject = clean(doc.getSubject());
    const infoKeywords = splitCommaList(clean(doc.getKeywords()));

    const infoAuthors = infoAuthorRaw
      ? infoAuthorRaw
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((name) => ({ name, sortName: null }))
      : [];

    const coverBuffer = await extractPdfCover(absolutePath);

    return {
      title: xmp?.title ?? infoTitle,
      subtitle: xmp?.subtitle ?? null,
      authors: xmp?.authors?.length ? xmp.authors : infoAuthors,
      description: xmp?.description ?? infoSubject,
      publisher: xmp?.publisher ?? null,
      publishedYear: xmp?.publishedYear ?? null,
      language: xmp?.language ?? null,
      genres: xmp?.genres?.length ? xmp.genres : [],
      // Info Dict keywords are genres+tags mixed — only use as tags when no XMP
      tags: xmp ? xmp.tags : infoKeywords,
      isbn10: xmp?.isbn10 ?? null,
      isbn13: xmp?.isbn13 ?? null,
      seriesName: xmp?.seriesName ?? null,
      seriesIndex: xmp?.seriesIndex ?? null,
      rating: xmp?.rating ?? null,
      pageCount: doc.getPageCount(),
      googleBooksId: xmp?.googleBooksId ?? null,
      goodreadsId: xmp?.goodreadsId ?? null,
      amazonId: xmp?.amazonId ?? null,
      hardcoverId: xmp?.hardcoverId ?? null,
      openLibraryId: xmp?.openLibraryId ?? null,
      itunesId: xmp?.itunesId ?? null,
      coverBuffer,
    };
  } catch {
    return null;
  }
}
