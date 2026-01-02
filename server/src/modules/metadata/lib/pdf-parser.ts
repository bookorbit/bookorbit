import { exec } from 'child_process';
import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { PDFParse } from 'pdf-parse';

const execAsync = promisify(exec);

export interface PdfParsed {
  title: string | null;
  authors: { name: string; sortName: string | null }[];
  subject: string | null;
  keywords: string[];
  publisher: string | null;
  pageCount: number | null;
  coverBuffer: Buffer | null;
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s.length > 0 ? s : null;
}

function splitKeywords(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Renders the first page of a PDF to JPEG using pdftoppm. */
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
    const parser = new PDFParse({ data: buf });
    const data = await parser.getInfo();
    await parser.destroy();

    const info = (data.info ?? {}) as Record<string, unknown>;

    const title = clean(info['Title']);
    const authorRaw = clean(info['Author']);
    const subject = clean(info['Subject']);
    const keywords = splitKeywords(clean(info['Keywords']));
    // PDFs rarely store publisher; some use 'Creator' for the authoring app
    // and 'Producer' for the PDF engine — neither is a publisher field.
    const publisher: string | null = null;
    const pageCount = typeof data.total === 'number' ? data.total : null;

    const authors: PdfParsed['authors'] = authorRaw
      ? authorRaw
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((name) => ({ name, sortName: null }))
      : [];

    const coverBuffer = await extractPdfCover(absolutePath);

    return { title, authors, subject, keywords, publisher, pageCount, coverBuffer };
  } catch {
    return null;
  }
}
