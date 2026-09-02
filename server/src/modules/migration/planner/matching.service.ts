import { Inject, Injectable, Logger } from '@nestjs/common';
import { inArray, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import { accentInsensitiveIlike } from '../../../common/utils/accent-insensitive-search.utils';
import * as schema from '../../../db/schema';
import type { SourceBook } from '../adapters/source-adapter.types';
import type { PathMapping, PlannedBookMatch, PlannedUnresolvedBook, UnresolvedReasonCode } from './planner.types';

type Db = NodePgDatabase<typeof schema>;
type MatchAttempt = 'isbn' | 'asin' | 'file_hash' | 'file_path' | 'title_author';

type LookupResult = { kind: 'found'; bookId: number } | { kind: 'ambiguous' } | { kind: 'none' };
type TitleAuthorMatchLevel = 'exact' | 'approx';
type TitleAuthorLookupRow = { match_key: string; book_id: number; match_level: TitleAuthorMatchLevel };

const LOOKUP_CHUNK_SIZE = 500;
// Bounds how many LOOKUP_CHUNK_SIZE queries run at once per strategy. High enough to cut
// wall-clock time substantially on large libraries, low enough not to overwhelm the DB pool.
const LOOKUP_CONCURRENCY = 4;

function found(bookId: number): LookupResult {
  return { kind: 'found', bookId };
}
const AMBIGUOUS: LookupResult = { kind: 'ambiguous' };
const NONE: LookupResult = { kind: 'none' };

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  // Splits items into LOOKUP_CHUNK_SIZE-sized chunks and runs fn against them with bounded
  // concurrency, instead of one DB round-trip at a time. Each strategy's chunk loop used to
  // await sequentially; at 30k+ source books that meant dozens of round-trips back to back
  // per strategy, on top of the strategies themselves also running sequentially.
  private async runChunked<T, R>(items: T[], chunkSize: number, concurrency: number, fn: (chunk: T[]) => Promise<R>): Promise<R[]> {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize));
    }

    const results: R[] = [];
    for (let i = 0; i < chunks.length; i += concurrency) {
      const batch = chunks.slice(i, i + concurrency);
      results.push(...(await Promise.all(batch.map((chunk) => fn(chunk)))));
    }
    return results;
  }

  async matchBooks(
    sourceBooks: SourceBook[],
    pathMappings: PathMapping[],
  ): Promise<{ matches: PlannedBookMatch[]; unresolved: PlannedUnresolvedBook[] }> {
    const startMs = Date.now();
    this.logger.log(`[book.matching] [start] sourceBooks=${sourceBooks.length} pathMappings=${pathMappings.length} - matching started`);

    const matches: PlannedBookMatch[] = [];
    const unresolved: PlannedUnresolvedBook[] = [];

    // The five strategies are independent lookups merged below by priority, so nothing
    // requires them to run one after another.
    const [isbnIndex, asinIndex, hashIndex, filePathIndex, titleAuthorIndex] = await Promise.all([
      this.batchLookupIsbns(sourceBooks),
      this.batchLookupAsins(sourceBooks),
      this.batchLookupFileHashes(sourceBooks),
      this.batchLookupFilePaths(sourceBooks, pathMappings),
      this.batchLookupTitleAuthors(sourceBooks),
    ]);

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

      if (sourceAsinCandidates(sourceBook).length > 0) {
        attempts.push('asin');
        const result = asinIndex.get(sourceBook.sourceBookId) ?? NONE;
        if (result.kind === 'found') {
          matches.push({ sourceBookId: sourceBook.sourceBookId, targetBookId: result.bookId, strategy: 'asin' });
          continue;
        }
        if (result.kind === 'ambiguous') ambiguousStrategy ??= 'asin';
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
          const result = filePathIndex.get(mappedPath) ?? NONE;
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
        const result = titleAuthorIndex.get(cacheKey) ?? NONE;
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

    const bookIdsByIsbn = new Map<string, number[]>();

    const allIsbns13 = [...isbn13s];
    const isbn13Batches = await this.runChunked(allIsbns13, LOOKUP_CHUNK_SIZE, LOOKUP_CONCURRENCY, (chunk) => {
      const normalizedTargetIsbn13 = normalizedIsbnSql(schema.bookMetadata.isbn13);
      return this.db
        .select({ bookId: schema.bookMetadata.bookId, isbn13: normalizedTargetIsbn13 })
        .from(schema.bookMetadata)
        .where(inArray(normalizedTargetIsbn13, chunk));
    });
    for (const rows of isbn13Batches) {
      for (const row of rows) {
        const isbn = normalizeIsbn(row.isbn13);
        if (!isbn) continue;
        const existing = bookIdsByIsbn.get(isbn) ?? [];
        existing.push(row.bookId);
        bookIdsByIsbn.set(isbn, existing);
      }
    }

    const allIsbns10 = [...isbn10s];
    const isbn10Batches = await this.runChunked(allIsbns10, LOOKUP_CHUNK_SIZE, LOOKUP_CONCURRENCY, (chunk) => {
      const normalizedTargetIsbn10 = normalizedIsbnSql(schema.bookMetadata.isbn10);
      return this.db
        .select({ bookId: schema.bookMetadata.bookId, isbn10: normalizedTargetIsbn10 })
        .from(schema.bookMetadata)
        .where(inArray(normalizedTargetIsbn10, chunk));
    });
    for (const rows of isbn10Batches) {
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

  private async batchLookupAsins(sourceBooks: SourceBook[]): Promise<Map<string, LookupResult>> {
    const asins = new Set<string>();
    for (const book of sourceBooks) {
      for (const asin of sourceAsinCandidates(book)) asins.add(asin);
    }

    const results = new Map<string, LookupResult>();
    if (asins.size === 0) return results;

    const bookIdsByAsin = new Map<string, Set<number>>();
    const allAsins = [...asins];

    const asinBatches = await this.runChunked(allAsins, LOOKUP_CHUNK_SIZE, LOOKUP_CONCURRENCY, (chunk) => {
      const normalizedTargetAmazonId = normalizedAsinSql(schema.bookMetadata.amazonId);
      const normalizedTargetAudibleId = normalizedAsinSql(schema.bookMetadata.audibleId);
      return this.db
        .select({
          bookId: schema.bookMetadata.bookId,
          amazonId: normalizedTargetAmazonId,
          audibleId: normalizedTargetAudibleId,
        })
        .from(schema.bookMetadata)
        .where(or(inArray(normalizedTargetAmazonId, chunk), inArray(normalizedTargetAudibleId, chunk)));
    });

    for (const rows of asinBatches) {
      for (const row of rows) {
        const matchedAsins = new Set([normalizeAsin(row.amazonId), normalizeAsin(row.audibleId)]);
        matchedAsins.delete(null);
        for (const asin of matchedAsins) {
          if (!asin || !asins.has(asin)) continue;
          const bookIds = bookIdsByAsin.get(asin) ?? new Set<number>();
          bookIds.add(row.bookId);
          bookIdsByAsin.set(asin, bookIds);
        }
      }
    }

    for (const book of sourceBooks) {
      const candidates = sourceAsinCandidates(book);
      if (candidates.length === 0) continue;

      const matchingBookIds = new Set<number>();
      for (const asin of candidates) {
        for (const bookId of bookIdsByAsin.get(asin) ?? []) matchingBookIds.add(bookId);
      }

      if (matchingBookIds.size === 1) {
        results.set(book.sourceBookId, found([...matchingBookIds][0]));
      } else if (matchingBookIds.size > 1) {
        results.set(book.sourceBookId, AMBIGUOUS);
      } else {
        results.set(book.sourceBookId, NONE);
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

    const bookIdsByHash = new Map<string, number[]>();
    const allHashes = [...hashes];

    const hashBatches = await this.runChunked(allHashes, LOOKUP_CHUNK_SIZE, LOOKUP_CONCURRENCY, (chunk) =>
      this.db
        .select({ bookId: schema.bookFiles.bookId, hash: schema.bookFiles.fileHash })
        .from(schema.bookFiles)
        .where(inArray(schema.bookFiles.fileHash, chunk)),
    );
    for (const rows of hashBatches) {
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

  private async batchLookupFilePaths(sourceBooks: SourceBook[], pathMappings: PathMapping[]): Promise<Map<string, LookupResult>> {
    const mappedPaths = new Set<string>();
    for (const sourceBook of sourceBooks) {
      for (const sourcePath of sourceFilePaths(sourceBook)) {
        const mappedPath = applyPathMappings(sourcePath, pathMappings);
        if (mappedPath) mappedPaths.add(mappedPath);
      }
    }

    const bookIdsByPath = new Map<string, Set<number>>();
    const allMappedPaths = [...mappedPaths];
    const pathBatches = await this.runChunked(allMappedPaths, LOOKUP_CHUNK_SIZE, LOOKUP_CONCURRENCY, (chunk) =>
      this.db
        .select({ bookId: schema.bookFiles.bookId, absolutePath: schema.bookFiles.absolutePath })
        .from(schema.bookFiles)
        .where(inArray(schema.bookFiles.absolutePath, chunk)),
    );
    for (const rows of pathBatches) {
      for (const row of rows) {
        const bookIds = bookIdsByPath.get(row.absolutePath) ?? new Set<number>();
        bookIds.add(row.bookId);
        bookIdsByPath.set(row.absolutePath, bookIds);
      }
    }

    const results = new Map<string, LookupResult>();
    for (const [filePath, bookIds] of bookIdsByPath) {
      results.set(filePath, toLookupResult([...bookIds].map((bookId) => ({ bookId }))));
    }
    return results;
  }

  private async batchLookupTitleAuthors(sourceBooks: SourceBook[]): Promise<Map<string, LookupResult>> {
    const candidates = new Map<string, { cacheKey: string; title: string; authors: string[] }>();
    for (const sourceBook of sourceBooks) {
      const title = sourceBook.title?.trim();
      if (!title) continue;
      const authors = [
        ...new Set(
          getSourceAuthorNames(sourceBook)
            .map(normalizeAuthor)
            .filter((author): author is string => author !== null),
        ),
      ];
      if (authors.length === 0) continue;
      const cacheKey = buildTitleAuthorCacheKey(title, authors);
      candidates.set(cacheKey, { cacheKey, title, authors });
    }

    const matchesByKey = new Map<string, { exact: Set<number>; approx: Set<number> }>();
    const allCandidates = [...candidates.values()];
    const titleAuthorBatches = await this.runChunked(allCandidates, LOOKUP_CHUNK_SIZE, LOOKUP_CONCURRENCY, async (chunk) => {
      const values = sql.join(
        chunk.map(({ cacheKey, title, authors }) => {
          const authorValues = sql.join(
            authors.map((author) => sql`${author}::text`),
            sql`, `,
          );
          const authorPatternValues = sql.join(
            authors.map((author) => sql`${escapeLike(author)}::text`),
            sql`, `,
          );
          return sql`(${cacheKey}::text, ${title}::text, array[${authorValues}]::text[], array[${authorPatternValues}]::text[])`;
        }),
        sql`, `,
      );
      const queryResult = await this.db.execute<TitleAuthorLookupRow>(sql`
        with source_candidates(match_key, title, authors, author_patterns) as (
          values ${values}
        ),
        candidate_matches as (
          select
            source_candidates.match_key,
            ${schema.bookMetadata.bookId} as book_id,
            bool_or(
              lower(${schema.bookMetadata.title}) = lower(source_candidates.title)
              and lower(${schema.authors.name}) = lower(source_author.author)
            ) as exact_match,
            bool_or(
              lower(public.bookorbit_unaccent(${schema.bookMetadata.title})) =
                lower(public.bookorbit_unaccent(source_candidates.title))
              and ${accentInsensitiveIlike(schema.authors.name, sql`'%' || source_author.author_pattern || '%'`)}
            ) as approx_match
          from source_candidates
          cross join lateral unnest(source_candidates.authors, source_candidates.author_patterns)
            as source_author(author, author_pattern)
          inner join ${schema.bookMetadata} on (
            lower(${schema.bookMetadata.title}) = lower(source_candidates.title)
            or lower(public.bookorbit_unaccent(${schema.bookMetadata.title})) =
              lower(public.bookorbit_unaccent(source_candidates.title))
          )
          inner join ${schema.bookAuthors} on ${schema.bookAuthors.bookId} = ${schema.bookMetadata.bookId}
          inner join ${schema.authors} on ${schema.authors.id} = ${schema.bookAuthors.authorId}
          group by source_candidates.match_key, ${schema.bookMetadata.bookId}
        ),
        ranked_matches as (
          select
            match_key,
            book_id,
            case when exact_match then 'exact' else 'approx' end as match_level,
            row_number() over (
              partition by match_key, case when exact_match then 'exact' else 'approx' end
              order by book_id
            ) as match_rank
          from candidate_matches
          where exact_match or approx_match
        )
        select match_key, book_id, match_level
        from ranked_matches
        where match_rank <= 2
      `);
      return queryResult.rows;
    });

    for (const rows of titleAuthorBatches) {
      for (const row of rows) {
        const matches = matchesByKey.get(row.match_key) ?? { exact: new Set<number>(), approx: new Set<number>() };
        matches[row.match_level].add(row.book_id);
        matchesByKey.set(row.match_key, matches);
      }
    }

    const results = new Map<string, LookupResult>();
    for (const { cacheKey } of candidates.values()) {
      const matches = matchesByKey.get(cacheKey);
      const bookIds = matches && matches.exact.size > 0 ? matches.exact : matches?.approx;
      results.set(cacheKey, toLookupResult([...(bookIds ?? [])].map((bookId) => ({ bookId }))));
    }
    return results;
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
  if (attempts.includes('asin')) return 'no_asin_match';
  if (attempts.includes('isbn')) return 'no_isbn_match';
  return 'insufficient_source_data';
}

function deriveAmbiguousReason(strategy: MatchAttempt): UnresolvedReasonCode {
  switch (strategy) {
    case 'isbn':
      return 'ambiguous_isbn_match';
    case 'asin':
      return 'ambiguous_asin_match';
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

function normalizeAsin(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(normalized) ? normalized : null;
}

function normalizedAsinSql(column: typeof schema.bookMetadata.amazonId | typeof schema.bookMetadata.audibleId) {
  return sql<string>`upper(btrim(coalesce(${column}, '')))`;
}

function sourceAsinCandidates(sourceBook: SourceBook): string[] {
  const candidates = [sourceBook.asin, sourceBook.amazonId, sourceBook.audibleId]
    .map((value) => normalizeAsin(value))
    .filter((value): value is string => value !== null);
  return [...new Set(candidates)];
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
