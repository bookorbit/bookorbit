import { Injectable } from '@nestjs/common';

import type { WriteResult } from '@projectx/types';
import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import type { FormatWriter } from '../../interfaces/format-writer.interface';
import type { FormatWriteOptions } from '../../interfaces/format-write-options.interface';
import { locateOpf } from './epub-opf-locator';
import * as EpubZipPatcher from './epub-zip-patcher';
import { build as buildOpf } from './epub-opf-builder';
import * as EpubCoverHandler from './epub-cover-handler';

@Injectable()
export class EpubFormatWriter implements FormatWriter {
  readonly format = 'epub';

  async write(filePath: string, payload: BookWritePayload, options: FormatWriteOptions): Promise<WriteResult> {
    const start = Date.now();

    const { opfPath, opfDir } = await locateOpf(filePath);
    const opfXml = await EpubZipPatcher.readEntry(filePath, opfPath);
    const { newOpfXml, fieldsWritten } = buildOpf(opfXml, payload, options);

    const patches = new Map<string, Buffer>([[opfPath, Buffer.from(newOpfXml)]]);

    if (payload.coverBytes && options.fieldMask.has('coverBytes' as BookWritePayloadKey)) {
      const slot = EpubCoverHandler.locate(opfXml, opfDir);
      if (slot) {
        patches.set(slot.entryPath, payload.coverBytes);
        fieldsWritten.push('coverBytes');
      } else {
        const { updatedOpfXml, newEntryPath } = EpubCoverHandler.inject(newOpfXml, opfDir, payload.coverBytes);
        patches.set(opfPath, Buffer.from(updatedOpfXml));
        patches.set(newEntryPath, payload.coverBytes);
        fieldsWritten.push('coverBytes');
      }
    }

    if (options.dryRun) {
      return { status: 'skipped', reason: 'dry-run', fieldsWritten, durationMs: Date.now() - start };
    }

    await EpubZipPatcher.patch(filePath, patches);
    return { status: 'success', fieldsWritten, durationMs: Date.now() - start };
  }
}
