import { randomUUID } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { PDFDocument, PDFName } from 'pdf-lib';

import { PDF_BOOK_FILE_WRITE_FIELDS, type WriteResult } from '@bookorbit/types';
import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import { replaceFileAtomically } from '../shared/atomic-file-replace';
import { BOOKORBIT_NS_PREFIX } from '../shared/bookorbit-ns';
import { resolveFieldsWritten } from '../shared/resolve-fields-written';
import { buildXmp } from './pdf-xmp-builder';

const PDF_WRITABLE_FIELDS = new Set<BookWritePayloadKey>(PDF_BOOK_FILE_WRITE_FIELDS);

export function resolvePdfFieldsWritten(
  payload: BookWritePayload,
  fieldMask: Set<BookWritePayloadKey>,
): {
  fieldsWritten: string[];
  pdfFieldMask: Set<BookWritePayloadKey>;
} {
  const pdfFieldMask = new Set([...fieldMask].filter((key) => PDF_WRITABLE_FIELDS.has(key)));
  return {
    fieldsWritten: resolveFieldsWritten(payload, pdfFieldMask),
    pdfFieldMask,
  };
}

export async function writePdfMetadataInProcess(
  filePath: string,
  payload: BookWritePayload,
  pdfFieldMask: Set<BookWritePayloadKey>,
  startedAt = Date.now(),
): Promise<WriteResult> {
  const fieldsWritten = resolveFieldsWritten(payload, pdfFieldMask);
  const originalBytes = await readFile(filePath);
  const pdfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });

  // pdf-lib cannot re-encrypt, so saving an encrypted PDF would strip its
  // encryption and write back still-encrypted byte streams, silently corrupting
  // the file. Skip the file write (DB metadata is persisted separately).
  if (pdfDoc.isEncrypted) {
    return { status: 'skipped', reason: 'encrypted-pdf', fieldsWritten: [], durationMs: Date.now() - startedAt };
  }

  applyInfoDict(pdfDoc, payload, pdfFieldMask);
  embedXmp(pdfDoc, buildXmp(payload, pdfFieldMask));

  const savedBytes = await pdfDoc.save();

  const tempPath = join(dirname(filePath), `.tmp-${randomUUID()}.pdf`);
  await writeFile(tempPath, savedBytes);
  await replaceFileAtomically(tempPath, filePath);

  return { status: 'success', fieldsWritten, durationMs: Date.now() - startedAt };
}

function applyInfoDict(pdfDoc: PDFDocument, payload: BookWritePayload, fieldMask: Set<BookWritePayloadKey>): void {
  if (fieldMask.has('title') && payload.title != null) {
    pdfDoc.setTitle(payload.title);
  }
  if (fieldMask.has('authors') && payload.authors?.length) {
    pdfDoc.setAuthor(payload.authors.map((a) => a.name).join(', '));
  }
  if (fieldMask.has('description') && payload.description != null) {
    pdfDoc.setSubject(payload.description);
  }
  const publicationDate = resolvePublicationDate(payload, fieldMask);
  if (publicationDate != null) {
    pdfDoc.setCreationDate(new Date(`${publicationDate}T00:00:00.000Z`));
  }

  pdfDoc.setCreator(BOOKORBIT_NS_PREFIX);

  const keywords: string[] = [];
  if (fieldMask.has('genres') && payload.genres?.length) keywords.push(...payload.genres);
  if (fieldMask.has('tags') && payload.tags?.length) keywords.push(...payload.tags);
  if (keywords.length) {
    pdfDoc.setKeywords(keywords);
  }
}

function resolvePublicationDate(payload: BookWritePayload, fieldMask: Set<BookWritePayloadKey>): string | null {
  if (fieldMask.has('publishedDate') && payload.publishedDate != null) return payload.publishedDate;
  if (fieldMask.has('publishedYear')) {
    if (payload.publishedDate != null) return payload.publishedDate;
    if (payload.publishedYear != null) return `${payload.publishedYear}-01-01`;
  }
  return null;
}

function embedXmp(pdfDoc: PDFDocument, xmpXml: string): void {
  const xmpBytes = Buffer.from(xmpXml, 'utf-8');
  const xmpStream = pdfDoc.context.stream(xmpBytes, {
    Type: 'Metadata',
    Subtype: 'XML',
  });
  pdfDoc.catalog.set(PDFName.of('Metadata'), pdfDoc.context.register(xmpStream));
}
