import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import { dirname, join } from 'path';
import { Logger } from '@nestjs/common';
import { ERR_AMBIGUOUS_ARCHIVE } from '@zip.js/zip.js';
import * as unzipper from 'unzipper';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { replaceFileAtomically } from '../shared/atomic-file-replace';
import { writeZipArchive, type ZipRewriteEntry } from '../shared/zip-rewrite';
import { rewriteEpubZip } from './epub-zip-rewrite';

const MIMETYPE_ENTRY_PATH = 'mimetype';
const EPUB_ZIP_REWRITE_EVENT = 'epub_zip.rewrite';

const logger = new Logger('EpubZipPatcher');

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
  const startedAt = Date.now();
  try {
    await rewriteEpubZip(filePath, tmpPath, patches);
  } catch (error) {
    if (!isAmbiguousArchiveError(error)) throw error;
    // The direct record copy only works when every local header agrees with the central directory.
    // Plenty of readable EPUBs break that, so they are rebuilt entry by entry the way the reader that
    // located the OPF sees them, instead of leaving the book impossible to write.
    logger.warn(
      `[${EPUB_ZIP_REWRITE_EVENT}] [fail] durationMs=${Date.now() - startedAt} errorClass=${error.name} reason="${sanitizeLogValue(error.reason ?? 'unknown')}" error="${sanitizeLogValue(error.message)}" - direct record copy rejected, rewriting every entry instead`,
    );
    await rewriteEveryEntry(filePath, tmpPath, patches);
  }
  await replaceFileAtomically(tmpPath, filePath);
}

function isAmbiguousArchiveError(error: unknown): error is Error & { reason?: string } {
  return error instanceof Error && error.message === ERR_AMBIGUOUS_ARCHIVE;
}

async function rewriteEveryEntry(filePath: string, tmpPath: string, patches: Map<string, Buffer>): Promise<void> {
  const zip = await unzipper.Open.file(filePath);
  try {
    await writeZipArchive(tmpPath, rewriteEntries(zip.files, patches));
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
}

function* rewriteEntries(files: readonly unzipper.File[], patches: Map<string, Buffer>): Generator<ZipRewriteEntry> {
  yield { name: MIMETYPE_ENTRY_PATH, source: Buffer.from('application/epub+zip'), store: true };

  const existing = new Set<string>();
  for (const entry of files) {
    existing.add(entry.path);
    if (entry.path === MIMETYPE_ENTRY_PATH) continue;
    const patched = patches.get(entry.path);
    yield { name: entry.path, source: patched ?? (() => entry.stream()) };
  }

  for (const [path, content] of patches) {
    if (path !== MIMETYPE_ENTRY_PATH && !existing.has(path)) yield { name: path, source: content };
  }
}
