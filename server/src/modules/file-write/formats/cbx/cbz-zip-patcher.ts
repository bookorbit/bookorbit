import { createWriteStream } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';
import * as unzipper from 'unzipper';
import { ZipArchive, type Archiver } from 'archiver';
import { replaceFileAtomically } from '../shared/atomic-file-replace';
import { destroyAndClose } from '../shared/destroy-and-close';
import { removeFileIfPresent } from '../shared/remove-file-if-present';

function isComicInfoEntry(entryPath: string): boolean {
  const normalized = entryPath.replace(/\\/g, '/').toLowerCase();
  return normalized === 'comicinfo.xml' || normalized.endsWith('/comicinfo.xml');
}

export async function readComicInfoFromZip(filePath: string): Promise<string | null> {
  const zip = await unzipper.Open.file(filePath);
  const entry = zip.files.find((f) => isComicInfoEntry(f.path));
  if (!entry) return null;
  return (await entry.buffer()).toString('utf-8');
}

export async function writeComicInfoToZip(filePath: string, xmlContent: string): Promise<void> {
  const zip = await unzipper.Open.file(filePath);
  const existing = zip.files.find((f) => isComicInfoEntry(f.path));
  const xmlEntryPath = existing?.path ?? 'ComicInfo.xml';

  const tmpPath = join(dirname(filePath), `.cbx-write-${randomUUID()}`);

  const archive = new ZipArchive({ zlib: { level: 6 } });
  const output = createWriteStream(tmpPath);

  try {
    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);

      for (const entry of zip.files) {
        if (isComicInfoEntry(entry.path)) continue;
        appendEntryStream(archive, entry, reject);
      }

      archive.append(Buffer.from(xmlContent, 'utf-8'), { name: xmlEntryPath });
      void archive.finalize();
    });

    await replaceFileAtomically(tmpPath, filePath);
  } catch (error) {
    // the writer may still hold tmpPath open, so stop it and wait for the handle to
    // be released before unlinking, otherwise the delete fails and is swallowed
    if (typeof archive.destroy === 'function') archive.destroy();
    await destroyAndClose(output);
    await removeFileIfPresent(tmpPath);
    throw error;
  }
}

function appendEntryStream(archive: Archiver, entry: { path: string; stream: () => Readable }, reject: (error: Error) => void): void {
  const source = entry.stream();
  source.once('error', reject);
  archive.append(source, { name: entry.path });
}
