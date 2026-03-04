import { Injectable } from '@nestjs/common';

import type { WriteResult } from '@projectx/types';
import type { BookWritePayload } from '../../interfaces/book-write-payload.interface';
import type { FormatWriter } from '../../interfaces/format-writer.interface';
import type { FormatWriteOptions } from '../../interfaces/format-write-options.interface';
import { resolveFieldsWritten } from '../shared/resolve-fields-written';
import { buildComicInfoXml } from './comic-info-builder';
import { readComicInfoFromZip, writeComicInfoToZip } from './cbz-zip-patcher';

@Injectable()
export class CbzFormatWriter implements FormatWriter {
  readonly format = 'cbz';

  async write(filePath: string, payload: BookWritePayload, options: FormatWriteOptions): Promise<WriteResult> {
    const start = Date.now();
    const { fieldMask, dryRun } = options;
    const fieldsWritten = resolveFieldsWritten(payload, fieldMask);

    if (dryRun) {
      return { status: 'skipped', reason: 'dry-run', fieldsWritten, durationMs: Date.now() - start };
    }

    const existingXml = await readComicInfoFromZip(filePath);
    const xml = buildComicInfoXml(existingXml, payload, fieldMask);
    await writeComicInfoToZip(filePath, xml);

    return { status: 'success', fieldsWritten, durationMs: Date.now() - start };
  }
}
