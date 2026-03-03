import { Injectable } from '@nestjs/common';
import { readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { PDFDocument, PDFName } from 'pdf-lib';

import type { WriteResult } from '@projectx/types';
import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import type { FormatWriter } from '../../interfaces/format-writer.interface';
import type { FormatWriteOptions } from '../../interfaces/format-write-options.interface';
import { PROJECTX_NS_PREFIX } from '../shared/projectx-ns';
import { resolveFieldsWritten } from '../shared/resolve-fields-written';
import { buildXmp } from './pdf-xmp-builder';

@Injectable()
export class PdfFormatWriter implements FormatWriter {
  readonly format = 'pdf';

  async write(filePath: string, payload: BookWritePayload, options: FormatWriteOptions): Promise<WriteResult> {
    const start = Date.now();
    const { fieldMask, dryRun } = options;
    const fieldsWritten = resolveFieldsWritten(payload, fieldMask);

    if (dryRun) {
      return { status: 'skipped', reason: 'dry-run', fieldsWritten, durationMs: Date.now() - start };
    }

    const originalBytes = await readFile(filePath);
    const pdfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });

    applyInfoDict(pdfDoc, payload, fieldMask);
    embedXmp(pdfDoc, buildXmp(payload, fieldMask));

    const savedBytes = await pdfDoc.save();

    const tempPath = join(dirname(filePath), `.tmp-${randomUUID()}.pdf`);
    try {
      await writeFile(tempPath, savedBytes);
      await rename(tempPath, filePath);
    } catch (err) {
      await unlink(tempPath).catch(() => {});
      throw err;
    }

    return { status: 'success', fieldsWritten, durationMs: Date.now() - start };
  }
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
  if (fieldMask.has('publisher') && payload.publisher != null) {
    pdfDoc.setProducer(payload.publisher);
  }
  if (fieldMask.has('publishedYear') && payload.publishedYear != null) {
    pdfDoc.setCreationDate(new Date(payload.publishedYear, 0, 1));
  }

  pdfDoc.setCreator(PROJECTX_NS_PREFIX);

  const keywords: string[] = [];
  if (fieldMask.has('genres') && payload.genres?.length) keywords.push(...payload.genres);
  if (fieldMask.has('tags') && payload.tags?.length) keywords.push(...payload.tags);
  if (keywords.length) {
    pdfDoc.setKeywords(keywords);
  }
}

function embedXmp(pdfDoc: PDFDocument, xmpXml: string): void {
  const xmpBytes = Buffer.from(xmpXml, 'utf-8');
  const xmpStream = pdfDoc.context.stream(xmpBytes, {
    Type: 'Metadata',
    Subtype: 'XML',
  });
  pdfDoc.catalog.set(PDFName.of('Metadata'), pdfDoc.context.register(xmpStream));
}
