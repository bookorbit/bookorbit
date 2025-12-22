import { readFile } from 'fs/promises';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse: (buf: Buffer, opts?: { max?: number }) => Promise<{ info: unknown; numpages: number }> = require('pdf-parse');

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

/**
 * Extracts the cover image (first page rendered to JPEG) is not feasible
 * without a headless browser. Instead we extract the first embedded image
 * from the PDF binary using a lightweight xref scan.
 *
 * Looks for the first inline JPEG stream (SOI marker FF D8) embedded in
 * the binary. Returns null if none found within a reasonable scan.
 */
function extractFirstJpeg(buf: Buffer): Buffer | null {
  const MAX_SCAN = Math.min(buf.length, 5 * 1024 * 1024); // scan first 5 MB
  for (let i = 0; i < MAX_SCAN - 1; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8) {
      // Find matching EOI (FF D9)
      for (let j = i + 2; j < buf.length - 1; j++) {
        if (buf[j] === 0xff && buf[j + 1] === 0xd9) {
          return buf.subarray(i, j + 2);
        }
      }
    }
  }
  return null;
}

export async function parsePdfFile(absolutePath: string): Promise<PdfParsed | null> {
  try {
    const buf = await readFile(absolutePath);

    // pdf-parse can throw on malformed PDFs; run without text extraction for speed
    const data = await pdfParse(buf, { max: 1 });

    const info = (data.info ?? {}) as Record<string, unknown>;

    const title = clean(info['Title']);
    const authorRaw = clean(info['Author']);
    const subject = clean(info['Subject']);
    const keywords = splitKeywords(clean(info['Keywords']));
    // PDFs rarely store publisher; some use 'Creator' for the authoring app
    // and 'Producer' for the PDF engine — neither is a publisher field.
    const publisher: string | null = null;
    const pageCount = typeof data.numpages === 'number' ? data.numpages : null;

    const authors: PdfParsed['authors'] = authorRaw
      ? authorRaw
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((name) => ({ name, sortName: null }))
      : [];

    const coverBuffer = extractFirstJpeg(buf);

    return { title, authors, subject, keywords, publisher, pageCount, coverBuffer };
  } catch {
    return null;
  }
}
