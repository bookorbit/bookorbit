import { execFile } from 'child_process';
import { promisify } from 'util';

import { findIsbnInText, type IsbnHit, mergeIsbnHits } from './isbn-detect';

const execFileAsync = promisify(execFile);

const PAGE_WINDOW_FRONT = 10;
const PAGE_WINDOW_BACK = 5;
const PDFTOTEXT_TIMEOUT_MS = 20_000;
const PDFTOTEXT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

function pageWindows(pageCount: number | null): [number, number][] {
  if (!pageCount || pageCount < 1) return [[1, PAGE_WINDOW_FRONT]];
  if (pageCount <= PAGE_WINDOW_FRONT + PAGE_WINDOW_BACK) return [[1, pageCount]];
  return [
    [1, PAGE_WINDOW_FRONT],
    [pageCount - PAGE_WINDOW_BACK + 1, pageCount],
  ];
}

async function pageText(absolutePath: string, first: number, last: number): Promise<string> {
  const { stdout } = await execFileAsync('pdftotext', ['-q', '-enc', 'UTF-8', '-f', String(first), '-l', String(last), absolutePath, '-'], {
    timeout: PDFTOTEXT_TIMEOUT_MS,
    maxBuffer: PDFTOTEXT_MAX_BUFFER_BYTES,
  });
  return stdout;
}

/**
 * Every ISBN printed in a PDF's first and last pages, read with poppler's `pdftotext`. Null when
 * the text cannot be extracted. A scanned PDF with no text layer yields no hits, not null.
 */
export async function readPdfIsbnHits(absolutePath: string, pageCount: number | null): Promise<IsbnHit[] | null> {
  try {
    const passages: IsbnHit[][] = [];
    for (const [first, last] of pageWindows(pageCount)) {
      passages.push(findIsbnInText(await pageText(absolutePath, first, last)));
    }
    return mergeIsbnHits(passages);
  } catch {
    return null;
  }
}
