import { getBookMediaKind } from '@bookorbit/types';

import { naturalCompare } from '../../../common/utils/natural-sort.utils';
import { classifyFile, type FileRole } from './classify';
import { isDiscDirectory, stemOf } from './walk';

/**
 * What a downloaded release actually is, decided once and read at two call sites: the `.torrent`
 * manifest before the grab, and the finished directory after it. Keeping one rule set means the
 * picker can say "this becomes one audiobook of 31 tracks" rather than "multiple supported files",
 * and it means a release cannot be accepted at grab time and then refused at import.
 *
 * Pure by construction: no filesystem, no database, no request. Selection against a request is a
 * separate question answered over the plan this returns.
 *
 * This deliberately does not share the scanner's *splitting* rule. `book_per_folder` scanning is
 * "one folder = one book", so 41 different-titled epubs in a directory scan as one book. Here they
 * are 41 units, because a release directory is a delivery boundary and a library folder is a
 * placement boundary, and turning one into the other is the whole job. What is shared are the
 * primitives: classification, media class, natural order and disc folding.
 */

export type ReleaseMediaKind = 'ebook' | 'audiobook' | 'comic';

export type ReleaseIgnoredReason = 'sample' | 'padding' | 'unsupported' | 'junk_dir';

export type ReleaseContainerKind = 'zip' | 'rar' | '7z';

export interface ReleaseFileInput {
  /** Relative to the release root, `/` separated. Callers strip any common root segment first. */
  path: string;
  sizeBytes: number | null;
}

export interface ReleasePlanFile {
  path: string;
  sizeBytes: number | null;
  format: string | null;
  role: FileRole;
  /** Content files only, natural order within the unit. */
  sortOrder: number | null;
}

export interface ReleaseUnit {
  mediaKind: ReleaseMediaKind;
  /** Best guess for a chooser to show, from the directory name or the file stem. */
  title: string | null;
  files: ReleasePlanFile[];
  /** What metadata and cover extraction should read. */
  primaryPath: string;
  contentFileCount: number;
  sizeBytes: number | null;
  /**
   * The directory every file of this unit hangs off, relative to the release root and `''` at the
   * root itself. Disc folding means a file can sit below it, so this is what tells a placement the
   * difference between `CD 1/track01.mp3` and `CD 2/track01.mp3` - two files with one name.
   */
  directory: string;
}

export interface ReleasePlan {
  units: ReleaseUnit[];
  ignored: Array<{ path: string; reason: ReleaseIgnoredReason }>;
  containers: Array<{ path: string; kind: ReleaseContainerKind }>;
  /**
   * Part of the release was never interpreted: the input ran past `MAX_RELEASE_FILES`, or the
   * caller that produced it hit a bound of its own and said so. A truncated plan is a plan that
   * may be missing half of a multipart book, so importing from it is importing part of a book.
   */
  truncated: boolean;
}

/** A release is books plus artwork, not a filesystem. Matches the .torrent manifest's own cap. */
export const MAX_RELEASE_FILES = 2_000;

const JUNK_DIRECTORIES = new Set(['sample', 'samples', 'screens', 'screenshots', 'proof', 'proofs', '_unpack_', '.pad']);

/**
 * BitTorrent v1 padding. Matched by name rather than by the `attr: p` flag because the manifest
 * parser reads only `path` and `length`, and the post-download call site has no flags at all: a
 * name rule is the one rule that works at both call sites.
 */
const PADDING_FILE_PATTERN = /^_{4,}padding_file|^\.____padding_file|^\.pad$/i;

/** Whole stem or a trailing token only, so `preview.pdf` is a sample and `Preview of Death` is not. */
const SAMPLE_FILE_PATTERN = /^(?:sample|preview|excerpt)$|[\s._-](?:sample|preview|excerpt)$/i;

const CONTAINER_KINDS: Array<{ kind: ReleaseContainerKind; test: (ext: string) => boolean }> = [
  { kind: 'zip', test: (ext) => ext === 'zip' },
  // Multipart RAR volumes: `.rar` plus `.r00`, `.r01`, and the newer `.part1.rar` spelling.
  { kind: 'rar', test: (ext) => ext === 'rar' || /^r\d{2,3}$/.test(ext) },
  { kind: '7z', test: (ext) => ext === '7z' || /^\d{3}$/.test(ext) },
];

/**
 * Comics are content and must never be treated as archives even though a `.cbz` is a zip and a
 * `.cbr` is a rar. Checked before the container test, so ordering here is load-bearing.
 */
function containerKind(format: string | null, role: FileRole): ReleaseContainerKind | null {
  if (!format || role === 'content') return null;
  for (const { kind, test } of CONTAINER_KINDS) {
    if (test(format)) return kind;
  }
  return null;
}

/** Strips the noise release groups add to a stem so `Book (retail)` and `Book [v2]` are one book. */
export function normalizeReleaseStem(stem: string): string {
  return stem
    .replace(/\.(retail|fixed|repack|proper|v\d+)$/i, '')
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/[\s._-]+(retail|fixed|repack|proper|unabridged|abridged|v\d+)$/i, '')
    .replace(/[\s._-]+/g, ' ')
    .trim()
    .toLowerCase();
}

interface WorkingFile {
  input: ReleaseFileInput;
  segments: string[];
  name: string;
  dir: string;
  format: string | null;
  role: FileRole;
}

export interface InterpretReleaseOptions {
  /**
   * What the release itself is called: the torrent's `name`, or the downloaded directory's own
   * name. Paths arrive relative to the release root, so a unit sitting at that root has no
   * directory name of its own to be titled after, and "track 01" is a poor answer where
   * "Neuromancer" was available.
   */
  rootName?: string | null;
  /**
   * The caller already gave up on part of the release: a directory walk that hit its own depth or
   * entry ceiling, for instance. Without this a truncated listing is indistinguishable from a
   * complete one, because the interpreter only ever sees what it was handed.
   */
  truncated?: boolean;
}

export function interpretRelease(files: ReleaseFileInput[], options: InterpretReleaseOptions = {}): ReleasePlan {
  const overLength = files.length > MAX_RELEASE_FILES;
  const truncated = overLength || options.truncated === true;
  const considered = overLength ? files.slice(0, MAX_RELEASE_FILES) : files;

  const ignored: ReleasePlan['ignored'] = [];
  const containers: ReleasePlan['containers'] = [];
  const kept: WorkingFile[] = [];
  const stemsByDirectory = indexStemsByDirectory(considered);

  for (const input of considered) {
    const segments = input.path.split('/').filter((segment) => segment.length > 0 && segment !== '.');
    if (segments.length === 0) continue;

    const name = segments[segments.length - 1]!;
    const directorySegments = segments.slice(0, -1);

    const junkSegment = directorySegments.find((segment) => JUNK_DIRECTORIES.has(segment.toLowerCase()));
    if (junkSegment !== undefined) {
      ignored.push({ path: input.path, reason: junkSegment.toLowerCase() === '.pad' ? 'padding' : 'junk_dir' });
      continue;
    }

    if (PADDING_FILE_PATTERN.test(name)) {
      ignored.push({ path: input.path, reason: 'padding' });
      continue;
    }

    const { format, role } = classifyFile(name);

    const container = containerKind(format, role);
    if (container) {
      containers.push({ path: input.path, kind: container });
      continue;
    }

    if (name.startsWith('.')) {
      ignored.push({ path: input.path, reason: 'unsupported' });
      continue;
    }

    if (role === 'content' && SAMPLE_FILE_PATTERN.test(stemOf(name))) {
      ignored.push({ path: input.path, reason: 'sample' });
      continue;
    }

    kept.push({ input, segments, name, dir: effectiveDirectory(directorySegments, stemsByDirectory), format, role });
  }

  const units: ReleaseUnit[] = [];
  for (const [dir, group] of groupByDirectory(kept)) {
    units.push(...unitsForDirectory(dir, group, ignored, options.rootName ?? null));
  }

  return { units, ignored, containers, truncated };
}

/**
 * Disc subdirectories belong to the book above them, exactly as the scanner folds them, so a
 * `CD 1` / `CD 2` audiobook is one unit rather than two. Stem-named subdirectories fold the same
 * way, which is how `Book.epub` keeps its `Book/cover.jpg`.
 */
function effectiveDirectory(directorySegments: string[], stemsByDirectory: Map<string, Set<string>>): string {
  const segments = [...directorySegments];

  while (segments.length > 0) {
    const last = segments[segments.length - 1]!;
    if (isDiscDirectory(last)) {
      segments.pop();
      continue;
    }
    if (stemsByDirectory.get(segments.slice(0, -1).join('/'))?.has(last)) {
      segments.pop();
      continue;
    }
    break;
  }

  return segments.join('/');
}

/**
 * One pass up front rather than a scan of every file per file. A 2000-entry series pack is a
 * perfectly ordinary release, and the quadratic version of this cost half a second on its own.
 */
function indexStemsByDirectory(all: ReleaseFileInput[]): Map<string, Set<string>> {
  const byDirectory = new Map<string, Set<string>>();
  for (const file of all) {
    const segments = file.path.split('/').filter(Boolean);
    if (segments.length === 0) continue;
    const dir = segments.slice(0, -1).join('/');
    const stems = byDirectory.get(dir);
    if (stems) stems.add(stemOf(segments[segments.length - 1]!));
    else byDirectory.set(dir, new Set([stemOf(segments[segments.length - 1]!)]));
  }
  return byDirectory;
}

function groupByDirectory(files: WorkingFile[]): Map<string, WorkingFile[]> {
  const byDir = new Map<string, WorkingFile[]>();
  for (const file of files) {
    const existing = byDir.get(file.dir);
    if (existing) existing.push(file);
    else byDir.set(file.dir, [file]);
  }
  return byDir;
}

function unitsForDirectory(dir: string, group: WorkingFile[], ignored: ReleasePlan['ignored'], rootName: string | null): ReleaseUnit[] {
  const content = group.filter((file) => file.role === 'content');
  const sidecars = group.filter((file) => file.role !== 'content');

  if (content.length === 0) {
    for (const sidecar of sidecars) ignored.push({ path: sidecar.input.path, reason: 'unsupported' });
    return [];
  }

  const buckets = new Map<string, WorkingFile[]>();
  for (const file of content) {
    const kind = getBookMediaKind(file.format);
    // An m4b edition and an mp3 edition of the same title are two editions of one book, and which
    // one to keep is a choice, not a merge. Splitting by format defers it to the chooser; for the
    // ordinary all-one-format audiobook it is a no-op.
    const key = kind === 'audiobook' ? `audiobook:${file.format ?? ''}` : kind === 'comic' ? `comic:${file.input.path}` : `ebook:${unitStem(file)}`;
    const existing = buckets.get(key);
    if (existing) existing.push(file);
    else buckets.set(key, [file]);
  }

  const dirName = dir ? (dir.split('/').pop() ?? null) : rootName;
  const singleUnit = buckets.size === 1;

  const units: ReleaseUnit[] = [];
  for (const bucketFiles of buckets.values()) {
    // On the whole path, not the file name: a disc-foldered unit holds several `track01.mp3`, and
    // ordering by name interleaves the discs into track01, track01, track02, track02.
    const ordered = [...bucketFiles].sort((a, b) => naturalCompare(a.input.path, b.input.path));
    const mediaKind = getBookMediaKind(ordered[0]!.format) as ReleaseMediaKind;
    const attached = sidecars.filter((sidecar) => matchesUnit(sidecar, ordered, singleUnit));

    const planFiles: ReleasePlanFile[] = [
      ...ordered.map((file, index) => toPlanFile(file, index)),
      ...attached.map((file) => toPlanFile(file, null)),
    ];

    units.push({
      mediaKind,
      title: unitTitle(ordered, dirName, singleUnit),
      files: planFiles,
      primaryPath: primaryPathOf(ordered),
      contentFileCount: ordered.length,
      sizeBytes: sumSizes(planFiles),
      directory: dir,
    });
  }

  for (const sidecar of sidecars) {
    if (!units.some((unit) => unit.files.some((file) => file.path === sidecar.input.path))) {
      ignored.push({ path: sidecar.input.path, reason: 'unsupported' });
    }
  }

  return units;
}

/**
 * A directory with one unit owns all its artwork and sidecars. A directory with several - a comic
 * run, a series pack - can only claim what its stem matches, because a lone `cover.jpg` beside 60
 * issues belongs to no one issue in particular.
 */
function matchesUnit(sidecar: WorkingFile, unitFiles: WorkingFile[], singleUnit: boolean): boolean {
  if (singleUnit) return true;
  const stem = normalizeReleaseStem(stemOf(sidecar.name));
  return unitFiles.some((file) => normalizeReleaseStem(stemOf(file.name)) === stem);
}

function toPlanFile(file: WorkingFile, sortOrder: number | null): ReleasePlanFile {
  return { path: file.input.path, sizeBytes: file.input.sizeBytes, format: file.format, role: file.role, sortOrder };
}

function unitStem(file: WorkingFile): string {
  return normalizeReleaseStem(stemOf(file.name));
}

/**
 * The directory name is the better guess whenever it names the whole unit, which is the usual
 * release shape. Inside a pack, where one directory holds several books, only the stem can tell
 * them apart.
 */
function unitTitle(ordered: WorkingFile[], dirName: string | null, singleUnit: boolean): string | null {
  if (singleUnit && dirName) return dirName;
  const stem = stemOf(ordered[0]!.name)
    .replace(/[\s._-]+/g, ' ')
    .trim();
  return stem || dirName;
}

/** Highest-priority format first, then natural order, so an m4b wins over track one of a set. */
function primaryPathOf(ordered: WorkingFile[]): string {
  const best = [...ordered].sort((a, b) => formatRank(a.format) - formatRank(b.format) || naturalCompare(a.input.path, b.input.path))[0]!;
  return best.input.path;
}

/**
 * Where a file sits *inside* its unit, `/` separated. This is what a placement has to preserve:
 * flattening it to the file name makes the second disc overwrite the first.
 */
export function unitRelativePath(unit: ReleaseUnit, path: string): string {
  if (!unit.directory) return path;
  const prefix = `${unit.directory}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function formatRank(format: string | null): number {
  if (!format) return Number.MAX_SAFE_INTEGER;
  const index = FORMAT_RANK.indexOf(format.toLowerCase());
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

const FORMAT_RANK: string[] = ['epub', 'kepub', 'azw3', 'azw', 'mobi', 'fb2', 'pdf', 'cbz', 'cbr', 'cb7', 'm4b', 'm4a', 'flac', 'opus', 'ogg', 'mp3'];

function sumSizes(files: ReleasePlanFile[]): number | null {
  let total = 0;
  let seen = false;
  for (const file of files) {
    if (file.sizeBytes === null) continue;
    total += file.sizeBytes;
    seen = true;
  }
  return seen ? total : null;
}

/**
 * Which unit of a plan to import. The second half of the interpreter's job, kept separate from
 * `interpretRelease` because only this half needs to know what was requested: the picker asks what
 * a release *is* without a request in hand, and the chooser needs the whole plan rather than one
 * already narrowed down.
 */
export type ReleaseSelection =
  { kind: 'unit'; unit: ReleaseUnit; ignored: ReleaseUnit[] } | { kind: 'ambiguous'; units: ReleaseUnit[] } | { kind: 'none' };

export interface ReleaseSelectionContext {
  /** What the request asked for. Narrows a mixed release without asking anyone. */
  mediaKind?: ReleaseMediaKind | null;
  /** A unit already chosen by a human, identified by the path a re-read of the release repeats. */
  primaryPath?: string | null;
}

export function selectReleaseUnit(plan: ReleasePlan, context: ReleaseSelectionContext = {}): ReleaseSelection {
  if (plan.units.length === 0) return { kind: 'none' };

  // A choice already made wins over everything, including a media kind that disagrees with it: the
  // person who made it was looking at the same list.
  if (context.primaryPath) {
    const chosen = plan.units.find((unit) => unit.primaryPath === context.primaryPath);
    if (!chosen) return { kind: 'none' };
    return { kind: 'unit', unit: chosen, ignored: plan.units.filter((unit) => unit !== chosen) };
  }

  if (plan.units.length === 1) return { kind: 'unit', unit: plan.units[0]!, ignored: [] };

  const matching = context.mediaKind ? plan.units.filter((unit) => unit.mediaKind === context.mediaKind) : [];
  if (matching.length === 1) {
    return { kind: 'unit', unit: matching[0]!, ignored: plan.units.filter((unit) => unit !== matching[0]) };
  }

  return { kind: 'ambiguous', units: plan.units };
}
