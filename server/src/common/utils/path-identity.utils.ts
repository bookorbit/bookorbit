import { lstat, readdir } from 'fs/promises';
import { isAbsolute, join, normalize, parse, relative, sep } from 'path';

function foldPathValue(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

function splitSegments(value: string): string[] {
  return value.split(sep).filter(Boolean);
}

function resolveWalkStart(normalizedPath: string, basePath: string | undefined): { start: string; segments: string[] } | null {
  if (basePath === undefined) {
    const { root } = parse(normalizedPath);
    if (!root) return null;
    return { start: root, segments: splitSegments(normalizedPath.slice(root.length)) };
  }

  const normalizedBase = normalize(basePath);
  const relativePath = relative(normalizedBase, normalizedPath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return null;

  return { start: normalizedBase, segments: splitSegments(relativePath) };
}

/**
 * Resolves the spelling a path is actually stored under, which can differ from the requested
 * spelling on case-insensitive or normalization-insensitive filesystems. Passing basePath keeps
 * the walk inside a known-good root instead of listing every directory up from the filesystem root.
 */
export async function resolveExistingPathSpelling(inputPath: string, basePath?: string): Promise<string | null> {
  const normalizedPath = normalize(inputPath);
  const walk = resolveWalkStart(normalizedPath, basePath);
  if (!walk) return null;

  try {
    await lstat(normalizedPath);
  } catch {
    return null;
  }

  let currentPath = walk.start;

  for (const segment of walk.segments) {
    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch {
      return null;
    }

    if (entries.includes(segment)) {
      currentPath = join(currentPath, segment);
      continue;
    }

    const foldedSegment = foldPathValue(segment);
    const matches = entries.filter((entry) => foldPathValue(entry) === foldedSegment);
    if (matches.length !== 1) return null;
    currentPath = join(currentPath, matches[0]!);
  }

  return currentPath;
}

export async function pathsReferToSameEntry(firstPath: string, secondPath: string, basePath?: string): Promise<boolean> {
  const normalizedFirst = normalize(firstPath);
  const normalizedSecond = normalize(secondPath);
  if (normalizedFirst === normalizedSecond) return true;
  if (foldPathValue(normalizedFirst) !== foldPathValue(normalizedSecond)) return false;

  try {
    const [firstStat, secondStat, resolvedFirst, resolvedSecond] = await Promise.all([
      lstat(normalizedFirst),
      lstat(normalizedSecond),
      resolveExistingPathSpelling(normalizedFirst, basePath),
      resolveExistingPathSpelling(normalizedSecond, basePath),
    ]);

    return firstStat.dev === secondStat.dev && firstStat.ino === secondStat.ino && resolvedFirst !== null && resolvedFirst === resolvedSecond;
  } catch {
    return false;
  }
}
