import { Injectable } from '@nestjs/common';
import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

import type { WriteResult } from '@projectx/types';
import { getSevenZip, type SevenZipFS } from '../../../../common/sevenzip';
import type { BookWritePayload } from '../../interfaces/book-write-payload.interface';
import type { FormatWriter } from '../../interfaces/format-writer.interface';
import type { FormatWriteOptions } from '../../interfaces/format-write-options.interface';
import { replaceFileAtomically } from '../shared/atomic-file-replace';
import { resolveFieldsWritten } from '../shared/resolve-fields-written';
import { buildComicInfoXml } from './comic-info-builder';

// All WASM FS ops are synchronous - Node's single-threaded event loop guarantees
// that synchronous blocks from concurrent writes never interleave with each other.
// The archive path uses a unique ID to avoid VFS collisions across concurrent writes.
// The XML path is shared but safe: it is only used within synchronous blocks and
// is always written before it is added to the archive, with no await in between.
const VFS_XML_PATH = '/ComicInfo.xml';
const ENOENT_ERRNO = 44;

@Injectable()
export class Cb7FormatWriter implements FormatWriter {
  readonly format = 'cb7';

  async write(filePath: string, payload: BookWritePayload, options: FormatWriteOptions): Promise<WriteResult> {
    const start = Date.now();
    const { fieldMask, dryRun } = options;
    const fieldsWritten = resolveFieldsWritten(payload, fieldMask);

    if (dryRun) {
      return { status: 'skipped', reason: 'dry-run', fieldsWritten, durationMs: Date.now() - start };
    }

    const uid = randomUUID().replace(/-/g, '');
    const vfsArchivePath = `/cbx-arc-${uid}.cb7`;
    const vfsExtractDir = `/cbx-ext-${uid}`;

    const sz = await getSevenZip();

    try {
      const archiveBytes = await readFile(filePath);

      // --- synchronous block start: no awaits until we're done with the VFS ---

      const fd = sz.FS.open(vfsArchivePath, 'w+');
      sz.FS.write(fd, archiveBytes, 0, archiveBytes.length);
      sz.FS.close(fd);

      let existingXml: string | null = null;
      try {
        sz.FS.mkdir(vfsExtractDir);
        sz.callMain(['e', vfsArchivePath, `-o${vfsExtractDir}`, 'ComicInfo.xml', '-y']);
        const raw = sz.FS.readFile(`${vfsExtractDir}/ComicInfo.xml`);
        existingXml = Buffer.from(raw).toString('utf-8');
      } catch (error) {
        if (!isMissingComicInfoError(error)) {
          throw error;
        }
        // No ComicInfo.xml in archive - start fresh
      }

      const xml = buildComicInfoXml(existingXml, payload, fieldMask);
      const xmlBytes = Buffer.from(xml, 'utf-8');

      const fd2 = sz.FS.open(VFS_XML_PATH, 'w+');
      sz.FS.write(fd2, xmlBytes, 0, xmlBytes.length);
      sz.FS.close(fd2);

      // Delete old entry (if any) then add the updated one.
      // 7z strips the leading / from absolute VFS paths, so /ComicInfo.xml
      // is stored in the archive as ComicInfo.xml at the root.
      sz.callMain(['d', vfsArchivePath, 'ComicInfo.xml', '-y']);
      sz.callMain(['a', vfsArchivePath, VFS_XML_PATH]);

      const modifiedBytes = sz.FS.readFile(vfsArchivePath);

      // --- synchronous block end ---

      const tmpPath = join(dirname(filePath), `.cbx-write-${uid}`);
      await writeFile(tmpPath, modifiedBytes);
      await replaceFileAtomically(tmpPath, filePath);

      return { status: 'success', fieldsWritten, durationMs: Date.now() - start };
    } finally {
      cleanupVfs(sz.FS, vfsArchivePath, vfsExtractDir);
    }
  }
}

function cleanupVfs(vfs: SevenZipFS, archivePath: string, extractDir: string): void {
  unlinkIfExists(vfs, VFS_XML_PATH);
  unlinkIfExists(vfs, archivePath);
  unlinkIfExists(vfs, `${archivePath}.7z`);

  const files = readDirIfExists(vfs, extractDir);
  if (!files) return;

  for (const f of files) {
    if (f === '.' || f === '..') continue;
    unlinkIfExists(vfs, `${extractDir}/${f}`);
  }

  try {
    vfs.rmdir(extractDir);
  } catch (error) {
    if (!isMissingVfsPathError(error)) {
      throw error;
    }
  }
}

function unlinkIfExists(vfs: SevenZipFS, path: string): void {
  try {
    vfs.unlink(path);
  } catch (error) {
    if (!isMissingVfsPathError(error)) {
      throw error;
    }
  }
}

function readDirIfExists(vfs: SevenZipFS, path: string): string[] | null {
  try {
    return vfs.readdir(path);
  } catch (error) {
    if (isMissingVfsPathError(error)) {
      return null;
    }
    throw error;
  }
}

function isMissingComicInfoError(error: unknown): boolean {
  const message = normalizeErrorMessage(error);
  return isMissingVfsPathError(error) || message.includes('no files to process');
}

function isMissingVfsPathError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'errno' in error && (error as { errno?: unknown }).errno === ENOENT_ERRNO) {
    return true;
  }
  const message = normalizeErrorMessage(error);
  return (
    message.includes('no such file') || message.includes('not found') || message.includes('does not exist') || message.includes('path not found')
  );
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  return String(error).toLowerCase();
}
