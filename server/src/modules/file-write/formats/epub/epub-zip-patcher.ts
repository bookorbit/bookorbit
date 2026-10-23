import { randomUUID } from 'crypto';
import { dirname, join } from 'path';
import * as unzipper from 'unzipper';
import { replaceFileAtomically } from '../shared/atomic-file-replace';
import { rewriteEpubZip } from './epub-zip-rewrite';

export async function readEntry(filePath: string, entryPath: string): Promise<string> {
  const zip = await unzipper.Open.file(filePath);
  const entry = zip.files.find((f) => f.path === entryPath);
  if (!entry) throw new Error(`Entry not found in EPUB: ${entryPath}`);
  return (await entry.buffer()).toString('utf-8');
}

export async function listEntryPaths(filePath: string): Promise<string[]> {
  const zip = await unzipper.Open.file(filePath);
  return zip.files.map((entry) => entry.path);
}

export async function patch(filePath: string, patches: Map<string, Buffer>): Promise<void> {
  // A hidden, random name like every other writer: appending ".tmp" overflowed long file names and
  // would have overwritten a user's own file of that name.
  const tmpPath = join(dirname(filePath), `.epub-write-${randomUUID()}`);
  await rewriteEpubZip(filePath, tmpPath, patches);
  await replaceFileAtomically(tmpPath, filePath);
}
