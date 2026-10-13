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
      'audiobook_progress',
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
        `DELETE FROM book_series_memberships
        WHERE ctid IN (
          SELECT ctid
          FROM (
            SELECT
              ctid,
              ROW_NUMBER() OVER (
                PARTITION BY series_id
                ORDER BY
                  CASE WHEN book_id = ${targetBookId} THEN 0 ELSE 1 END,
                  book_id,
                  ctid
              ) AS row_number
            FROM book_series_memberships
            WHERE book_id IN (${ids}, ${targetBookId})
          ) duplicates
          WHERE row_number > 1
        )`,
      ),
    );

    await tx.execute(
      sql.raw(
        `WITH ordered AS (
          SELECT
              ctid,
              ROW_NUMBER() OVER (ORDER BY ctid) - 1 AS new_display_order
          FROM book_series_memberships
          WHERE book_id IN (${ids})
      )
      UPDATE book_series_memberships b
      SET
          book_id = ${targetBookId},
          display_order = o.new_display_order
      FROM ordered o
      WHERE b.ctid = o.ctid;`,
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
        `SELECT id, user_id, book_id, started_on, ended_on, outcome, deleted_at, external_provider, external_id
        FROM reading_attempts
        WHERE book_id IN (${ids}, ${targetBookId})`,
      ),
    );

    const attempts = readingAttempts.rows;

    const attemptSurvivors = new Map<number, number>();
    const deleteIds = new Set<number>();

    // First move every session belonging to a source-book attempt.
    // This must happen even when the attempt itself survives.
    await tx.execute(
      sql.raw(
        `UPDATE reading_sessions
        SET book_id = ${targetBookId}
        WHERE attempt_id IN (
          SELECT id
          FROM reading_attempts
          WHERE book_id IN (${ids})
        )`,
      ),
    );

    // Find conflicts that would violate the unique indexes after moving
    // source attempts to the target book.
    const attemptsByUser = new Map<number, typeof attempts>();

    for (const attempt of attempts) {
      const userAttempts = attemptsByUser.get(Number(attempt.user_id)) ?? [];
      userAttempts.push(attempt);
      attemptsByUser.set(Number(attempt.user_id), userAttempts);
    }

    for (const userAttempts of attemptsByUser.values()) {
      // The active-attempt constraint is on:
      // (user_id, book_id)
      // WHERE outcome IS NULL AND deleted_at IS NULL
      const activeAttempts = userAttempts.filter((attempt) => attempt.outcome === null && attempt.deleted_at === null);

      // Only source + target active attempts can collide here, because
      // there can already only be one active attempt per user/book.
      if (activeAttempts.length > 1) {
        const survivor = activeAttempts.find((attempt) => Number(attempt.book_id) === targetBookId) ?? activeAttempts[0];

        for (const attempt of activeAttempts) {
          if (Number(attempt.id) !== Number(survivor.id)) {
            deleteIds.add(Number(attempt.id));
            attemptSurvivors.set(Number(attempt.id), Number(survivor.id));
          }
        }
      }

      // The external constraint is on:
      // (user_id, external_provider, external_id)
      // whenever both external fields are non-null.
      const externalAttempts = new Map<string, typeof userAttempts>();

      for (const attempt of userAttempts) {
        const externalProvider = typeof attempt.external_provider === 'string' ? attempt.external_provider : null;
        const externalId = typeof attempt.external_id === 'string' ? attempt.external_id : null;

        if (externalProvider === null || externalId === null) {
          continue;
        }

        const key = `${externalProvider}\0${externalId}`;
        const matching = externalAttempts.get(key) ?? [];
        matching.push(attempt);
        externalAttempts.set(key, matching);
      }

      for (const matching of externalAttempts.values()) {
        if (matching.length <= 1) {
          continue;
        }

        const survivor = matching.find((attempt) => Number(attempt.book_id) === targetBookId) ?? matching[0];

        for (const attempt of matching) {
          if (Number(attempt.id) !== Number(survivor.id)) {
            deleteIds.add(Number(attempt.id));
            attemptSurvivors.set(Number(attempt.id), Number(survivor.id));
          }
        }
      }
    }

    // Reattach sessions from attempts that are being merged.
    for (const [deleteId, survivorId] of attemptSurvivors) {
      await tx.execute(
        sql.raw(
          `UPDATE reading_sessions
          SET attempt_id = ${survivorId}
          WHERE attempt_id = ${deleteId}`,
        ),
      );
    }

    // Delete only attempts that actually conflicted.
    if (deleteIds.size > 0) {
      await tx.execute(
        sql.raw(
          `DELETE FROM reading_attempts
          WHERE id IN (${Array.from(deleteIds).join(',')})`,
        ),
      );
    }

    // Finally move all remaining source attempts to the target book.
    await tx.execute(
      sql.raw(
        `UPDATE reading_attempts
        SET book_id = ${targetBookId}
        WHERE book_id IN (${ids})
          AND id NOT IN (${deleteIds.size > 0 ? Array.from(deleteIds).join(',') : '0'})`,
      ),
    );
  }

  private async mergeMetadata(tx: DbTransaction, ids: string, targetBookId: number): Promise<void> {
    const metadataColumns = [
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
    for (const table of ['annotations', 'bookmarks', 'email_send_log', 'file_write_log']) {
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

      const isMissingMetadataValue = (value: unknown): boolean =>
        value === null || value === undefined || (Array.isArray(value) && value.length === 0);

      for (const column of metadataColumns) {
        if (!isMissingMetadataValue(targetMetadata[column])) {
          continue;
        }

        const source = sourceMetadata.find((row) => !isMissingMetadataValue(row[column]));

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
          return `ARRAY[${value.map((item) => `'${String(item).replace(/'/g, "''")}'`).join(', ')}]::text[]`;
        }

        if (typeof value === 'string') {
          return `'${value.replace(/'/g, "''")}'`;
        }

        return 'NULL';
      };

      const updates = metadataColumns
        .filter((column) => !isMissingMetadataValue(targetMetadata[column]))
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
