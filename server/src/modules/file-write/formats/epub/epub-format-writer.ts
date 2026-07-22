import { Injectable } from '@nestjs/common';

import type { WriteResult } from '@bookorbit/types';
import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import type { FormatWriter } from '../../interfaces/format-writer.interface';
import type { FormatWriteOptions } from '../../interfaces/format-write-options.interface';
import { locateOpf } from './epub-opf-locator';
import * as EpubZipPatcher from './epub-zip-patcher';
import { build as buildOpf } from './epub-opf-builder';
import * as EpubCoverHandler from './epub-cover-handler';
import { inspectCoverImage } from './epub-cover-image';

@Injectable()
export class EpubFormatWriter implements FormatWriter {
  readonly format = 'epub';

  async write(filePath: string, payload: BookWritePayload, options: FormatWriteOptions): Promise<WriteResult> {
    const start = Date.now();

    const { opfPath, opfDir } = await locateOpf(filePath);
    const opfXml = await EpubZipPatcher.readEntry(filePath, opfPath);
    const { newOpfXml, fieldsWritten } = buildOpf(opfXml, payload);

    const patches = new Map<string, Buffer>([[opfPath, Buffer.from(newOpfXml)]]);

    if (payload.coverBytes && options.fieldMask.has('coverBytes' as BookWritePayloadKey)) {
      const coverImage = await inspectCoverImage(payload.coverBytes);
      const occupiedEntryPaths = await EpubZipPatcher.listEntryPaths(filePath);
      const slot = await EpubCoverHandler.locate(opfXml, opfDir, (entryPath) => EpubZipPatcher.readEntry(filePath, entryPath));
      const coverWrite = slot
        ? EpubCoverHandler.replace(newOpfXml, opfDir, slot, coverImage, occupiedEntryPaths)
        : EpubCoverHandler.inject(newOpfXml, opfDir, coverImage, occupiedEntryPaths);
      const resolvedCoverWrite = coverWrite ?? EpubCoverHandler.inject(newOpfXml, opfDir, coverImage, occupiedEntryPaths);

      patches.set(opfPath, Buffer.from(resolvedCoverWrite.updatedOpfXml));
      patches.set(resolvedCoverWrite.newEntryPath, payload.coverBytes);
      if (resolvedCoverWrite.documentPatch) {
        patches.set(resolvedCoverWrite.documentPatch.entryPath, Buffer.from(resolvedCoverWrite.documentPatch.xml));
      }
      fieldsWritten.push('coverBytes');
    }

    if (options.dryRun) {
      return { status: 'skipped', reason: 'dry-run', fieldsWritten, durationMs: Date.now() - start };
    }

    await EpubZipPatcher.patch(filePath, patches);
    return { status: 'success', fieldsWritten, durationMs: Date.now() - start };
  }
}
