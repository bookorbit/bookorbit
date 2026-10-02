import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { DbTransaction } from './book.repository';

@Injectable()
export class BookMergeRepository {
  async reconcileBookDependents(tx: DbTransaction, sourceBookIds: number[], targetBookId: number): Promise<void> {
    const ids = sourceBookIds.join(',');

    // For series memberships, the source rows that match the target row are removed before the remaining source rows move to the target book.
    await this.mergeSeriesMemberships(tx, ids, targetBookId);

    //Duplicates are removed before the remaining source rows move to the target book.
    await this.mergeRemoveDuplicates(tx, ids, targetBookId);

    //reading session sync courser
    await this.mergeReadingSessionCourser(tx, ids, targetBookId);

    //for all that use user_id and book_id as a composite key, the newest row wins. Source rows that lose to the target are removed before the remaining source rows move.
    await this.mergeTableUserID(tx, ids, targetBookId);

    // direct update only
    await this.mergeUpdateOnly(tx, ids, targetBookId);

    // delete only
    await this.mergeDeleteSource(tx, ids);

    //reading attempts and sessions
    await this.mergeReadingSessions(tx, ids, targetBookId);

    //Here starts the metadata merge
    await this.mergeMetadata(tx, ids, targetBookId);

    //Here starts the comic metadata merge
    await this.mergeComicMetadata(tx, ids, targetBookId);
  }

  private async mergeTableUserID(tx: DbTransaction, ids: string, targetBookId: number): Promise<void> {
    for (const table of [
      'user_book_status',
      'user_book_ratings',
      'user_book_notes',
      'kobo_reading_states',
      'kobo_book_entitlements',
      'hardcover_book_state',
      'storygraph_book_state',
    ]) {
      await tx.execute(
        sql.raw(
          `DELETE FROM ${table} older
          USING ${table} newer
          WHERE older.book_id IN (${ids}, ${targetBookId})
            AND newer.book_id IN (${ids}, ${targetBookId})
            AND older.user_id = newer.user_id
            AND (
              newer.updated_at > older.updated_at
              OR (
                newer.updated_at = older.updated_at
                AND newer.book_id > older.book_id
              )
            )`,
        ),
      );

      await tx.execute(
        sql.raw(
          `UPDATE ${table}
          SET book_id = ${targetBookId}
          WHERE book_id IN (${ids})`,
        ),
      );
    }
  }

  private async mergeSeriesMemberships(tx: DbTransaction, ids: string, targetBookId: number): Promise<void> {
    await tx.execute(
      sql.raw(
        `DELETE FROM book_series_memberships source
        USING book_series_memberships target
        WHERE source.book_id IN (${ids})
          AND target.book_id = ${targetBookId}
          AND source.series_id = target.series_id
          AND source.series_index = target.series_index`,
      ),
    );

    await tx.execute(
      sql.raw(
        `UPDATE book_series_memberships
        SET book_id = ${targetBookId}
        WHERE book_id IN (${ids})`,
      ),
    );
  }

  //Duplicates are removed before the remaining source rows move to the target book.
  private async mergeRemoveDuplicates(tx: DbTransaction, ids: string, targetBookId: number): Promise<void> {
    for (const [table, key] of [
      ['book_authors', 'author_id'],
      ['book_genres', 'genre_id'],
      ['book_tags', 'tag_id'],
      ['book_narrators', 'narrator_id'],
      ['collection_books', 'collection_id'],
      ['book_community_ratings', 'provider'],
      ['book_custom_metadata_values', 'field_id'],
      ['kobo_snapshot_books', 'snapshot_id'],
      ['kobo_device_snapshot_books', 'snapshot_id'],
    ] as const) {
      await tx.execute(
        sql.raw(
          `DELETE FROM ${table}
          WHERE ctid IN (
            SELECT ctid
            FROM (
              SELECT
                ctid,
                ROW_NUMBER() OVER (
                  PARTITION BY ${key}
                  ORDER BY
                    CASE WHEN book_id = ${targetBookId} THEN 0 ELSE 1 END,
                    book_id,
                    ctid
                ) AS row_number
              FROM ${table}
              WHERE book_id IN (${ids}, ${targetBookId})
            ) duplicates
            WHERE row_number > 1
          )`,
        ),
      );

      await tx.execute(
        sql.raw(
          `UPDATE ${table}
          SET book_id = ${targetBookId}
          WHERE book_id IN (${ids})`,
        ),
      );
    }
  }

  private async mergeReadingSessions(tx: DbTransaction, ids: string, targetBookId: number): Promise<void> {
    const readingAttempts = await tx.execute(
      sql.raw(
        `SELECT id, user_id, book_id, started_on, ended_on
        FROM reading_attempts
        WHERE book_id IN (${ids}, ${targetBookId})`,
      ),
    );

    const attemptsByUser = new Map<number, typeof readingAttempts.rows>();
    const attemptSurvivors = new Map<number, number>();

    for (const attempt of readingAttempts.rows) {
      const userAttempts = attemptsByUser.get(Number(attempt.user_id)) ?? [];
      userAttempts.push(attempt);
      attemptsByUser.set(Number(attempt.user_id), userAttempts);
    }

    const survivorIds: number[] = [];
    const deleteIds: number[] = [];

    for (const attempts of attemptsByUser.values()) {
      const ended = attempts.filter((attempt) => attempt.ended_on !== null);

      const candidates = ended.length > 0 ? ended : attempts;

      const survivor = candidates.reduce((newest: any, attempt: any) =>
        new Date(attempt.started_on).getTime() > new Date(newest.started_on).getTime() ? attempt : newest,
      );

      survivorIds.push(Number(survivor.id));

      for (const attempt of attempts) {
        if (attempt.id !== survivor.id) {
          deleteIds.push(Number(attempt.id));
          attemptSurvivors.set(Number(attempt.id), Number(survivor.id));
        }
      }
    }

    for (const [deleteId, survivorId] of attemptSurvivors) {
      await tx.execute(
        sql.raw(
          `UPDATE reading_sessions
          SET attempt_id = ${survivorId}, book_id = ${targetBookId}
          WHERE attempt_id = ${deleteId}`,
        ),
      );
    }

    if (deleteIds.length > 0) {
      await tx.execute(
        sql.raw(
          `DELETE FROM reading_attempts
          WHERE id IN (${deleteIds.join(',')})`,
        ),
      );
    }

    if (survivorIds.length > 0) {
      await tx.execute(
        sql.raw(
          `UPDATE reading_attempts
          SET book_id = ${targetBookId}
          WHERE id IN (${survivorIds.join(',')})`,
        ),
      );
    }
  }

  private async mergeMetadata(tx: DbTransaction, ids: string, targetBookId: number): Promise<void> {
    const metadataColumns = [
      'book_id',
      'title',
      'subtitle',
      'description',
      'isbn10',
      'isbn13',
      'publisher',
      'published_date',
      'published_year',
      'language',
      'page_count',
      'series_id',
      'series_name',
      'series_index',
      'rating',
      'cover_source',
      'google_books_id',
      'goodreads_id',
      'amazon_id',
      'hardcover_id',
      'hardcover_edition_id',
      'open_library_id',
      'itunes_id',
      'kobo_id',
      'metadata_score',
      'last_metadata_fetch_at',
      'embedding',
      'last_written_at',
      'duration_seconds',
      'audible_id',
      'librofm_id',
      'comicvine_id',
      'ranobedb_id',
      'lubimyczytac_id',
      'aladin_id',
      'chapters',
      'cover_updated_at',
    ];

    const metadata = await tx.execute(
      sql.raw(
        `SELECT *
        FROM book_metadata
        WHERE book_id IN (${ids}, ${targetBookId})
        ORDER BY updated_at DESC`,
      ),
    );

    let targetMetadata = metadata.rows.find((row) => row.book_id === targetBookId);

    const originalTargetMetadataBookId = targetMetadata?.book_id;

    if (!targetMetadata && metadata.rows.length > 0) {
      targetMetadata = {
        ...metadata.rows[0],
        book_id: targetBookId,
      };
    }

    if (targetMetadata) {
      const sourceMetadata = metadata.rows.filter((row) => row.book_id !== (originalTargetMetadataBookId ?? metadata.rows[0].book_id));

      for (const column of metadataColumns) {
        if (targetMetadata[column] !== null && targetMetadata[column] !== undefined) {
          continue;
        }

        const source = sourceMetadata.find((row) => row[column] !== null && row[column] !== undefined);

        if (source) {
          targetMetadata[column] = source[column];
        }
      }

      const escapeSqlValue = (value: unknown): string => {
        if (value === null || value === undefined) {
          return 'NULL';
        }

        if (value instanceof Date) {
          return `'${value.toISOString().replace(/'/g, "''")}'`;
        }

        if (typeof value === 'number' || typeof value === 'bigint') {
          return String(value);
        }

        if (typeof value === 'boolean') {
          return value ? 'TRUE' : 'FALSE';
        }

        if (typeof value === 'object') {
          return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
        }

        if (typeof value === 'string') {
          return `'${String(value).replace(/'/g, "''")}'`;
        }

        return 'NULL';
      };

      const updates = metadataColumns
        .filter((column) => targetMetadata[column] !== null && targetMetadata[column] !== undefined)
        .map((column) => `${column} = ${escapeSqlValue(targetMetadata[column])}`)
        .join(', ');

      if (originalTargetMetadataBookId === undefined) {
        await tx.execute(
          sql.raw(
            `UPDATE book_metadata
            SET book_id = ${targetBookId}, ${updates}
            WHERE book_id = ${Number(metadata.rows[0].book_id)}`,
          ),
        );
      } else if (updates) {
        await tx.execute(
          sql.raw(
            `UPDATE book_metadata
            SET ${updates}
            WHERE book_id = ${targetBookId}`,
          ),
        );
      }
    }

    await tx.execute(
      sql.raw(
        `DELETE FROM book_metadata
        WHERE book_id IN (${ids})`,
      ),
    );
  }

  //reading session sync courser
  private async mergeReadingSessionCourser(tx: DbTransaction, ids: string, targetBookId: number): Promise<void> {
    await tx.execute(
      sql.raw(
        `DELETE FROM reading_session_sync_cursors
        WHERE ctid IN (
          SELECT ctid
          FROM (
            SELECT
              ctid,
              ROW_NUMBER() OVER (
                PARTITION BY user_id, source, source_device_key
                ORDER BY
                  CASE WHEN book_id = ${targetBookId} THEN 0 ELSE 1 END,
                  book_id,
                  ctid
              ) AS row_number
            FROM reading_session_sync_cursors
            WHERE book_id IN (${ids}, ${targetBookId})
          ) duplicates
          WHERE row_number > 1
        )`,
      ),
    );

    await tx.execute(
      sql.raw(
        `UPDATE reading_session_sync_cursors
        SET book_id = ${targetBookId}
        WHERE book_id IN (${ids})`,
      ),
    );
  }

  //Update Only
  private async mergeUpdateOnly(tx: DbTransaction, ids: string, targetBookId: number): Promise<void> {
    for (const table of ['audiobook_progress', 'annotations', 'bookmarks', 'email_send_log', 'file_write_log']) {
      await tx.execute(
        sql.raw(
          `UPDATE ${table}
          SET book_id = ${targetBookId}
          WHERE book_id IN (${ids})`,
        ),
      );
    }

    await tx.execute(
      sql.raw(
        `UPDATE book_requests
        SET matched_book_id = ${targetBookId}
        WHERE matched_book_id IN (${ids})`,
      ),
    );
  }

  //Delete Source, Keep Target
  private async mergeDeleteSource(tx: DbTransaction, ids: string): Promise<void> {
    for (const table of ['book_duplicate_pairs']) {
      await tx.execute(
        sql.raw(
          `DELETE FROM ${table}
          WHERE book_id_a IN (${ids})
          OR book_id_b IN (${ids})`,
        ),
      );
    }

    for (const table of ['book_metadata_fetch_queue', 'book_duplicate_scan_keys']) {
      await tx.execute(
        sql.raw(
          `DELETE FROM ${table}
          WHERE book_id IN (${ids})`,
        ),
      );
    }

    await tx.execute(
      sql.raw(
        `DELETE FROM book_duplicate_groups
        WHERE root_book_id IN (${ids})`,
      ),
    );
  }

  private async mergeComicMetadata(tx: DbTransaction, ids: string, targetBookId: number): Promise<void> {
    const metadata = await tx.execute(
      sql.raw(
        `SELECT *
        FROM comic_metadata
        WHERE book_id IN (${ids}, ${targetBookId})
        ORDER BY updated_at DESC`,
      ),
    );

    let targetMetadata = metadata.rows.find((row) => row.book_id === targetBookId);

    const originalTargetBookId = targetMetadata?.book_id;

    if (!targetMetadata && metadata.rows.length > 0) {
      targetMetadata = {
        ...metadata.rows[0],
        book_id: targetBookId,
      };
    }

    if (targetMetadata) {
      const sourceMetadata = metadata.rows.filter((row) => row.book_id !== (originalTargetBookId ?? metadata.rows[0].book_id));

      const metadataColumns = [
        'issue_number',
        'volume_name',
        'pencillers',
        'inkers',
        'colorists',
        'letterers',
        'cover_artists',
        'characters',
        'teams',
        'locations',
        'story_arcs',
      ];

      for (const column of metadataColumns) {
        if (targetMetadata[column] !== null && targetMetadata[column] !== undefined) {
          continue;
        }

        const source = sourceMetadata.find((row) => row[column] !== null && row[column] !== undefined);

        if (source) {
          targetMetadata[column] = source[column];
        }
      }

      const escapeSqlValue = (value: unknown): string => {
        if (value === null || value === undefined) {
          return 'NULL';
        }

        if (value instanceof Date) {
          return `'${value.toISOString().replace(/'/g, "''")}'`;
        }

        if (typeof value === 'number' || typeof value === 'bigint') {
          return String(value);
        }

        if (typeof value === 'boolean') {
          return value ? 'TRUE' : 'FALSE';
        }

        if (Array.isArray(value)) {
          return `ARRAY[${value.map((item) => `'${String(item).replace(/'/g, "''")}'`).join(', ')}]`;
        }

        if (typeof value === 'string') {
          return `'${value.replace(/'/g, "''")}'`;
        }

        return 'NULL';
      };

      const updates = metadataColumns
        .filter((column) => targetMetadata[column] !== null && targetMetadata[column] !== undefined)
        .map((column) => `${column} = ${escapeSqlValue(targetMetadata[column])}`)
        .join(', ');

      if (originalTargetBookId === undefined) {
        await tx.execute(
          sql.raw(
            `UPDATE comic_metadata
            SET book_id = ${targetBookId}${updates ? `, ${updates}` : ''}
            WHERE book_id = ${Number(metadata.rows[0].book_id)}`,
          ),
        );
      } else if (updates) {
        await tx.execute(
          sql.raw(
            `UPDATE comic_metadata
            SET ${updates}
            WHERE book_id = ${targetBookId}`,
          ),
        );
      }
    }

    await tx.execute(
      sql.raw(
        `DELETE FROM comic_metadata
        WHERE book_id IN (${ids})`,
      ),
    );
  }
}
