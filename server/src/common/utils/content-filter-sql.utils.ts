import { SQL, and, inArray, notExists, exists, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContentFilterRules } from '@bookorbit/types';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/**
 * Builds SQL clauses that enforce content filter rules for a book query.
 *
 * Include semantics (OR across types):
 * - If only includeTagIds is set: book must have at least one of those tags.
 * - If only includeGenreIds is set: book must have at least one of those genres.
 * - If both are set: book must match AT LEAST ONE condition (tag OR genre).
 *   This lets an admin grant access to "kids books plus dark fantasy" without
 *   requiring a book to simultaneously carry both a tag and a genre.
 * - Books with no relevant tags/genres are hidden when an include list is active.
 *
 * Exclude semantics (applied independently, after include):
 * - excludeTagIds: book must NOT have any of these tags.
 * - excludeGenreIds: book must NOT have any of these genres.
 */
export function buildContentFilterClauses(contentFilters: ContentFilterRules, db: Db): SQL[] {
  const clauses: SQL[] = [];

  const hasIncludeTags = contentFilters.includeTagIds.length > 0;
  const hasIncludeGenres = contentFilters.includeGenreIds.length > 0;

  if (hasIncludeTags || hasIncludeGenres) {
    const tagInclude = hasIncludeTags
      ? exists(
          db
            .select({ one: sql`1` })
            .from(schema.bookTags)
            .where(and(sql`${schema.bookTags.bookId} = ${schema.books.id}`, inArray(schema.bookTags.tagId, contentFilters.includeTagIds))),
        )
      : null;

    const genreInclude = hasIncludeGenres
      ? exists(
          db
            .select({ one: sql`1` })
            .from(schema.bookGenres)
            .where(and(sql`${schema.bookGenres.bookId} = ${schema.books.id}`, inArray(schema.bookGenres.genreId, contentFilters.includeGenreIds))),
        )
      : null;

    if (tagInclude && genreInclude) {
      clauses.push(or(tagInclude, genreInclude)!);
    } else if (tagInclude) {
      clauses.push(tagInclude);
    } else if (genreInclude) {
      clauses.push(genreInclude);
    }
  }

  if (contentFilters.excludeTagIds.length > 0) {
    const sq = db
      .select({ one: sql`1` })
      .from(schema.bookTags)
      .where(and(sql`${schema.bookTags.bookId} = ${schema.books.id}`, inArray(schema.bookTags.tagId, contentFilters.excludeTagIds)));
    clauses.push(notExists(sq));
  }

  if (contentFilters.excludeGenreIds.length > 0) {
    const sq = db
      .select({ one: sql`1` })
      .from(schema.bookGenres)
      .where(and(sql`${schema.bookGenres.bookId} = ${schema.books.id}`, inArray(schema.bookGenres.genreId, contentFilters.excludeGenreIds)));
    clauses.push(notExists(sq));
  }

  return clauses;
}
