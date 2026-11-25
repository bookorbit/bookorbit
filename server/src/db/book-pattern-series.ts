import type { MetadataSeriesMembership } from '@bookorbit/types';
import { sql } from 'drizzle-orm';
import { books, bookSeries, bookSeriesMemberships } from './schema';

// Keep one row per book in naming queries, regardless of its number of files or memberships.
export const patternSeriesMemberships = sql<MetadataSeriesMembership[] | null>`(
  select jsonb_agg(jsonb_build_object(
    'seriesName', ${bookSeries.name}, 'seriesIndex', ${bookSeriesMemberships.seriesIndex}
  ) order by ${bookSeriesMemberships.displayOrder})
  from ${bookSeriesMemberships}
  join ${bookSeries} on ${bookSeries.id} = ${bookSeriesMemberships.seriesId}
  where ${bookSeriesMemberships.bookId} = ${books.id}
)`;
