import { sql, type SQL } from 'drizzle-orm';

/**
 * Linked books that match a listing, as a `link_members` CTE (trailing comma included). It starts
 * from `book_links`, so its cost follows the number of linked books rather than the library size.
 *
 * - `matched_members`: members of the group that match. Only groups with two or more fold.
 * - `pref_rn`: 1 for the group's representative, present before missing, then the lead, then the
 *   lowest id. The sort plays no part, so selection ids stay stable when only the sort changes.
 * - `sort_rn` (only with `orderBy`): 1 for the member the listing sorts first, which places the
 *   group's card at its best position.
 */
export function linkMembersCte(visibleWhere: SQL, orderBy?: SQL[]): SQL {
  const sortRank = orderBy ? sql`, row_number() OVER (PARTITION BY bl.group_id ORDER BY ${sql.join(orderBy, sql`, `)}) AS sort_rn` : sql``;
  return sql`
    link_members AS MATERIALIZED (
      SELECT
        books.id,
        bl.group_id,
        count(*) OVER (PARTITION BY bl.group_id) AS matched_members,
        row_number() OVER (
          PARTITION BY bl.group_id
          ORDER BY CASE WHEN books.status = 'present' THEN 0 ELSE 1 END,
            CASE WHEN books.id = g.lead_book_id THEN 0 ELSE 1 END,
            books.id
        ) AS pref_rn
        ${sortRank}
      FROM book_links bl
      INNER JOIN book_link_groups g ON g.id = bl.group_id
      INNER JOIN books ON books.id = bl.book_id
      LEFT JOIN book_metadata ON book_metadata.book_id = books.id
      WHERE ${visibleWhere}
    ),
  `;
}

/** Drops every matching member but the one the listing sorts first. Needs `linkMembersCte` with `orderBy`. */
export const LINK_FOLDED_BY_SORT_SQL = sql`NOT EXISTS (
  SELECT 1 FROM link_members lm WHERE lm.id = books.id AND lm.matched_members > 1 AND lm.sort_rn > 1
)`;

/** Drops every matching member but the representative. */
export const LINK_FOLDED_BY_PREFERENCE_SQL = sql`NOT EXISTS (
  SELECT 1 FROM link_members lm WHERE lm.id = books.id AND lm.matched_members > 1 AND lm.pref_rn > 1
)`;

/** Matching books a folded group hides: what a book total adds back to a card total. */
export const LINK_FOLDED_COUNT_SQL = sql`(SELECT count(*) FROM link_members WHERE matched_members > 1 AND pref_rn > 1)`;
