import { Injectable } from '@nestjs/common';

import type { WriteResult } from '@projectx/types';
import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import type { FormatWriter } from '../../interfaces/format-writer.interface';
import type { FormatWriteOptions } from '../../interfaces/format-write-options.interface';
import { resolveFieldsWritten } from '../shared/resolve-fields-written';
import { buildComicInfoXml } from './comic-info-builder';
import { readComicInfoFromZip, writeComicInfoToZip } from './cbz-zip-patcher';

const CBX_WRITABLE_FIELDS = new Set<BookWritePayloadKey>([
  'title',
  'subtitle',
  'description',
  'publisher',
  'publishedYear',
  'language',
  'pageCount',
  'seriesName',
  'seriesIndex',
  'isbn10',
  'isbn13',
  'rating',
  'authors',
  'genres',
  'tags',
  'googleBooksId',
  'goodreadsId',
  'amazonId',
  'hardcoverId',
  'openLibraryId',
]);

@Injectable()
export class CbzFormatWriter implements FormatWriter {
  readonly format = 'cbz';

  async write(filePath: string, payload: BookWritePayload, options: FormatWriteOptions): Promise<WriteResult> {
    const start = Date.now();
    const { fieldMask, dryRun } = options;
    const cbxFieldMask = new Set([...fieldMask].filter((key) => CBX_WRITABLE_FIELDS.has(key)));
    const fieldsWritten = resolveFieldsWritten(payload, cbxFieldMask);

    if (dryRun) {
      return { status: 'skipped', reason: 'dry-run', fieldsWritten, durationMs: Date.now() - start };
    }

    const existingXml = await readComicInfoFromZip(filePath);
    const xml = buildComicInfoXml(existingXml, payload, cbxFieldMask);
    await writeComicInfoToZip(filePath, xml);

    return { status: 'success', fieldsWritten, durationMs: Date.now() - start };
  }
}
