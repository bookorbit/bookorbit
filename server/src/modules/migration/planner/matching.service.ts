import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import type { SourceBook } from '../adapters/source-adapter.types';
import type { PathMapping, PlannedBookMatch, PlannedUnresolvedBook, UnresolvedReasonCode } from './planner.types';

type Db = NodePgDatabase<typeof schema>;
type MatchAttempt = 'isbn' | 'file_hash' | 'file_path' | 'title_author';

type LookupResult = { kind: 'found'; bookId: number } | { kind: 'ambiguous' } | { kind: 'none' };

function found(bookId: number): LookupResult {
  return { kind: 'found', bookId };
}
const AMBIGUOUS: LookupResult = { kind: 'ambiguous' };
const NONE: LookupResult = { kind: 'none' };

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async matchBooks(
    sourceBooks: SourceBook[],
    pathMappings: PathMapping[],
  ): Promise<{ matches: PlannedBookMatch[]; unresolved: PlannedUnresolvedBook[] }> {
    const startMs = Date.now();
    this.logger.log(`[book.matching] [start] sourceBooks=${sourceBooks.length} pathMappings=${pathMappings.length} - matching started`);

    const matches: PlannedBookMatch[] = [];
    const unresolved: PlannedUnresolvedBook[] = [];

    const isbnIndex = await this.batchLookupIsbns(sourceBooks);
    const hashIndex = await this.batchLookupFileHashes(sourceBooks);

    const filePathCache = new Map<string, LookupResult>();
    const titleAuthorCache = new Map<string, LookupResult>();

    sourceBooksLoop: for (const sourceBook of sourceBooks) {
      const attempts: MatchAttempt[] = [];
      let ambiguousStrategy: MatchAttempt | null = null;

      const isbn = normalizeIsbn(sourceBook.isbn13) ?? normalizeIsbn(sourceBook.isbn10);
      if (isbn) {
        attempts.push('isbn');
        const result = isbnIndex.get(isbn) ?? NONE;
        if (result.kind === 'found') {
          matches.push({ sourceBookId: sourceBook.sourceBookId, targetBookId: result.bookId, strategy: 'isbn' });
          continue;
        }
        if (result.kind === 'ambiguous') ambiguousStrategy = 'isbn';
      }

      const sourceHashes = sourceFileHashes(sourceBook);
      if (sourceHashes.length > 0) {
        attempts.push('file_hash');
        for (const sourceHash of sourceHashes) {
          const result = hashIndex.get(sourceHash) ?? NONE;
          if (result.kind === 'found') {
            matches.push({ sourceBookId: sourceBook.sourceBookId, targetBookId: result.bookId, strategy: 'file_hash' });
            continue sourceBooksLoop;
          }
          if (result.kind === 'ambiguous') ambiguousStrategy ??= 'file_hash';
        }
      }

      const mappedPaths = sourceFilePaths(sourceBook)
        .map((path) => applyPathMappings(path, pathMappings))
        .filter((path): path is string => !!path);
      if (mappedPaths.length > 0) {
        attempts.push('file_path');
        for (const mappedPath of [...new Set(mappedPaths)]) {
          let result = filePathCache.get(mappedPath);
          if (!result) {
            result = await this.lookupByFilePath(mappedPath);
            filePathCache.set(mappedPath, result);
          }
          if (result.kind === 'found') {
            matches.push({ sourceBookId: sourceBook.sourceBookId, targetBookId: result.bookId, strategy: 'path_mapping' });
            continue sourceBooksLoop;
          }
          if (result.kind === 'ambiguous') ambiguousStrategy ??= 'file_path';
        }
      }

      const titleKey = normalizeTitle(sourceBook.title);
      if (titleKey) {
        attempts.push('title_author');
        const authorNames = getSourceAuthorNames(sourceBook);
        const cacheKey = buildTitleAuthorCacheKey(sourceBook.title, authorNames);
        let result = titleAuthorCache.get(cacheKey);
        if (!result) {
          result = await this.lookupByTitleAuthor(sourceBook.title ?? '', authorNames);
          titleAuthorCache.set(cacheKey, result);
        }
        if (result.kind === 'found') {
          matches.push({ sourceBookId: sourceBook.sourceBookId, targetBookId: result.bookId, strategy: 'title_author' });
          continue;
        }
        if (result.kind === 'ambiguous') ambiguousStrategy ??= 'title_author';
      }

      unresolved.push({
        sourceBookId: sourceBook.sourceBookId,
        title: sourceBook.title,
        reason: ambiguousStrategy ? deriveAmbiguousReason(ambiguousStrategy) : deriveUnresolvedReason(attempts),
      });
      this.logger.debug(
        `[book.matching] sourceBookId=${sourceBook.sourceBookId} reason=${ambiguousStrategy ? deriveAmbiguousReason(ambiguousStrategy) : deriveUnresolvedReason(attempts)} attempts=${attempts.join(',')} - unresolved`,
      );
    }

    const durationMs = Date.now() - startMs;
    this.logger.log(`[book.matching] [end] matched=${matches.length} unresolved=${unresolved.length} durationMs=${durationMs} - matching completed`);
    return { matches, unresolved };
  }

  private async batchLookupIsbns(sourceBooks: SourceBook[]): Promise<Map<string, LookupResult>> {
    const isbn13s = new Set<string>();
    const isbn10s = new Set<string>();
    for (const book of sourceBooks) {
      const isbn13 = normalizeIsbn(book.isbn13);
      const isbn10 = normalizeIsbn(book.isbn10);
      if (isbn13) isbn13s.add(isbn13);
      if (isbn10) isbn10s.add(isbn10);
    }

    const results = new Map<string, LookupResult>();
    if (isbn13s.size === 0 && isbn10s.size === 0) return results;

    const chunkSize = 500;
    const bookIdsByIsbn = new Map<string, number[]>();

    const allIsbns13 = [...isbn13s];
    for (let i = 0; i < allIsbns13.length; i += chunkSize) {
      const chunk = allIsbns13.slice(i, i + chunkSize);
      const normalizedTargetIsbn13 = normalizedIsbnSql(schema.bookMetadata.isbn13);
      const rows = await this.db
        .select({ bookId: schema.bookMetadata.bookId, isbn13: normalizedTargetIsbn13 })
        .from(schema.bookMetadata)
        .where(inArray(normalizedTargetIsbn13, chunk));
      for (const row of rows) {
        const isbn = normalizeIsbn(row.isbn13);
        if (!isbn) continue;
        const existing = bookIdsByIsbn.get(isbn) ?? [];
        existing.push(row.bookId);
        bookIdsByIsbn.set(isbn, existing);
      }
    }

    const allIsbns10 = [...isbn10s];
    for (let i = 0; i < allIsbns10.length; i += chunkSize) {
      const chunk = allIsbns10.slice(i, i + chunkSize);
      const normalizedTargetIsbn10 = normalizedIsbnSql(schema.bookMetadata.isbn10);
      const rows = await this.db
        .select({ bookId: schema.bookMetadata.bookId, isbn10: normalizedTargetIsbn10 })
        .from(schema.bookMetadata)
        .where(inArray(normalizedTargetIsbn10, chunk));
      for (const row of rows) {
        const isbn = normalizeIsbn(row.isbn10);
        if (!isbn) continue;
        const existing = bookIdsByIsbn.get(isbn) ?? [];
        existing.push(row.bookId);
        bookIdsByIsbn.set(isbn, existing);
      }
    }

    for (const book of sourceBooks) {
      const isbn = normalizeIsbn(book.isbn13) ?? normalizeIsbn(book.isbn10);
      if (!isbn) continue;

      const isbn13 = normalizeIsbn(book.isbn13);
      const isbn10 = normalizeIsbn(book.isbn10);
      const isbn13Hits = isbn13 ? (bookIdsByIsbn.get(isbn13) ?? []) : [];
      const isbn10Hits = isbn10 ? (bookIdsByIsbn.get(isbn10) ?? []) : [];
      const uniqueBookIds = [...new Set([...isbn13Hits, ...isbn10Hits])];

      if (uniqueBookIds.length === 1) {
        results.set(isbn, found(uniqueBookIds[0]));
      } else if (uniqueBookIds.length > 1) {
        results.set(isbn, AMBIGUOUS);
      } else {
        results.set(isbn, NONE);
      }
    }

    return results;
  }

  private async batchLookupFileHashes(sourceBooks: SourceBook[]): Promise<Map<string, LookupResult>> {
    const hashes = new Set<string>();
    for (const book of sourceBooks) {
      for (const hash of sourceFileHashes(book)) hashes.add(hash);
    }

    const results = new Map<string, LookupResult>();
    if (hashes.size === 0) return results;

    const chunkSize = 500;
    const bookIdsByHash = new Map<string, number[]>();
    const allHashes = [...hashes];

    for (let i = 0; i < allHashes.length; i += chunkSize) {
      const chunk = allHashes.slice(i, i + chunkSize);
      const rows = await this.db
        .select({ bookId: schema.bookFiles.bookId, hash: schema.bookFiles.hash })
        .from(schema.bookFiles)
        .where(inArray(schema.bookFiles.hash, chunk));
      for (const row of rows) {
        if (!row.hash) continue;
        const existing = bookIdsByHash.get(row.hash) ?? [];
        existing.push(row.bookId);
        bookIdsByHash.set(row.hash, existing);
      }
    }

    for (const [hash, bookIds] of bookIdsByHash) {
      const unique = [...new Set(bookIds)];
      if (unique.length === 1) {
        results.set(hash, found(unique[0]));
      } else if (unique.length > 1) {
        results.set(hash, AMBIGUOUS);
      } else {
        results.set(hash, NONE);
      }
    }

    return results;
  }

  private async lookupByFilePath(filePath: string): Promise<LookupResult> {
    const rows = await this.db
      .select({ bookId: schema.bookFiles.bookId })
      .from(schema.bookFiles)
      .where(eq(schema.bookFiles.absolutePath, filePath))
      .limit(2);

    return toLookupResult(rows);
  }

  private async lookupByTitleAuthor(title: string, authors: string[]): Promise<LookupResult> {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) return NONE;

    const normalizedAuthors = [...new Set(authors.map((author) => normalizeAuthor(author)).filter((author): author is string => !!author))];
    if (normalizedAuthors.length === 0) return NONE;

    const normalizedAuthorsLower = normalizedAuthors.map((author) => author.toLowerCase());
    const exactRows = await this.db
      .selectDistinct({ bookId: schema.bookMetadata.bookId })
      .from(schema.bookMetadata)
      .innerJoin(schema.bookAuthors, eq(schema.bookAuthors.bookId, schema.bookMetadata.bookId))
      .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
      .where(
        and(
          sql`lower(${schema.bookMetadata.title}) = lower(${normalizedTitle})`,
          inArray(sql<string>`lower(${schema.authors.name})`, normalizedAuthorsLower),
        ),
      )
      .limit(2);
    const exactResult = toLookupResult(exactRows);
    if (exactResult.kind !== 'none') {
      return exactResult;
    }

    const approxClauses = normalizedAuthors.map((author) => ilike(schema.authors.name, `%${escapeLike(author)}%`));
    const approxRows = await this.db
      .selectDistinct({ bookId: schema.bookMetadata.bookId })
      .from(schema.bookMetadata)
      .innerJoin(schema.bookAuthors, eq(schema.bookAuthors.bookId, schema.bookMetadata.bookId))
      .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
      .where(and(sql`lower(${schema.bookMetadata.title}) = lower(${normalizedTitle})`, or(...approxClauses)!))
      .limit(2);
    const approxResult = toLookupResult(approxRows);
    if (approxResult.kind !== 'none') {
      return approxResult;
    }

    return NONE;
  }
}

function toLookupResult(rows: Array<{ bookId: number }>): LookupResult {
  if (rows.length === 1) return found(rows[0].bookId);
  if (rows.length > 1) return AMBIGUOUS;
  return NONE;
}

export function deriveUnresolvedReason(attempts: MatchAttempt[]): UnresolvedReasonCode {
  if (attempts.includes('title_author')) return 'no_title_author_match';
  if (attempts.includes('file_path')) return 'no_file_path_match';
  if (attempts.includes('file_hash')) return 'no_file_hash_match';
  if (attempts.includes('isbn')) return 'no_isbn_match';
  return 'insufficient_source_data';
}

function deriveAmbiguousReason(strategy: MatchAttempt): UnresolvedReasonCode {
  switch (strategy) {
    case 'isbn':
      return 'ambiguous_isbn_match';
    case 'file_hash':
      return 'ambiguous_file_hash_match';
    case 'file_path':
      return 'ambiguous_file_path_match';
    case 'title_author':
      return 'ambiguous_title_author_match';
  }
}

function normalizeTitle(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeAuthor(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIsbn(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/[^0-9Xx]/g, '').toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizedIsbnSql(column: typeof schema.bookMetadata.isbn10 | typeof schema.bookMetadata.isbn13) {
  return sql<string>`regexp_replace(upper(coalesce(${column}, '')), '[^0-9X]', '', 'g')`;
}

function sourceFileHashes(sourceBook: SourceBook): string[] {
  const hashes = new Set<string>();
  if (sourceBook.fileHash) hashes.add(sourceBook.fileHash);
  for (const file of sourceBook.files ?? []) {
    if (file.fileHash) hashes.add(file.fileHash);
  }
  return [...hashes];
}

function sourceFilePaths(sourceBook: SourceBook): string[] {
  const paths = new Set<string>();
  if (sourceBook.filePath) paths.add(sourceBook.filePath);
  for (const file of sourceBook.files ?? []) {
    if (file.filePath) paths.add(file.filePath);
  }
  return [...paths];
}

function getSourceAuthorNames(sourceBook: SourceBook): string[] {
  const structured = sourceBook.authors?.map((author) => author.name).filter((name) => name.trim().length > 0) ?? [];
  if (structured.length > 0) return structured;
  const legacy = normalizeAuthor(sourceBook.author);
  return legacy ? [legacy] : [];
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function buildTitleAuthorCacheKey(title: string | null, authors: string[]): string {
  return `${normalizeTitle(title) ?? ''}|${authors.map((author) => normalizeAuthor(author)?.toLowerCase() ?? '').join(';')}`;
}

export function applyPathMappings(filePath: string | null, mappings: PathMapping[]): string | null {
  if (!filePath) return null;

  const sorted = [...mappings].sort((a, b) => b.sourcePrefix.length - a.sourcePrefix.length);
  for (const mapping of sorted) {
    const sourcePrefix = normalizePathPrefix(mapping.sourcePrefix);
    const targetPrefix = normalizePathPrefix(mapping.targetPrefix);
    if (!sourcePrefix || !targetPrefix) continue;

    if (pathMatchesPrefix(filePath, sourcePrefix)) {
      return `${targetPrefix}${filePath.slice(sourcePrefix.length)}`;
    }
  }

  return filePath;
}

export function pathMatchesPrefix(filePath: string, sourcePrefix: string): boolean {
  if (sourcePrefix === '/') return filePath.startsWith('/');
  return filePath === sourcePrefix || filePath.startsWith(`${sourcePrefix}/`);
}

function normalizePathPrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}
