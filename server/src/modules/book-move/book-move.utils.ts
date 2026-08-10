import { createHash } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { copyFile, mkdir, open, readdir, rename as fsRename, rmdir, stat, unlink } from 'fs/promises';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'path';
import { pipeline } from 'stream/promises';

export const MAX_PATH_LENGTH = 4096;

export interface MovedFileStat {
  ino: bigint;
  sizeBytes: number;
  mtime: Date;
}

export interface MoveFileOutcome {
  crossDevice: boolean;
  stat: MovedFileStat;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined;
}

export function isCrossDeviceError(error: unknown): boolean {
  return errorCode(error) === 'EXDEV';
}

export function isMissingPathError(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}

/**
 * True when `candidate` resolves inside `root`. Mirrors the containment idiom used
 * by the path policy and rename services: purely lexical, so callers that accept
 * user-supplied roots must also canonicalize symlinks separately.
 */
export function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(normalize(root), normalize(candidate));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Full-content hash. Deliberately not the scanner's sampled hash: this verifies copies. */
export async function computeContentHash(absolutePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(absolutePath), async function* (source) {
    for await (const chunk of source) {
      hash.update(chunk as Buffer);
      yield chunk;
    }
  });
  return hash.digest('hex');
}

async function copyWithSourceHash(from: string, to: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(
    createReadStream(from),
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk as Buffer);
        yield chunk;
      }
    },
    createWriteStream(to),
  );
  return hash.digest('hex');
}

/** Flush the destination to disk so the source can be unlinked without risking the only copy. */
async function fsyncPath(absolutePath: string): Promise<void> {
  const handle = await open(absolutePath, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function statMoved(absolutePath: string): Promise<MovedFileStat> {
  const info = await stat(absolutePath, { bigint: true });
  return {
    ino: info.ino,
    sizeBytes: Number(info.size),
    mtime: new Date(Number(info.mtimeMs)),
  };
}

/**
 * Moves one file, preferring `rename` so the inode (and therefore the scanner's move
 * detection) is preserved. Falls back to copy + full-hash verification + fsync +
 * unlink when the destination lives on another filesystem, which mergerfs and
 * multi-volume setups hit routinely. The source is only removed once the destination
 * is verified byte-identical and flushed.
 */
export async function moveFile(from: string, to: string): Promise<MoveFileOutcome> {
  await mkdir(dirname(to), { recursive: true });

  try {
    await fsRename(from, to);
    return { crossDevice: false, stat: await statMoved(to) };
  } catch (error) {
    if (!isCrossDeviceError(error)) throw error;
  }

  let sourceHash: string;
  try {
    sourceHash = await copyWithSourceHash(from, to);
  } catch (error) {
    await unlink(to).catch(() => {});
    throw error;
  }

  try {
    const destinationHash = await computeContentHash(to);
    if (destinationHash !== sourceHash) {
      throw new Error(`Copy verification failed: destination hash does not match source for ${from}`);
    }
    await fsyncPath(to);
  } catch (error) {
    await unlink(to).catch(() => {});
    throw error;
  }

  const movedStat = await statMoved(to);
  await unlink(from);
  return { crossDevice: true, stat: movedStat };
}

/** Restores a file to its original location during rollback. Best effort by design. */
export async function moveFileBack(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  try {
    await fsRename(from, to);
    return;
  } catch (error) {
    if (!isCrossDeviceError(error)) throw error;
  }
  await copyFile(from, to);
  await unlink(from);
}

/** Removes the directory when empty, plus one parent level, matching rename cleanup. */
export async function removeEmptyDirs(directory: string, stopAtRoot: string): Promise<void> {
  let current = normalize(directory);
  for (let level = 0; level < 2; level++) {
    if (!isInsideRoot(stopAtRoot, current)) return;
    try {
      const entries = await readdir(current);
      if (entries.length > 0) return;
      await rmdir(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}

/**
 * Every path the move touches, for `SelfWriteRegistry`. Unlike the rename service's
 * builder this spans two library roots, since a cross-library move writes under both.
 * Ancestor directories are included because directory events are watched too.
 */
export function buildSuppressionPaths(input: {
  sourcePaths: string[];
  targetPaths: string[];
  sourceFolderPath: string;
  targetFolderPath: string;
  roots: string[];
}): string[] {
  const paths = new Set<string>();
  const roots = input.roots.map((root) => normalize(root));

  const addWithAncestors = (rawPath: string): void => {
    const owningRoot = roots.find((root) => isInsideRoot(root, rawPath));
    if (!owningRoot) return;

    let current = normalize(rawPath);
    while (isInsideRoot(owningRoot, current)) {
      paths.add(current);
      current = dirname(current);
    }
  };

  for (const path of [...input.sourcePaths, ...input.targetPaths, input.sourceFolderPath, input.targetFolderPath]) {
    addWithAncestors(path);
  }

  return [...paths];
}

/**
 * Appends a numeric suffix to the last path segment, before the extension when one
 * is given. Used to resolve destination collisions under the "keep both" policy.
 */
export function withCollisionSuffix(absolutePath: string, attempt: number, extension: string): string {
  const directory = dirname(absolutePath);
  const base = absolutePath.slice(directory.length + 1);
  const hasExtension = extension.length > 0 && base.toLowerCase().endsWith(extension.toLowerCase());
  const splitAt = hasExtension ? base.length - extension.length : base.length;
  // Keep the original casing of the extension: on a case-sensitive filesystem
  // rewriting it would change which file the path refers to.
  return join(directory, `${base.slice(0, splitAt)} (${attempt})${base.slice(splitAt)}`);
}

export async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}
