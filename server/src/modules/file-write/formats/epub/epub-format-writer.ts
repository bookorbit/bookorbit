import { Injectable } from '@nestjs/common';

import type { WriteResult } from '@bookorbit/types';
import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import { AUDIO_COVER_UNCHANGED_REASON, type AudioCoverEmbedOptions, type FormatWriter } from '../../interfaces/format-writer.interface';
import type { FormatWriteOptions } from '../../interfaces/format-write-options.interface';
import { locateOpf } from './epub-opf-locator';
import * as EpubZipPatcher from './epub-zip-patcher';
import { build as buildOpf } from './epub-opf-builder';
import * as EpubCoverHandler from './epub-cover-handler';
import { inspectCoverImage, toEpubCoreImage } from './epub-cover-image';

const AUDIO_COVER_FIELD = 'audioCoverBytes';
const MAX_COVER_DOCUMENT_BYTES = 2 * 1024 * 1024;

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
      const slot = await EpubCoverHandler.locate(opfXml, opfDir, (entryPath) =>
        EpubZipPatcher.readEntry(filePath, entryPath, MAX_COVER_DOCUMENT_BYTES),
      );
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

  /**
   * Declares a square audiobook cover inside a read-along EPUB and leaves everything else as it is:
   * no metadata is rewritten and the book cover is untouched. Nothing is written when the image
   * already declared is the same one.
   */
  async embedAudioCover(filePath: string, coverBytes: Buffer, options: AudioCoverEmbedOptions): Promise<WriteResult> {
    const start = Date.now();
    const { bytes, image } = await toEpubCoreImage(coverBytes);

    const { opfPath, opfDir } = await locateOpf(filePath);
    const opfXml = await EpubZipPatcher.readEntry(filePath, opfPath);
    const current = EpubCoverHandler.locateAudioCover(opfXml, opfDir);
    if (current?.mediaType === image.mediaType) {
      const embedded = await EpubZipPatcher.readEntryBuffer(filePath, current.entryPath).catch(() => null);
      if (embedded?.equals(bytes))
        return { status: 'skipped', reason: AUDIO_COVER_UNCHANGED_REASON, fieldsWritten: [], durationMs: Date.now() - start };
    }

    const write = EpubCoverHandler.setAudioCover(opfXml, opfDir, image, await EpubZipPatcher.listEntryPaths(filePath));
    if (options.dryRun) return { status: 'skipped', reason: 'dry-run', fieldsWritten: [AUDIO_COVER_FIELD], durationMs: Date.now() - start };

    const patches = new Map<string, Buffer>([[write.newEntryPath, bytes]]);
    if (write.updatedOpfXml !== opfXml) patches.set(opfPath, Buffer.from(write.updatedOpfXml));
    await options.beforeWrite?.();
    await EpubZipPatcher.patch(filePath, patches, new Set(write.removedEntryPath ? [write.removedEntryPath] : []));
    return { status: 'success', fieldsWritten: [AUDIO_COVER_FIELD], durationMs: Date.now() - start };
  }
}
