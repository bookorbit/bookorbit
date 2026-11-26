import { Inject, Injectable } from '@nestjs/common';
import type { RegexMetadataConfig, SeriesUnit } from '@bookorbit/types';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, bookMetadata, bookSeriesMemberships, books, libraries } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export type SeriesUnitBackfillCandidate = {
  bookId: number;
  libraryId: number;
  relPath: string;
  seriesIndex: string;
  lockedFields: string[];
  rules: RegexMetadataConfig;
};

export type SeriesUnitBackfillWrite = {
  bookId: number;
  seriesIndex: string;
  unit: SeriesUnit;
  volumeIndex: string | null;
};

const COMIC_FORMATS = sql.raw(`('cbz', 'cbr', 'cb7', 'cbt')`);

@Injectable()
export class SeriesUnitBackfillRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Numbered comic books with no unit yet, in libraries with path rules, after `afterBookId`. */
  async findCandidates(afterBookId: number, limit: number): Promise<SeriesUnitBackfillCandidate[]> {
    const rows = await this.db.execute<{
      book_id: number;
      library_id: number;
      rel_path: string;
      series_index: string;
      locked_fields: string[];
      regex_metadata: RegexMetadataConfig;
    }>(sql`
      SELECT ${books.id} AS book_id, ${books.libraryId} AS library_id, ${bookFiles.relPath} AS rel_path, ${bookMetadata.seriesIndex} AS series_index,
        ${bookMetadata.lockedFields} AS locked_fields, ${libraries.regexMetadata} AS regex_metadata
      FROM ${books}
      INNER JOIN ${libraries} ON ${libraries.id} = ${books.libraryId}
      INNER JOIN ${bookMetadata} ON ${bookMetadata.bookId} = ${books.id}
      INNER JOIN ${bookFiles} ON ${bookFiles.id} = ${books.primaryFileId}
      WHERE ${books.id} > ${afterBookId}
        AND ${libraries.regexMetadata} IS NOT NULL
        AND ${bookMetadata.seriesId} IS NOT NULL
        AND ${bookMetadata.seriesIndex} IS NOT NULL
        AND ${bookMetadata.seriesUnit} IS NULL
        AND ${bookFiles.relPath} IS NOT NULL
        AND lower(${bookFiles.format}) IN ${COMIC_FORMATS}
      ORDER BY ${books.id}
      LIMIT ${limit}
    `);
    return rows.rows.map((row) => ({
      bookId: Number(row.book_id),
      libraryId: Number(row.library_id),
      relPath: row.rel_path,
      seriesIndex: row.series_index,
      lockedFields: row.locked_fields ?? [],
      rules: row.regex_metadata,
    }));
  }

  /**
   * Sets the unit on the book and on its primary series membership. Both are guarded by the number
   * and an empty unit, so a book a scan or a person changed meanwhile is left alone. Returns the ids
   * of the books written.
   */
  async writeUnits(writes: readonly SeriesUnitBackfillWrite[]): Promise<number[]> {
    if (writes.length === 0) return [];
    const values = sql.join(
      writes.map((write) => sql`(${write.bookId}::int, ${write.seriesIndex}::text, ${write.unit}::text, ${write.volumeIndex}::text)`),
      sql`, `,
    );
    return this.db.transaction(async (tx) => {
      const updated = await tx.execute<{ book_id: number }>(sql`
        UPDATE ${bookMetadata} AS m
        SET series_unit = w.unit, series_volume_index = w.volume_index
        FROM (VALUES ${values}) AS w(book_id, series_index, unit, volume_index)
        WHERE m.book_id = w.book_id AND m.series_index = w.series_index AND m.series_unit IS NULL
        RETURNING m.book_id
      `);
      const bookIds = updated.rows.map((row) => Number(row.book_id));
      if (bookIds.length === 0) return bookIds;
      await tx.execute(sql`
        UPDATE ${bookSeriesMemberships} AS bsm
        SET series_unit = m.series_unit, series_volume_index = m.series_volume_index
        FROM ${bookMetadata} AS m
        WHERE m.book_id = bsm.book_id
          AND bsm.series_id = m.series_id
          AND bsm.display_order = 0
          AND bsm.series_index = m.series_index
          AND bsm.series_unit IS NULL
          AND bsm.book_id = ANY(${sql.param(bookIds)}::int[])
      `);
      return bookIds;
    });
  }
}
