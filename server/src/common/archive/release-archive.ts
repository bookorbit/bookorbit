import { createWriteStream } from 'fs';
import { mkdir, rm, stat } from 'fs/promises';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

import { createSevenZipTempId, getSevenZip } from '../sevenzip';

/**
 * Expanding a release that arrived as RAR, ZIP or 7z, into a staging directory and never into the
 * download's own directory: writing there would corrupt what the torrent is still seeding.
 *
 * Every bound here is a hard-coded constant rather than a setting. A tripped bound means the
 * release is not the shape a book release is, and the useful answer is a clear failure rather than
 * a prompt asking an operator to raise a number they have no way to reason about.
 */

export type ReleaseArchiveKind = 'zip' | 'rar' | '7z';

export const ARCHIVE_BOUNDS = {
  /**
   * An audiobook set can be genuinely large - a long unabridged reading runs to a couple of
   * gigabytes - but a release past this is not a book, it is a library or a bomb.
   */
  maxTotalBytes: 4 * 1024 ** 3,
  maxEntries: 5_000,
  /** A single book file larger than this is not a book file. A long m4b is around a gigabyte. */
  maxEntryBytes: 2 * 1024 ** 3,
  /** Above this an entry is a decompression bomb rather than a well-compressed book. */
  maxCompressionRatio: 200,
  /**
   * 7z is expanded through a WASM module that holds the archive and its output in memory, so it
   * carries a much lower cap than the streaming formats. Above it, refuse rather than exhaust the
   * heap on a release nobody is watching.
   */
  maxSevenZipArchiveBytes: 512 * 1024 ** 2,
} as const;

export class ReleaseArchiveError extends Error {}

/**
 * Shared across every extraction pass of one release, so unwrapping a zip that holds a rar cannot
 * spend the ceiling twice. Bytes accumulate; entry and per-entry limits apply per archive, since a
 * second archive of ordinary size is not itself suspicious.
 *
 * Two counters, because a size in an archive's directory is a claim and a byte on the wire is a
 * fact, and both have to be bounded. `declaredBytes` is spent while planning, before anything is
 * written; `writtenBytes` is spent as the bytes actually land. They are separate so an honest
 * archive is not charged twice for the same entry, and both span every pass of one release: a
 * counter that restarted per archive would let a nested one spend the ceiling once per level.
 */
export interface ArchiveBudget {
  declaredBytes: number;
  writtenBytes: number;
}

export function createArchiveBudget(): ArchiveBudget {
  return { declaredBytes: 0, writtenBytes: 0 };
}

interface PlannedEntry {
  path: string;
  sizeBytes: number;
  packedBytes: number;
}

/**
 * Extracts one archive into `targetDirectory`, which the caller owns and must remove. Unwrapping a
 * nested archive is the caller's decision, made by calling again with the same `budget`; nothing
 * here recurses on its own.
 */
export async function extractReleaseArchive(
  archivePath: string,
  kind: ReleaseArchiveKind,
  targetDirectory: string,
  budget: ArchiveBudget = createArchiveBudget(),
): Promise<void> {
  await mkdir(targetDirectory, { recursive: true });

  if (kind === 'zip') return extractZip(archivePath, targetDirectory, budget);
  if (kind === 'rar') return extractRar(archivePath, targetDirectory, budget);
  return extractSevenZip(archivePath, targetDirectory, budget);
}

/**
 * Rejects anything that would write outside the extraction root. Absolute paths and `..` are the
 * obvious cases; a normalized path that still escapes covers the rest, including the spellings
 * that only escape after the separators are resolved.
 */
function safeEntryPath(rawPath: string, targetDirectory: string): string {
  const cleaned = rawPath.replace(/\\/g, '/').trim();
  if (!cleaned || cleaned === '.' || cleaned.endsWith('/')) {
    throw new ReleaseArchiveError('The archive contains an entry with no file name');
  }
  if (isAbsolute(cleaned) || /^[a-zA-Z]:/.test(cleaned)) {
    throw new ReleaseArchiveError('The archive contains an absolute path, which is not safe to extract');
  }

  const resolvedTarget = resolve(targetDirectory);
  const resolvedEntry = resolve(resolvedTarget, normalize(cleaned));
  if (resolvedEntry !== resolvedTarget && !resolvedEntry.startsWith(resolvedTarget + sep)) {
    throw new ReleaseArchiveError('The archive contains a path that escapes the extraction folder');
  }
  return resolvedEntry;
}

/** Applied to the whole archive before a single byte is written, so a bomb never lands on disk. */
function planEntries(entries: PlannedEntry[], targetDirectory: string, budget: ArchiveBudget): Array<{ path: string; destination: string }> {
  if (entries.length === 0) throw new ReleaseArchiveError('The archive is empty');
  if (entries.length > ARCHIVE_BOUNDS.maxEntries) {
    throw new ReleaseArchiveError(`The archive contains more than ${ARCHIVE_BOUNDS.maxEntries} files`);
  }

  const planned: Array<{ path: string; destination: string }> = [];

  for (const entry of entries) {
    if (entry.sizeBytes > ARCHIVE_BOUNDS.maxEntryBytes) {
      throw new ReleaseArchiveError('The archive contains a file larger than BookOrbit will extract');
    }
    // The aggregate is checked before the ratio, so a release that is simply too big is reported
    // as too big rather than as a decompression bomb. It spans passes: a zip holding a rar spends
    // one budget between them, not one each.
    budget.declaredBytes += entry.sizeBytes;
    if (budget.declaredBytes > ARCHIVE_BOUNDS.maxTotalBytes) {
      throw new ReleaseArchiveError('The archive expands to more than BookOrbit will extract');
    }

    // Only meaningful for an entry that was actually compressed: a stored entry has a ratio of 1,
    // and a tiny entry's ratio is noise rather than evidence.
    if (entry.packedBytes > 0 && entry.sizeBytes > 1024 * 1024 && entry.sizeBytes / entry.packedBytes > ARCHIVE_BOUNDS.maxCompressionRatio) {
      throw new ReleaseArchiveError('The archive is compressed far beyond what a book release is, and was not extracted');
    }

    planned.push({ path: entry.path, destination: safeEntryPath(entry.path, targetDirectory) });
  }

  return planned;
}

async function extractZip(archivePath: string, targetDirectory: string, budget: ArchiveBudget): Promise<void> {
  const unzipper = await import('unzipper');
  const directory = await unzipper.Open.file(archivePath).catch(() => {
    throw new ReleaseArchiveError('That ZIP file could not be read');
  });

  const files = directory.files.filter((file) => file.type === 'File');
  // Bit 0 of the general-purpose flag. An encrypted entry streams as garbage rather than failing,
  // so it has to be refused up front or the release imports as unreadable bytes.
  if (files.some((file) => ((file as { flags?: number }).flags ?? 0) & 0x1)) {
    throw new ReleaseArchiveError('That ZIP file is password protected');
  }

  const planned = planEntries(
    files.map((file) => ({ path: file.path, sizeBytes: file.uncompressedSize ?? 0, packedBytes: file.compressedSize ?? 0 })),
    targetDirectory,
    budget,
  );
  const destinations = new Map(planned.map((entry) => [entry.path, entry.destination]));

  // The sizes in a ZIP's directory are a claim, not a fact: an entry may declare a kilobyte and
  // then stream gigabytes. So both ceilings are enforced again as the bytes actually land, against
  // the budget's own written counter rather than the declared one.
  for (const file of files) {
    const destination = destinations.get(file.path);
    if (!destination) continue;
    await mkdir(dirname(destination), { recursive: true });
    await pipeline(file.stream(), meterBytes(budget), createWriteStream(destination));
  }
}

/**
 * Both runtime ceilings, per entry and in aggregate. A lying directory is the whole reason this
 * exists, so a claim of a kilobyte buys an entry nothing once it starts streaming gigabytes.
 */
function meterBytes(budget: ArchiveBudget): Transform {
  let entryBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      entryBytes += chunk.length;
      if (entryBytes > ARCHIVE_BOUNDS.maxEntryBytes) {
        callback(new ReleaseArchiveError('The archive contains a file larger than BookOrbit will extract'));
        return;
      }
      budget.writtenBytes += chunk.length;
      if (budget.writtenBytes > ARCHIVE_BOUNDS.maxTotalBytes) {
        callback(new ReleaseArchiveError('The archive expands to more than BookOrbit will extract'));
        return;
      }
      callback(null, chunk);
    },
  });
}

async function extractRar(archivePath: string, targetDirectory: string, budget: ArchiveBudget): Promise<void> {
  const { createExtractorFromFile } = await import('node-unrar-js');
  const extractor = await createExtractorFromFile({ filepath: archivePath, targetPath: targetDirectory }).catch(() => {
    throw new ReleaseArchiveError('That RAR file could not be read');
  });

  // Opening succeeds on any readable file; it is reading the header that rejects a non-RAR, and
  // the library's own wording ("File is not RAR archive") is not what an operator should be shown.
  const list = (() => {
    try {
      return extractor.getFileList();
    } catch {
      throw new ReleaseArchiveError('That RAR file could not be read');
    }
  })();

  if (list.arcHeader.flags.headerEncrypted) throw new ReleaseArchiveError('That RAR file is password protected');

  const headers = (() => {
    try {
      return [...list.fileHeaders].filter((header) => !header.flags.directory);
    } catch {
      throw new ReleaseArchiveError('That RAR file could not be read');
    }
  })();
  if (headers.some((header) => header.flags.encrypted)) throw new ReleaseArchiveError('That RAR file is password protected');

  const planned = planEntries(
    headers.map((header) => ({ path: header.name, sizeBytes: header.unpSize, packedBytes: header.packSize })),
    targetDirectory,
    budget,
  );
  const wanted = new Set(planned.map((entry) => entry.path));

  try {
    // The generator is lazy: extraction only happens as it is walked.
    const extracted = extractor.extract({ files: (header) => wanted.has(header.name) });
    for (const _file of extracted.files) void _file;
  } catch (error) {
    // A multi-volume set that is missing volumes fails here rather than silently importing the
    // part that happened to be readable, which is the outcome worth protecting against.
    const reason = (error as { reason?: string }).reason;
    if (reason === 'ERAR_MISSING_PASSWORD' || reason === 'ERAR_BAD_PASSWORD') {
      throw new ReleaseArchiveError('That RAR file is password protected');
    }
    throw new ReleaseArchiveError(
      list.arcHeader.flags.volume
        ? 'That RAR release is split across volumes and at least one of them could not be read'
        : 'That RAR file could not be extracted',
    );
  }
}

async function extractSevenZip(archivePath: string, targetDirectory: string, budget: ArchiveBudget): Promise<void> {
  const { size } = await stat(archivePath);
  if (size > ARCHIVE_BOUNDS.maxSevenZipArchiveBytes) {
    throw new ReleaseArchiveError('That 7z file is too large for BookOrbit to extract');
  }

  const sevenZip = await getSevenZip();
  // A random id rather than a timestamp: the WASM filesystem is one shared instance, so two
  // extractions starting in the same millisecond collided on the directory name, and whichever
  // finished first removed the other one's tree out from under it.
  const workingDirectory = `/${createSevenZipTempId('release')}`;
  const archiveName = `${workingDirectory}/archive.7z`;

  try {
    sevenZip.FS.mkdir(workingDirectory);
    const bytes = await readFileBytes(archivePath);
    const fd = sevenZip.FS.open(archiveName, 'w+');
    sevenZip.FS.write(fd, bytes, 0, bytes.length);
    sevenZip.FS.close(fd);

    try {
      sevenZip.callMain(['x', archiveName, `-o${workingDirectory}/out`, '-y', '-p']);
    } catch {
      throw new ReleaseArchiveError('That 7z file could not be extracted, and may be password protected');
    }

    // Sizes first, contents afterwards. `stat` reads the entry's length without materializing it,
    // so a release past a bound is refused while its bytes are still only in the WASM heap rather
    // than also copied into ours. The heap itself is what the archive-size cap above bounds.
    const entries = collectSevenZipEntries(sevenZip, `${workingDirectory}/out`, '');
    const planned = planEntries(
      entries.map((entry) => ({ path: entry.relativePath, sizeBytes: entry.sizeBytes, packedBytes: entry.sizeBytes })),
      targetDirectory,
      budget,
    );

    for (const [index, entry] of planned.entries()) {
      const source = entries[index]!;
      const contents = sevenZip.FS.readFile(source.path);
      // Metered against what was read rather than what was claimed, and before it lands, so a
      // directory that understated an entry does not get to write it anyway.
      budget.writtenBytes += contents.length;
      if (budget.writtenBytes > ARCHIVE_BOUNDS.maxTotalBytes) {
        throw new ReleaseArchiveError('The archive expands to more than BookOrbit will extract');
      }
      await mkdir(dirname(entry.destination), { recursive: true });
      await writeFileBytes(entry.destination, contents);
      // Freed as it goes, so the peak is the archive plus one file rather than both copies whole.
      try {
        sevenZip.FS.unlink(source.path);
      } catch {
        // Best effort: the finally below removes whatever is left of the tree.
      }
    }
  } finally {
    removeSevenZipDirectory(sevenZip, workingDirectory);
  }
}

/** Walks the expanded tree for paths and sizes only; nothing is read into our heap here. */
function collectSevenZipEntries(
  sevenZip: Awaited<ReturnType<typeof getSevenZip>>,
  path: string,
  relativePath: string,
): Array<{ relativePath: string; path: string; sizeBytes: number }> {
  const collected: Array<{ relativePath: string; path: string; sizeBytes: number }> = [];

  let names: string[];
  try {
    names = sevenZip.FS.readdir(path).filter((name) => name !== '.' && name !== '..');
  } catch {
    return collected;
  }

  for (const name of names) {
    const child = `${path}/${name}`;
    const childRelative = relativePath ? `${relativePath}/${name}` : name;
    const stats = statSevenZipEntry(sevenZip, child);
    if (stats === null) continue;
    if (stats.isDirectory) {
      collected.push(...collectSevenZipEntries(sevenZip, child, childRelative));
      continue;
    }
    collected.push({ relativePath: childRelative, path: child, sizeBytes: stats.sizeBytes });
  }

  return collected;
}

function statSevenZipEntry(sevenZip: Awaited<ReturnType<typeof getSevenZip>>, path: string): { isDirectory: boolean; sizeBytes: number } | null {
  try {
    const stats = sevenZip.FS.stat(path);
    return { isDirectory: sevenZip.FS.isDir(stats.mode), sizeBytes: stats.size };
  } catch {
    return null;
  }
}

function removeSevenZipDirectory(sevenZip: Awaited<ReturnType<typeof getSevenZip>>, path: string): void {
  let names: string[];
  try {
    names = sevenZip.FS.readdir(path).filter((name) => name !== '.' && name !== '..');
  } catch {
    return;
  }

  for (const name of names) {
    const child = `${path}/${name}`;
    try {
      sevenZip.FS.unlink(child);
    } catch {
      removeSevenZipDirectory(sevenZip, child);
    }
  }

  try {
    sevenZip.FS.rmdir(path);
  } catch {
    // Best effort: a leftover directory in the WASM FS is not worth failing an import over.
  }
}

async function readFileBytes(path: string): Promise<Uint8Array> {
  const { readFile } = await import('fs/promises');
  return new Uint8Array(await readFile(path));
}

async function writeFileBytes(path: string, bytes: Uint8Array): Promise<void> {
  const { writeFile } = await import('fs/promises');
  await writeFile(path, bytes);
}

/** Removes an extraction directory in full. Only ever called on a directory this module created. */
export async function removeExtractionDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => {});
}

/**
 * Where one import expands a release.
 *
 * `token` keeps two imports of the same download apart. They should not overlap - the attempt is
 * claimed before either starts - but the cost of being wrong is one pass deleting the tree the
 * other is still reading out of, in a `finally` that cannot tell whose it was.
 */
export function extractionDirectoryFor(stagingRoot: string, downloadId: number, token: string): string {
  return join(stagingRoot, `release-${downloadId}-${token}`);
}
