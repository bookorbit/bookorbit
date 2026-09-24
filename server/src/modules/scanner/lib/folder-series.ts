import { basename, dirname, extname } from 'path';

import { SERIES_INDEX_MAX_LENGTH, SERIES_INDEX_PATTERN } from '@bookorbit/types';

import { naturalCompare } from '../../../common/utils/natural-sort.utils';

// Series from folders (Komga/Kavita layout): the directory is the series and the number in each
// filename is the book's position in it.

export interface ParsedComicFilename {
  volume: string | null;
  chapter: string | null;
}

export type FolderIndexMode = 'chapter' | 'volume' | 'position';

export interface DerivedSeries {
  name: string;
  index: string | null;
}

const NUMBER = String.raw`(\d{1,6}(?:\.\d{1,4})?)`;
// Markers must stand alone: "Vinland" is not v + number, "c2c" is not a chapter.
const LEFT = String.raw`(?<![\p{L}\p{N}])`;
const RIGHT = String.raw`(?![\p{L}\d])`;

const CHAPTER_PATTERNS: readonly RegExp[] = [
  // "Vol C06" is a collection code, not a chapter.
  new RegExp(String.raw`${LEFT}(?<!vol\.?\s*)(?:chapter|chap|ch|c)\.?\s*${NUMBER}${RIGHT}`, 'iu'),
  new RegExp(String.raw`第?\s*${NUMBER}\s*(?:화|회|話|话|章)`, 'u'),
];

const VOLUME_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`${LEFT}(?:volume|vol|v)\.?\s*${NUMBER}${RIGHT}`, 'iu'),
  new RegExp(String.raw`${LEFT}(?:tome|tomo|t)\.?\s*${NUMBER}${RIGHT}`, 'iu'),
  new RegExp(String.raw`#\s*${NUMBER}${RIGHT}`, 'u'),
  new RegExp(String.raw`第?\s*${NUMBER}\s*(?:巻|卷|권)`, 'u'),
];

const MARKER_PATTERNS = [...CHAPTER_PATTERNS, ...VOLUME_PATTERNS];

// "01 - Series - Title", "01. Title", "01_Title"
const LEADING_NUMBER = /^(\d{1,4}(?:\.\d{1,3})?)\s*(?:[-–_]|\.(?=\s))/u;
// "03", "- 03", or the start of a range "01-03"
const TRAILING_NUMBER = /(?<![\p{L}\d.])(\d{1,4}(?:\.\d{1,4})?)(?:\s*-\s*\d{1,4})?\s*$/u;
const YEAR = /^(?:19|20)\d{2}$/;
// "One Piece/Vol 01/c001.cbz": the series is the directory above the volume directory.
const VOLUME_DIRECTORY = /^\s*(?:volume|vol|v|tome|tomo|t)\.?\s*\d{1,6}\s*$/iu;

function normalizeIndex(raw: string): string | null {
  const [whole, fraction] = raw.split('.');
  const trimmedWhole = whole.replace(/^0+(?=\d)/, '');
  const value = fraction === undefined ? trimmedWhole : `${trimmedWhole}.${fraction}`;
  return value.length <= SERIES_INDEX_MAX_LENGTH && SERIES_INDEX_PATTERN.test(value) ? value : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSpacing(value: string): string {
  return value.normalize('NFKC').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

function leadingNumber(stem: string): string | null {
  const match = stem.normalize('NFKC').trim().match(LEADING_NUMBER);
  if (!match || YEAR.test(match[1])) return null;
  return normalizeIndex(match[1]);
}

function stripNoise(stem: string, seriesName: string | null): string {
  let text = normalizeSpacing(stem);
  // Removing the series name keeps "Area 51" or "Spider-Man 2099" from being read as a book number.
  // It runs before brackets are stripped so a name like "Chateau dans le ciel (Le)" still matches.
  if (seriesName) {
    const series = normalizeSpacing(seriesName);
    if (series) text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(series)}(?![\\p{L}\\p{N}])`, 'iu'), ' ');
  }
  text = text.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ');
  // Keep "(v01)", drop "(2016)", "(Digital)", "(of 37)".
  text = text.replace(/\(([^)]*)\)/g, (_group, inner: string) => (MARKER_PATTERNS.some((pattern) => pattern.test(inner)) ? ` ${inner} ` : ' '));
  text = text.replace(/(?<![\p{L}\p{N}])\d{3,4}p(?![\p{L}\p{N}])/giu, ' ');
  text = text.replace(/(?<![\p{L}\p{N}])\d{3,5}x\d{3,5}(?![\p{L}\p{N}])/giu, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function firstMatch(text: string, patterns: readonly RegExp[], options: { rejectYears?: boolean } = {}): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    // "c2004" on a French comic scan is a copyright year.
    if (options.rejectYears && YEAR.test(match[1])) continue;
    return normalizeIndex(match[1]);
  }
  return null;
}

export function parseComicFilename(stem: string, seriesName: string | null = null): ParsedComicFilename {
  // A leading index wins: later markers belong to the title ("01 - Series - Cycle C1").
  const leading = leadingNumber(stem);
  if (leading !== null) return { volume: leading, chapter: null };

  const text = stripNoise(stem, seriesName);
  const chapter = firstMatch(text, CHAPTER_PATTERNS, { rejectYears: true });
  let volume = firstMatch(text, VOLUME_PATTERNS);

  if (volume === null && chapter === null) {
    const match = text.match(TRAILING_NUMBER);
    if (match && !YEAR.test(match[1])) volume = normalizeIndex(match[1]);
  }

  return { volume, chapter };
}

/**
 * One numbering per folder: a single chapter marker makes the whole folder chapter-indexed. Files
 * without a number get no index rather than a sort position that could collide with a real "T03";
 * sort positions are used only when nothing in the folder is numbered.
 */
export function indexSeriesFolder(
  stems: readonly string[],
  seriesName: string | null,
): { mode: FolderIndexMode; indices: Map<string, string | null> } {
  const parsed = stems.map((stem) => ({ stem, ...parseComicFilename(stem, seriesName) }));

  if (parsed.some((entry) => entry.chapter !== null)) {
    return { mode: 'chapter', indices: new Map(parsed.map((entry) => [entry.stem, entry.chapter])) };
  }
  if (parsed.some((entry) => entry.volume !== null)) {
    return { mode: 'volume', indices: new Map(parsed.map((entry) => [entry.stem, entry.volume])) };
  }

  const sorted = [...stems].sort(naturalCompare);
  return { mode: 'position', indices: new Map(sorted.map((stem, position) => [stem, String(position + 1)])) };
}

export function seriesNameFromDirectory(directoryName: string): string | null {
  const name = normalizeSpacing(directoryName)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\s*\((?:19|20)\d{2}\)\s*$/u, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name || null;
}

export function seriesDirectoryFor(directory: string, libraryRoot: string): string | null {
  if (directory === libraryRoot) return null;
  if (VOLUME_DIRECTORY.test(basename(directory))) {
    const parent = dirname(directory);
    if (parent !== libraryRoot && parent !== directory) return parent;
  }
  return directory;
}

export function deriveFolderSeries(directory: string, contentPaths: readonly string[], libraryRoot: string): Map<string, DerivedSeries> {
  const result = new Map<string, DerivedSeries>();
  const seriesDirectory = seriesDirectoryFor(directory, libraryRoot);
  if (!seriesDirectory || contentPaths.length === 0) return result;

  const name = seriesNameFromDirectory(basename(seriesDirectory));
  if (!name) return result;

  const stems = contentPaths.map((path) => basename(path, extname(path)));
  const { indices } = indexSeriesFolder(stems, name);
  contentPaths.forEach((path, i) => result.set(path, { name, index: indices.get(stems[i]) ?? null }));
  return result;
}
