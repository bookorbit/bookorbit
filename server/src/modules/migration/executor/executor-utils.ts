import * as schema from '../../../db/schema';
import { applyPathMappings } from '../planner/matching.service';
import type { PlannerResult } from '../planner/planner.types';

export interface StageCounters {
  processed: number;
  imported: number;
  skipped: number;
  unresolved: number;
  failed: number;
}

export type RunStateCheck = (force?: boolean) => Promise<void>;

export class RunInterruptedError extends Error {
  constructor(
    readonly runId: number,
    readonly state: string,
  ) {
    super(`Migration run ${runId} is no longer running (state=${state})`);
  }
}

export function emptyCounters(): StageCounters {
  return { processed: 0, imported: 0, skipped: 0, unresolved: 0, failed: 0 };
}

export function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)))];
}

export function buildSourceFileTargetMap(
  planned: PlannerResult,
  targetFilesByBookId: Map<number, Array<{ id: number; hash: string | null; absolutePath: string }>>,
): Map<string, number> {
  const sourceBooksById = new Map(planned.execution.sourceData.books.map((book) => [book.sourceBookId, book]));
  const out = new Map<string, number>();

  for (const match of planned.execution.matchedBooks) {
    const sourceBook = sourceBooksById.get(match.sourceBookId);
    const sourceFiles = sourceBook?.files ?? [];
    const targetFiles = targetFilesByBookId.get(match.targetBookId) ?? [];
    if (sourceFiles.length === 0 || targetFiles.length === 0) continue;

    for (const sourceFile of sourceFiles) {
      if (out.has(sourceFile.sourceFileId)) continue;

      if (sourceFile.fileHash) {
        const byHash = targetFiles.filter((tf) => tf.hash === sourceFile.fileHash);
        if (byHash.length === 1) {
          out.set(sourceFile.sourceFileId, byHash[0].id);
          continue;
        }
      }

      const mappedPath = applyPathMappings(sourceFile.filePath, planned.plan.pathMappings);
      if (mappedPath) {
        const byPath = targetFiles.filter((tf) => tf.absolutePath === mappedPath);
        if (byPath.length === 1) {
          out.set(sourceFile.sourceFileId, byPath[0].id);
        }
      }
    }
  }

  return out;
}

export function buildMetadataPatch(sourceBook: {
  title: string | null;
  subtitle: string | null;
  isbn10: string | null;
  isbn13: string | null;
  description: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount?: number | null;
  seriesName?: string | null;
  seriesIndex?: number | null;
  rating?: number | null;
  googleBooksId?: string | null;
  goodreadsId?: string | null;
  amazonId?: string | null;
  hardcoverId?: string | null;
  audibleId?: string | null;
  comicvineId?: string | null;
  durationSeconds?: number | null;
  abridged?: boolean | null;
  presentFields?: string[];
}): Partial<typeof schema.bookMetadata.$inferInsert> {
  const field = <T>(name: string, value: T | undefined): T | undefined =>
    !sourceBook.presentFields || sourceBook.presentFields.includes(name) ? value : undefined;

  return pruneUndefined({
    title: field('title', truncateNullableText(sourceBook.title, 1000)),
    subtitle: field('subtitle', truncateNullableText(sourceBook.subtitle, 1000)),
    isbn10: field('isbn10', truncateNullableText(sourceBook.isbn10, 10)),
    isbn13: field('isbn13', truncateNullableText(sourceBook.isbn13, 13)),
    description: field('description', sourceBook.description),
    publisher: field('publisher', truncateNullableText(sourceBook.publisher, 500)),
    publishedYear: field('publishedYear', sanitizeBoundedInteger(sourceBook.publishedYear, 1000, 2200)),
    language: field('language', truncateNullableText(sourceBook.language, 100)),
    pageCount: field('pageCount', sanitizeNonNegativeInteger(sourceBook.pageCount)),
    seriesName: field('seriesName', truncateNullableText(sourceBook.seriesName, 500)),
    seriesIndex: field('seriesIndex', sourceBook.seriesIndex),
    rating: field('rating', sanitizeBoundedInteger(sourceBook.rating, 1, 10)),
    googleBooksId: field('googleBooksId', truncateNullableText(sourceBook.googleBooksId, 50)),
    goodreadsId: field('goodreadsId', truncateNullableText(sourceBook.goodreadsId, 50)),
    amazonId: field('amazonId', truncateNullableText(sourceBook.amazonId, 20)),
    hardcoverId: field('hardcoverId', truncateNullableText(sourceBook.hardcoverId, 50)),
    audibleId: field('audibleId', truncateNullableText(sourceBook.audibleId, 20)),
    comicvineId: field('comicvineId', truncateNullableText(sourceBook.comicvineId, 50)),
    durationSeconds: field('durationSeconds', sanitizeNonNegativeInteger(sourceBook.durationSeconds)),
    abridged: field('abridged', sourceBook.abridged === undefined ? undefined : (sourceBook.abridged ?? false)),
  });
}

function sanitizeBoundedInteger(value: number | null | undefined, min: number, max: number): number | null | undefined {
  if (value === undefined) return undefined;
  if (value == null) return null;
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return Math.round(value);
}

function sanitizeNonNegativeInteger(value: number | null | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

export function buildContributorValues(contributor: {
  name: string;
  sortName?: string | null;
  description?: string | null;
}): typeof schema.authors.$inferInsert {
  return pruneUndefined({
    name: truncateText(contributor.name, 500),
    sortName: truncateText(contributor.sortName ?? contributor.name, 500),
    description: contributor.description ?? undefined,
  });
}

export function getSourceContributors(
  contributors: Array<{ name: string; sortName?: string | null; description?: string | null; displayOrder?: number | null }> | undefined,
  legacyValue: string | null,
): Array<{ name: string; sortName: string | null; description: string | null }> {
  const structured =
    contributors
      ?.filter((c) => c.name.trim().length > 0)
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map((c) => ({ name: c.name.trim(), sortName: c.sortName ?? null, description: c.description ?? null })) ?? [];
  if (structured.length > 0) return dedupeContributors(structured);
  return parseAuthorNames(legacyValue).map((name) => ({ name, sortName: name, description: null }));
}

function dedupeContributors<T extends { name: string }>(contributors: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of contributors) {
    const key = c.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function parseAuthorNames(value: string | null): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  const parsed = parseJsonStringArray(trimmed);
  const rawNames = parsed ?? trimmed.split(/\s*(?:;|\||\s+&\s+|\s+and\s+)\s*/i);

  const seen = new Set<string>();
  const names: string[] = [];
  for (const rawName of rawNames) {
    const name = rawName.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function parseJsonStringArray(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const strings = parsed.filter((item): item is string => typeof item === 'string');
    return strings.length > 0 ? strings : null;
  } catch {
    return null;
  }
}

export function pruneUndefined<T extends Record<string, unknown>>(input: T): T {
  const out = {} as T;
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === code);
}

export function toDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function clampPercent(value: number | null): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function clampNonNegative(value: number | null): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

export function truncateNullableText(value: string | null | undefined, maxLength: number): string | null | undefined {
  if (value == null) return value;
  return truncateText(value, maxLength);
}

export function normalizeReadStatus(
  rawStatus: string | null,
  percentage: number | null,
): 'unread' | 'reading' | 'read' | 'abandoned' | 'on_hold' | 'want_to_read' | 'rereading' | 'skimmed' {
  const normalized = rawStatus?.trim().toLowerCase();

  if (normalized === 'read' || normalized === 'completed') return 'read';
  if (normalized === 'reading' || normalized === 'in_progress') return 'reading';
  if (normalized === 'on_hold' || normalized === 'paused') return 'on_hold';
  if (normalized === 'abandoned' || normalized === 'dropped') return 'abandoned';
  if (normalized === 'want_to_read' || normalized === 'wishlist') return 'want_to_read';
  if (normalized === 'rereading') return 'rereading';
  if (normalized === 'skimmed') return 'skimmed';

  if (percentage != null) {
    if (percentage >= 98) return 'read';
    if (percentage > 0) return 'reading';
  }

  return 'unread';
}
