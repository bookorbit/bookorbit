import { readFile } from 'fs/promises';
import { PDFDocument } from 'pdf-lib';

export async function getPdfPageCount(absolutePath: string): Promise<number> {
  const buf = await readFile(absolutePath);
  const doc = await PDFDocument.load(buf, { updateMetadata: false });
  return doc.getPageCount();
}
