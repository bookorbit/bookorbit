import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import type { SourceBook } from '../adapters/source-adapter.types';
import type { PathMapping, PlannedBookMatch, PlannedUnresolvedBook, UnresolvedReasonCode } from './planner.types';

type Db = NodePgDatabase<typeof schema>;
type MatchAttempt = 'isbn' | 'file_hash' | 'file_path' | 'title_author';

@Injectable()
export class MatchingService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async matchBooks(
    sourceBooks: SourceBook[],
    pathMappings: PathMapping[],
  ): Promise<{ matches: PlannedBookMatch[]; unresolved: PlannedUnresolvedBook[] }> {
    const matches: PlannedBookMatch[] = [];
    const unresolved: PlannedUnresolvedBook[] = [];

    const isbnCache = new Map<string, number | null>();
    const fileHashCache = new Map<string, number | null>();
    const filePathCache = new Map<string, number | null>();
    const titleAuthorCache = new Map<string, number | null>();

    for (const sourceBook of sourceBooks) {
      const attempts: MatchAttempt[] = [];
      const isbn = sourceBook.isbn13 ?? sourceBook.isbn10;
      if (isbn) {
        attempts.push('isbn');
        const cached = isbnCache.get(isbn);
        const bookId = cached !== undefined ? cached : await this.findByIsbn(sourceBook.isbn13, sourceBook.isbn10);
        if (cached === undefined) isbnCache.set(isbn, bookId);
        if (bookId) {
          matches.push({ sourceBookId: sourceBook.sourceBookId, targetBookId: bookId, strategy: 'isbn' });
          continue;
        }
      }

      if (sourceBook.fileHash) {
        attempts.push('file_hash');
        const hash = sourceBook.fileHash;
        const cached = fileHashCache.get(hash);
        const bookId = cached !== undefined ? cached : await this.findByFileHash(hash);
        if (cached === undefined) fileHashCache.set(hash, bookId);
        if (bookId) {
          matches.push({ sourceBookId: sourceBook.sourceBookId, targetBookId: bookId, strategy: 'file_hash' });
          continue;
        }
      }

      const mappedPath = applyPathMappings(sourceBook.filePath, pathMappings);
      if (mappedPath) {
        attempts.push('file_path');
        const cached = filePathCache.get(mappedPath);
        const bookId = cached !== undefined ? cached : await this.findByFilePath(mappedPath);
        if (cached === undefined) filePathCache.set(mappedPath, bookId);
        if (bookId) {
          matches.push({ sourceBookId: sourceBook.sourceBookId, targetBookId: bookId, strategy: 'path_mapping' });
          continue;
        }
      }

      const titleKey = normalizeTitle(sourceBook.title);
      if (titleKey) {
        attempts.push('title_author');
        const authorNames = getSourceAuthorNames(sourceBook);
        const cacheKey = buildTitleAuthorCacheKey(sourceBook.title, authorNames);
        const cached = titleAuthorCache.get(cacheKey);
        const bookId = cached !== undefined ? cached : await this.findByTitleAuthor(sourceBook.title ?? '', authorNames);
        if (cached === undefined) titleAuthorCache.set(cacheKey, bookId);
        if (bookId) {
          matches.push({ sourceBookId: sourceBook.sourceBookId, targetBookId: bookId, strategy: 'title_author' });
          continue;
        }
      }

      unresolved.push({
        sourceBookId: sourceBook.sourceBookId,
        title: sourceBook.title,
        reason: deriveUnresolvedReason(attempts),
      });
    }

    return { matches, unresolved };
  }

  private async findByIsbn(isbn13: string | null, isbn10: string | null): Promise<number | null> {
    if (!isbn13 && !isbn10) return null;

    const where =
      isbn13 && isbn10
        ? or(eq(schema.bookMetadata.isbn13, isbn13), eq(schema.bookMetadata.isbn10, isbn10))
        : isbn13
          ? eq(schema.bookMetadata.isbn13, isbn13)
          : eq(schema.bookMetadata.isbn10, isbn10 as string);

    const rows = await this.db.select({ bookId: schema.bookMetadata.bookId }).from(schema.bookMetadata).where(where).limit(2);

    return singleBookId(rows);
  }

  private async findByFileHash(fileHash: string): Promise<number | null> {
    const rows = await this.db.select({ bookId: schema.bookFiles.bookId }).from(schema.bookFiles).where(eq(schema.bookFiles.hash, fileHash)).limit(2);

    return singleBookId(rows);
  }

  private async findByFilePath(filePath: string): Promise<number | null> {
    const rows = await this.db
      .select({ bookId: schema.bookFiles.bookId })
      .from(schema.bookFiles)
      .where(eq(schema.bookFiles.absolutePath, filePath))
      .limit(2);

    return singleBookId(rows);
  }

  private async findByTitleAuthor(title: string, authors: string[]): Promise<number | null> {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) return null;

    const normalizedAuthors = authors.map((author) => normalizeAuthor(author)).filter((author): author is string => !!author);
    if (normalizedAuthors.length === 0) return null;

    for (const normalizedAuthor of normalizedAuthors) {
      const exactRows = await this.db
        .select({ bookId: schema.bookMetadata.bookId })
        .from(schema.bookMetadata)
        .innerJoin(schema.bookAuthors, eq(schema.bookAuthors.bookId, schema.bookMetadata.bookId))
        .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
        .where(and(eq(schema.bookMetadata.title, normalizedTitle), eq(schema.authors.name, normalizedAuthor)))
        .limit(2);
      const exactBookId = singleBookId(exactRows);
      if (exactBookId) return exactBookId;
    }

    for (const normalizedAuthor of normalizedAuthors) {
      const approxRows = await this.db
        .select({ bookId: schema.bookMetadata.bookId })
        .from(schema.bookMetadata)
        .innerJoin(schema.bookAuthors, eq(schema.bookAuthors.bookId, schema.bookMetadata.bookId))
        .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
        .where(and(eq(schema.bookMetadata.title, normalizedTitle), ilike(schema.authors.name, `%${escapeLike(normalizedAuthor)}%`)))
        .limit(2);
      const approxBookId = singleBookId(approxRows);
      if (approxBookId) return approxBookId;
    }

    return null;
  }
}

export function deriveUnresolvedReason(attempts: MatchAttempt[]): UnresolvedReasonCode {
  if (attempts.includes('title_author')) return 'no_title_author_match';
  if (attempts.includes('file_path')) return 'no_file_path_match';
  if (attempts.includes('file_hash')) return 'no_file_hash_match';
  if (attempts.includes('isbn')) return 'no_isbn_match';
  return 'insufficient_source_data';
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

function singleBookId(rows: Array<{ bookId: number }>): number | null {
  return rows.length === 1 ? rows[0].bookId : null;
}

export function applyPathMappings(filePath: string | null, mappings: PathMapping[]): string | null {
  if (!filePath) return null;

  const sorted = [...mappings].sort((a, b) => b.sourcePrefix.length - a.sourcePrefix.length);
  for (const mapping of sorted) {
    const sourcePrefix = normalizePathPrefix(mapping.sourcePrefix);
    const targetPrefix = normalizePathPrefix(mapping.targetPrefix);
    if (!sourcePrefix || !targetPrefix) continue;

    if (filePath.startsWith(sourcePrefix)) {
      return `${targetPrefix}${filePath.slice(sourcePrefix.length)}`;
    }
  }

  return filePath;
}

function normalizePathPrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}
