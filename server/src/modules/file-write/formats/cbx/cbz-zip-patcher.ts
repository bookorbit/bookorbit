import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import * as unzipper from 'unzipper';
import { replaceFileAtomically } from '../shared/atomic-file-replace';
import { writeZipArchive, type ZipRewriteEntry } from '../shared/zip-rewrite';

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
  await writeZipArchive(tmpPath, rewriteEntries(zip.files, xmlEntryPath, xmlContent));

  await replaceFileAtomically(tmpPath, filePath);
}

function* rewriteEntries(files: readonly unzipper.File[], xmlEntryPath: string, xmlContent: string): Generator<ZipRewriteEntry> {
  for (const entry of files) {
    if (isComicInfoEntry(entry.path)) continue;
    yield { name: entry.path, source: () => entry.stream() };
  }

  yield { name: xmlEntryPath, source: Buffer.from(xmlContent, 'utf-8') };
}
