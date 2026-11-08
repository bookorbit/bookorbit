import { Injectable } from '@nestjs/common';
import { AUDIO_FORMAT_LIST, BOOK_LINK_MAX_MEMBERS } from '@bookorbit/types';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { refreshPrimaryAuthorSortNamesForBooks } from '../../db/book-author-sort-key';
import { bumpKoreaderHashRevisions, deleteBookFilesWithHashInvalidation, deleteBooksWithHashInvalidation } from '../../db/book-file-hash-history';
import * as schema from '../../db/schema';
import type { BookMergeSnapshot } from '../../db/schema';
import { selectMovedPrimary } from '../../common/utils/primary-file-selection.utils';
import type { BookFacts } from './field-picks';
import type { AttemptUpdate, MergeAttempt, MergeStatusRow } from './reading-history-merge';

type Db = NodePgDatabase<typeof schema>;
export type ConsolidationTx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface LockedBookRow {
  id: number;
  libraryId: number;
  libraryFolderId: number;
  folderPath: string;
  status: string;
  addedAt: Date | null;
  primaryFileId: number | null;
}

export interface FileRowUpdate {
  fileId: number;
  absolutePath: string;
  relPath: string;
  sizeBytes?: number | null;
  mtime?: Date | null;
  ino?: bigint | null;
}

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

/** Every statement of a book consolidation. Each takes the caller's transaction. */
@Injectable()
export class BookConsolidationRepository {
  async lockBooks(tx: ConsolidationTx, bookIds: number[]): Promise<LockedBookRow[]> {
    return tx
      .select({
        id: schema.books.id,
        libraryId: schema.books.libraryId,
        libraryFolderId: schema.books.libraryFolderId,
        folderPath: schema.books.folderPath,
        status: schema.books.status,
        addedAt: schema.books.addedAt,
        primaryFileId: schema.books.primaryFileId,
      })
      .from(schema.books)
      .where(inArray(schema.books.id, bookIds))
      .orderBy(asc(schema.books.id))
      .for('update');
  }

  async loadFacts(tx: ConsolidationTx, bookId: number): Promise<BookFacts> {
    const [metadata] = await tx.select().from(schema.bookMetadata).where(eq(schema.bookMetadata.bookId, bookId)).limit(1);
    const authorRows = await tx
      .select({ name: schema.authors.name })
      .from(schema.bookAuthors)
      .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
      .where(eq(schema.bookAuthors.bookId, bookId))
      .orderBy(asc(schema.bookAuthors.displayOrder));
    const narratorRows = await tx
      .select({ name: schema.narrators.name })
      .from(schema.bookNarrators)
      .innerJoin(schema.narrators, eq(schema.narrators.id, schema.bookNarrators.narratorId))
      .where(eq(schema.bookNarrators.bookId, bookId))
      .orderBy(asc(schema.bookNarrators.displayOrder));
    const seriesRows = await tx
      .select({
        seriesId: schema.bookSeriesMemberships.seriesId,
        name: schema.bookSeries.name,
        seriesIndex: schema.bookSeriesMemberships.seriesIndex,
        displayOrder: schema.bookSeriesMemberships.displayOrder,
      })
      .from(schema.bookSeriesMemberships)
      .innerJoin(schema.bookSeries, eq(schema.bookSeries.id, schema.bookSeriesMemberships.seriesId))
      .where(eq(schema.bookSeriesMemberships.bookId, bookId))
      .orderBy(asc(schema.bookSeriesMemberships.displayOrder));
    const [audio] = rowsOf<{ has_audio: boolean }>(
      await tx.execute(sql`
        select exists (
          select 1 from book_files
          where book_id = ${bookId} and role = 'content' and lower(format) in ${[...AUDIO_FORMAT_LIST]}
        ) as has_audio
      `),
    );
    return {
      bookId,
      metadata: (metadata as Record<string, unknown> | undefined) ?? null,
      lockedFields: new Set((metadata?.lockedFields as string[] | null | undefined) ?? []),
      authors: authorRows.map((row) => row.name),
      narrators: narratorRows.map((row) => row.name),
      series: seriesRows.map((row) => ({ ...row, seriesIndex: row.seriesIndex === null ? null : Number(row.seriesIndex) })),
      hasAudio: audio?.has_audio === true,
    };
  }

  async readSnapshot(tx: ConsolidationTx, book: LockedBookRow, facts: BookFacts): Promise<BookMergeSnapshot> {
    const [genreRows, tagRows, providerRows, coverRows, fileRows] = await Promise.all([
      tx.select({ id: schema.bookGenres.genreId }).from(schema.bookGenres).where(eq(schema.bookGenres.bookId, book.id)),
      tx.select({ id: schema.bookTags.tagId }).from(schema.bookTags).where(eq(schema.bookTags.bookId, book.id)),
      tx
        .select({ provider: schema.bookProviderIds.provider, externalId: schema.bookProviderIds.externalId })
        .from(schema.bookProviderIds)
        .where(eq(schema.bookProviderIds.bookId, book.id)),
      tx
        .select({ medium: schema.bookCovers.medium, source: schema.bookCovers.source })
        .from(schema.bookCovers)
        .where(eq(schema.bookCovers.bookId, book.id)),
      tx
        .select({ fileId: schema.bookFiles.id, relPath: schema.bookFiles.relPath, role: schema.bookFiles.role, format: schema.bookFiles.format })
        .from(schema.bookFiles)
        .where(eq(schema.bookFiles.bookId, book.id)),
    ]);
    const metadata = facts.metadata ? { ...facts.metadata } : null;
    if (metadata) delete metadata.embedding;
    return {
      title: (facts.metadata?.title as string | null | undefined) ?? null,
      folderPath: book.folderPath,
      libraryFolderId: book.libraryFolderId,
      addedAt: book.addedAt ? book.addedAt.toISOString() : null,
      metadata,
      lockedFields: [...facts.lockedFields],
      authors: facts.authors,
      narrators: facts.narrators,
      series: facts.series.map(({ seriesId, seriesIndex, displayOrder }) => ({ seriesId, seriesIndex, displayOrder })),
      genreIds: genreRows.map((row) => row.id),
      tagIds: tagRows.map((row) => row.id),
      providerIds: Object.fromEntries(providerRows.map((row) => [row.provider, row.externalId])),
      coverSlots: coverRows.map((row) => ({ medium: row.medium, source: row.source, lockedAt: null })),
      files: fileRows.map((row) => ({ fileId: row.fileId, relPath: row.relPath, role: row.role, format: row.format })),
    };
  }

  // ── Files ───────────────────────────────────────────────────────────────────────────────────

  /** The composite key cascades this to every file row of the book; their paths follow in the next step. */
  async moveBookToRoot(tx: ConsolidationTx, bookId: number, libraryFolderId: number): Promise<void> {
    await tx.update(schema.books).set({ libraryFolderId, updatedAt: new Date() }).where(eq(schema.books.id, bookId));
  }

  async updateFileRows(tx: ConsolidationTx, bookId: number, libraryFolderId: number, updates: FileRowUpdate[]): Promise<void> {
    const now = new Date();
    for (const update of updates) {
      await tx
        .update(schema.bookFiles)
        .set({
          bookId,
          libraryFolderId,
          absolutePath: update.absolutePath,
          relPath: update.relPath,
          ...(update.sizeBytes !== undefined ? { sizeBytes: update.sizeBytes } : {}),
          ...(update.mtime !== undefined ? { mtime: update.mtime } : {}),
          ...(update.ino !== undefined && update.ino !== null ? { ino: update.ino } : {}),
          updatedAt: now,
        })
        .where(eq(schema.bookFiles.id, update.fileId));
    }
  }

  /** Re-parents the source's remaining rows (missing files of a data-only merge) without moving them. */
  async reparentRemainingFiles(tx: ConsolidationTx, sourceBookId: number, targetBookId: number, libraryFolderId: number): Promise<void> {
    await tx
      .update(schema.bookFiles)
      .set({ bookId: targetBookId, libraryFolderId, updatedAt: new Date() })
      .where(eq(schema.bookFiles.bookId, sourceBookId));
  }

  /** Sidecar rows (covers, metadata files) that stay behind or were hidden. They carry no reader state. */
  async deleteSidecarRows(tx: ConsolidationTx, fileIds: number[]): Promise<void> {
    if (fileIds.length === 0) return;
    await tx.delete(schema.bookFiles).where(and(inArray(schema.bookFiles.id, fileIds), inArray(schema.bookFiles.role, ['cover', 'metadata'])));
  }

  // ── Book-level ──────────────────────────────────────────────────────────────────────────────

  async writeMetadata(tx: ConsolidationTx, targetBookId: number, values: Record<string, unknown>, lockedFields: string[] | null): Promise<void> {
    const set = { ...values, ...(lockedFields ? { lockedFields } : {}), embedding: null, updatedAt: new Date() };
    const updated = await tx
      .update(schema.bookMetadata)
      .set(set)
      .where(eq(schema.bookMetadata.bookId, targetBookId))
      .returning({ id: schema.bookMetadata.bookId });
    if (updated.length === 0) {
      await tx.insert(schema.bookMetadata).values({ bookId: targetBookId, ...(set as object) } as typeof schema.bookMetadata.$inferInsert);
    }
  }

  async replaceAuthors(tx: ConsolidationTx, targetBookId: number, sourceBookId: number): Promise<void> {
    await tx.delete(schema.bookAuthors).where(eq(schema.bookAuthors.bookId, targetBookId));
    await tx.execute(sql`
      insert into book_authors (book_id, author_id, display_order)
      select ${targetBookId}::int, author_id, display_order from book_authors where book_id = ${sourceBookId}
    `);
  }

  async replaceNarrators(tx: ConsolidationTx, targetBookId: number, sourceBookId: number): Promise<void> {
    await tx.delete(schema.bookNarrators).where(eq(schema.bookNarrators.bookId, targetBookId));
    await tx.execute(sql`
      insert into book_narrators (book_id, narrator_id, display_order)
      select ${targetBookId}::int, narrator_id, display_order from book_narrators where book_id = ${sourceBookId}
    `);
  }

  async replaceSeries(tx: ConsolidationTx, targetBookId: number, sourceBookId: number): Promise<void> {
    await tx.delete(schema.bookSeriesMemberships).where(eq(schema.bookSeriesMemberships.bookId, targetBookId));
    await tx.execute(sql`
      insert into book_series_memberships (book_id, series_id, series_index, display_order, created_at, updated_at)
      select ${targetBookId}::int, series_id, series_index, display_order, created_at, now()
      from book_series_memberships where book_id = ${sourceBookId}
    `);
  }

  async uniteGenres(tx: ConsolidationTx, targetBookId: number, sourceBookId: number, excludeGenreIds: number[]): Promise<void> {
    await tx.execute(sql`
      insert into book_genres (book_id, genre_id)
      select ${targetBookId}::int, genre_id from book_genres
      where book_id = ${sourceBookId} ${excludeGenreIds.length > 0 ? sql`and genre_id not in ${excludeGenreIds}` : sql``}
      on conflict do nothing
    `);
  }

  async uniteTags(tx: ConsolidationTx, targetBookId: number, sourceBookId: number, excludeTagIds: number[]): Promise<void> {
    await tx.execute(sql`
      insert into book_tags (book_id, tag_id)
      select ${targetBookId}::int, tag_id from book_tags
      where book_id = ${sourceBookId} ${excludeTagIds.length > 0 ? sql`and tag_id not in ${excludeTagIds}` : sql``}
      on conflict do nothing
    `);
  }

  async fillBookLevelRows(
    tx: ConsolidationTx,
    targetBookId: number,
    sourceBookId: number,
    options: { communityRatingLocked: boolean },
  ): Promise<void> {
    await tx.execute(sql`
      insert into book_custom_metadata_values (book_id, field_id, value_text, value_number, value_date, value_boolean, updated_at)
      select ${targetBookId}::int, field_id, value_text, value_number, value_date, value_boolean, now()
      from book_custom_metadata_values where book_id = ${sourceBookId}
      on conflict do nothing
    `);
    await tx.execute(sql`
      insert into book_provider_ids (book_id, provider, external_id, source_url, updated_at)
      select ${targetBookId}::int, provider, external_id, source_url, now() from book_provider_ids where book_id = ${sourceBookId}
      on conflict do nothing
    `);
    if (!options.communityRatingLocked) {
      await tx.execute(sql`
        insert into book_community_ratings (book_id, provider, rating, rating_count, updated_at)
        select ${targetBookId}::int, provider, rating, rating_count, now() from book_community_ratings where book_id = ${sourceBookId}
        on conflict do nothing
      `);
    }
    const [targetComic] = await tx
      .select({ id: schema.comicMetadata.id })
      .from(schema.comicMetadata)
      .where(eq(schema.comicMetadata.bookId, targetBookId))
      .limit(1);
    if (!targetComic) {
      await tx.update(schema.comicMetadata).set({ bookId: targetBookId, updatedAt: new Date() }).where(eq(schema.comicMetadata.bookId, sourceBookId));
    } else {
      await tx.execute(sql`
        update comic_metadata k set
          issue_number = coalesce(k.issue_number, s.issue_number),
          volume_name = coalesce(k.volume_name, s.volume_name),
          pencillers = coalesce(k.pencillers, s.pencillers),
          inkers = coalesce(k.inkers, s.inkers),
          colorists = coalesce(k.colorists, s.colorists),
          letterers = coalesce(k.letterers, s.letterers),
          cover_artists = coalesce(k.cover_artists, s.cover_artists),
          characters = coalesce(k.characters, s.characters),
          teams = coalesce(k.teams, s.teams),
          locations = coalesce(k.locations, s.locations),
          story_arcs = coalesce(k.story_arcs, s.story_arcs),
          updated_at = now()
        from comic_metadata s
        where k.book_id = ${targetBookId} and s.book_id = ${sourceBookId}
      `);
    }
  }

  /** Chapter history and manifest revisions of the audio that moved. Released iOS sends the source's revision. */
  async adoptAudioHistory(tx: ConsolidationTx, targetBookId: number, sourceBookId: number): Promise<void> {
    await tx.update(schema.bookChapterVersions).set({ bookId: targetBookId }).where(eq(schema.bookChapterVersions.bookId, sourceBookId));
    await tx.execute(sql`
      insert into audiobook_manifest_revisions (book_id, revision, positions_key, created_at)
      select ${targetBookId}::int, revision, positions_key, created_at from audiobook_manifest_revisions where book_id = ${sourceBookId}
      on conflict do nothing
    `);
  }

  // ── Reading history ─────────────────────────────────────────────────────────────────────────

  /** Users with an attempt or a status row on the source, in pages of `limit` after `afterUserId`. */
  async sourceReaderPage(tx: ConsolidationTx, sourceBookId: number, afterUserId: number, limit: number): Promise<number[]> {
    const rows = rowsOf<{ user_id: number }>(
      await tx.execute(sql`
        select user_id from (
          select user_id from reading_attempts where book_id = ${sourceBookId}
          union
          select user_id from user_book_status where book_id = ${sourceBookId}
        ) readers
        where user_id > ${afterUserId}
        order by user_id
        limit ${limit}
      `),
    );
    return rows.map((row) => Number(row.user_id));
  }

  async loadAttempts(
    tx: ConsolidationTx,
    userIds: number[],
    bookIds: [number, number],
  ): Promise<Array<MergeAttempt & { userId: number; bookId: number }>> {
    if (userIds.length === 0) return [];
    const [targetBookId] = bookIds;
    const rows = await tx
      .select({
        id: schema.readingAttempts.id,
        userId: schema.readingAttempts.userId,
        bookId: schema.readingAttempts.bookId,
        startedOn: schema.readingAttempts.startedOn,
        endedOn: schema.readingAttempts.endedOn,
        outcome: schema.readingAttempts.outcome,
        externalProvider: schema.readingAttempts.externalProvider,
        externalId: schema.readingAttempts.externalId,
        rating: schema.readingAttempts.rating,
        deletedAt: schema.readingAttempts.deletedAt,
      })
      .from(schema.readingAttempts)
      .where(and(inArray(schema.readingAttempts.userId, userIds), inArray(schema.readingAttempts.bookId, bookIds)))
      .for('update');
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      bookId: row.bookId!,
      side: row.bookId === targetBookId ? 'target' : 'source',
      startedOn: row.startedOn,
      endedOn: row.endedOn,
      outcome: row.outcome,
      externalProvider: row.externalProvider,
      externalId: row.externalId,
      rating: row.rating,
      deleted: row.deletedAt !== null,
    }));
  }

  async loadStatuses(
    tx: ConsolidationTx,
    userIds: number[],
    bookIds: [number, number],
  ): Promise<Array<MergeStatusRow & { userId: number; bookId: number }>> {
    if (userIds.length === 0) return [];
    return tx
      .select({
        userId: schema.userBookStatus.userId,
        bookId: schema.userBookStatus.bookId,
        status: schema.userBookStatus.status,
        source: schema.userBookStatus.source,
        startedAt: schema.userBookStatus.startedAt,
        finishedAt: schema.userBookStatus.finishedAt,
      })
      .from(schema.userBookStatus)
      .where(and(inArray(schema.userBookStatus.userId, userIds), inArray(schema.userBookStatus.bookId, bookIds)))
      .for('update') as Promise<Array<MergeStatusRow & { userId: number; bookId: number }>>;
  }

  async clearAttemptExternalIds(tx: ConsolidationTx, attemptIds: number[]): Promise<void> {
    if (attemptIds.length === 0) return;
    await tx
      .update(schema.readingAttempts)
      .set({ externalProvider: null, externalId: null, updatedAt: new Date() })
      .where(inArray(schema.readingAttempts.id, attemptIds));
  }

  async updateAttempt(tx: ConsolidationTx, update: AttemptUpdate): Promise<void> {
    const { id, ...change } = update;
    await tx
      .update(schema.readingAttempts)
      .set({ ...(change as Partial<typeof schema.readingAttempts.$inferInsert>), updatedAt: new Date() })
      .where(eq(schema.readingAttempts.id, id));
  }

  async softDeleteAttempts(tx: ConsolidationTx, attemptIds: number[]): Promise<void> {
    if (attemptIds.length === 0) return;
    const now = new Date();
    await tx.update(schema.readingAttempts).set({ deletedAt: now, updatedAt: now }).where(inArray(schema.readingAttempts.id, attemptIds));
  }

  async moveSessionsBetweenAttempts(tx: ConsolidationTx, fromAttemptId: number, toAttemptId: number): Promise<void> {
    await tx.update(schema.readingSessions).set({ attemptId: toAttemptId }).where(eq(schema.readingSessions.attemptId, fromAttemptId));
  }

  async moveAttempts(tx: ConsolidationTx, sourceBookId: number, targetBookId: number): Promise<void> {
    await tx
      .update(schema.readingAttempts)
      .set({ bookId: targetBookId, updatedAt: new Date() })
      .where(eq(schema.readingAttempts.bookId, sourceBookId));
  }

  async writeStatus(tx: ConsolidationTx, userId: number, targetBookId: number, status: MergeStatusRow): Promise<void> {
    const now = new Date();
    await tx
      .insert(schema.userBookStatus)
      .values({ userId, bookId: targetBookId, ...status, updatedAt: now })
      .onConflictDoUpdate({ target: [schema.userBookStatus.userId, schema.userBookStatus.bookId], set: { ...status, updatedAt: now } });
  }

  // ── Other per-user rows ─────────────────────────────────────────────────────────────────────

  async moveReaderRows(tx: ConsolidationTx, targetBookId: number, sourceBookId: number): Promise<void> {
    const k = targetBookId;
    const s = sourceBookId;

    await tx.execute(sql`update reading_sessions set book_id = ${k} where book_id = ${s}`);
    await tx.execute(sql`
      update reading_session_sync_cursors c set book_id = ${k}
      where c.book_id = ${s} and not exists (
        select 1 from reading_session_sync_cursors t
        where t.book_id = ${k} and t.user_id = c.user_id and t.source = c.source and t.source_device_key = c.source_device_key
      )
    `);

    // Kobo pulls fail with a rendition error on a re-pointed annotation it still tracks.
    await tx.execute(sql`
      delete from annotation_sync_state
      where source = 'kobo' and annotation_id in (select id from annotations where book_id = ${s})
    `);
    await tx.execute(sql`update annotations set book_id = ${k}, updated_at = now() where book_id = ${s}`);

    // Three unique keys on bookmarks; a live row beats a tombstone, then the newer edit wins.
    await tx.execute(sql`
      with pairs as (
        select s.id as s_id, t.id as t_id,
          case
            when (s.deleted_at is null) <> (t.deleted_at is null) then (case when s.deleted_at is null then t.id else s.id end)
            when s.updated_at > t.updated_at then t.id
            else s.id
          end as loser
        from bookmarks s
        join bookmarks t on t.book_id = ${k} and t.user_id = s.user_id and (
          t.client_id = s.client_id
          or (s.cfi is not null and t.cfi = s.cfi)
          or (s.position_seconds is not null and s.cfi is null and t.cfi is null and s.deleted_at is null and t.deleted_at is null
              and t.position_seconds = s.position_seconds)
        )
        where s.book_id = ${s}
      )
      delete from bookmarks where id in (select loser from pairs)
    `);
    await tx.execute(sql`update bookmarks set book_id = ${k}, updated_at = now() where book_id = ${s}`);

    await tx.execute(sql`update book_journal_entries set book_id = ${k} where book_id = ${s}`);

    // Client-generated ids, so one correction can sit on both books; the newer client edit wins.
    // Revisions are re-drawn after the commit, under the writers' lock (BookMergeEffectsService).
    await tx.execute(sql`
      delete from story_edits s using story_edits t
      where s.book_id = ${s} and t.book_id = ${k} and t.user_id = s.user_id and t.id = s.id
        and t.client_updated_at >= s.client_updated_at
    `);
    await tx.execute(sql`
      delete from story_edits t using story_edits s
      where t.book_id = ${k} and s.book_id = ${s} and s.user_id = t.user_id and s.id = t.id
    `);
    await tx.execute(sql`update story_edits set book_id = ${k} where book_id = ${s}`);

    await tx.execute(sql`
      update tts_book_preferences p set book_id = ${k}, updated_at = now()
      where p.book_id = ${s} and not exists (select 1 from tts_book_preferences t where t.book_id = ${k} and t.user_id = p.user_id)
    `);
    await tx.execute(sql`
      update user_book_read_aloud_sync_settings p set book_id = ${k}, updated_at = now()
      where p.book_id = ${s} and not exists (select 1 from user_book_read_aloud_sync_settings t where t.book_id = ${k} and t.user_id = p.user_id)
    `);

    // Every collection holding the source, whoever owns it.
    await tx.execute(sql`
      update collection_books c set book_id = ${k}
      where c.book_id = ${s} and not exists (select 1 from collection_books t where t.book_id = ${k} and t.collection_id = c.collection_id)
    `);
  }

  /** Both non-empty and different: joined when it fits the 10,000-character limit, else the source's goes to the journal. */
  async mergeNotes(tx: ConsolidationTx, targetBookId: number, sourceBookId: number, maxLength: number): Promise<void> {
    await tx.execute(sql`
      update user_book_notes n set book_id = ${targetBookId}
      where n.book_id = ${sourceBookId} and not exists (select 1 from user_book_notes t where t.book_id = ${targetBookId} and t.user_id = n.user_id)
    `);
    await tx.execute(sql`
      update user_book_notes t set note = case when coalesce(trim(t.note), '') = '' then s.note else t.note || E'\\n\\n' || s.note end, updated_at = now()
      from user_book_notes s
      where t.book_id = ${targetBookId} and s.book_id = ${sourceBookId} and s.user_id = t.user_id
        and coalesce(trim(s.note), '') <> '' and s.note is distinct from t.note
        and char_length(coalesce(t.note, '')) + 2 + char_length(s.note) <= ${maxLength}
    `);
    await tx.execute(sql`
      insert into book_journal_entries (client_id, user_id, book_id, body, created_at, updated_at)
      select gen_random_uuid(), s.user_id, ${targetBookId}::int, s.note, now(), now()
      from user_book_notes s
      join user_book_notes t on t.book_id = ${targetBookId} and t.user_id = s.user_id
      where s.book_id = ${sourceBookId}
        and coalesce(trim(s.note), '') <> '' and s.note is distinct from t.note
        and char_length(coalesce(t.note, '')) + 2 + char_length(s.note) > ${maxLength}
    `);
  }

  /** The rating of the latest completed read when there is one, else the kept book's, else the source's. Returns users whose rating changed. */
  async reconcileRatings(tx: ConsolidationTx, targetBookId: number, sourceBookId: number): Promise<number[]> {
    const before = rowsOf<{ user_id: number; rating: number | null }>(
      await tx.execute(sql`select user_id, rating from user_book_ratings where book_id = ${targetBookId}`),
    );
    await tx.execute(sql`
      update user_book_ratings r set book_id = ${targetBookId}, updated_at = now()
      where r.book_id = ${sourceBookId} and not exists (select 1 from user_book_ratings t where t.book_id = ${targetBookId} and t.user_id = r.user_id)
    `);
    await tx.execute(sql`
      with latest as (
        select distinct on (user_id) user_id, rating
        from reading_attempts
        where book_id = ${targetBookId} and outcome = 'completed' and deleted_at is null
        order by user_id, coalesce(ended_on, started_on) desc nulls last, id desc
      )
      update user_book_ratings r set rating = latest.rating, updated_at = now()
      from latest
      where r.book_id = ${targetBookId} and r.user_id = latest.user_id and latest.rating is not null and r.rating is distinct from latest.rating
    `);
    const after = rowsOf<{ user_id: number; rating: number | null }>(
      await tx.execute(sql`select user_id, rating from user_book_ratings where book_id = ${targetBookId}`),
    );
    const previous = new Map(before.map((row) => [Number(row.user_id), row.rating]));
    return after.filter((row) => previous.get(Number(row.user_id)) !== row.rating).map((row) => Number(row.user_id));
  }

  async reconcileAudiobookProgress(tx: ConsolidationTx, targetBookId: number, sourceBookId: number, sourceOwnsAudio: boolean): Promise<void> {
    if (!sourceOwnsAudio) return;
    await tx.execute(sql`
      update audiobook_progress t set
        percentage = s.percentage, current_file_id = s.current_file_id, position_seconds = s.position_seconds,
        captured_at = s.captured_at, revision = greatest(t.revision, s.revision) + 1,
        operation_id = null, manifest_revision = null, updated_at = now()
      from audiobook_progress s
      where t.book_id = ${targetBookId} and s.book_id = ${sourceBookId} and s.user_id = t.user_id and s.captured_at > t.captured_at
    `);
    await tx.execute(sql`
      update audiobook_progress p set book_id = ${targetBookId}, updated_at = now()
      where p.book_id = ${sourceBookId} and not exists (select 1 from audiobook_progress t where t.book_id = ${targetBookId} and t.user_id = p.user_id)
    `);
  }

  // ── Devices and services ────────────────────────────────────────────────────────────────────

  /** Moves the source's Kobo entitlement where the kept book has none, and the device rows that follow it. Returns those users. */
  async moveKoboEntitlements(tx: ConsolidationTx, targetBookId: number, sourceBookId: number): Promise<number[]> {
    const moved = rowsOf<{ user_id: number }>(
      await tx.execute(sql`
        update kobo_book_entitlements e set book_id = ${targetBookId}, updated_at = now()
        where e.book_id = ${sourceBookId} and not exists (select 1 from kobo_book_entitlements t where t.book_id = ${targetBookId} and t.user_id = e.user_id)
        returning user_id
      `),
    ).map((row) => Number(row.user_id));
    if (moved.length === 0) return moved;

    await tx.execute(sql`
      update kobo_reading_states r set book_id = ${targetBookId}, updated_at = now()
      where r.book_id = ${sourceBookId} and r.user_id in ${moved}
        and not exists (select 1 from kobo_reading_states t where t.book_id = ${targetBookId} and t.user_id = r.user_id)
    `);
    await tx.execute(sql`
      update kobo_device_reading_states r set book_id = ${targetBookId}, updated_at = now()
      where r.book_id = ${sourceBookId} and r.user_id in ${moved}
        and not exists (select 1 from kobo_device_reading_states t where t.book_id = ${targetBookId} and t.user_id = r.user_id and t.device_id = r.device_id)
    `);
    await tx.execute(sql`
      update kobo_known_positions r set book_id = ${targetBookId}, updated_at = now()
      where r.book_id = ${sourceBookId} and r.user_id in ${moved}
        and not exists (select 1 from kobo_known_positions t where t.book_id = ${targetBookId} and t.user_id = r.user_id and t.device_id = r.device_id)
    `);
    await tx.execute(sql`
      update kobo_bookmark_links set book_id = ${targetBookId}, updated_at = now()
      where book_id = ${sourceBookId} and user_id in ${moved}
    `);
    await tx.execute(sql`
      update kobo_device_snapshot_books r set book_id = ${targetBookId}
      where r.book_id = ${sourceBookId}
        and r.snapshot_id in (select id from kobo_device_library_snapshots where user_id in ${moved})
        and not exists (select 1 from kobo_device_snapshot_books t where t.book_id = ${targetBookId} and t.snapshot_id = r.snapshot_id)
    `);
    await tx.execute(sql`
      update kobo_snapshot_books r set book_id = ${targetBookId}
      where r.book_id = ${sourceBookId}
        and r.snapshot_id in (select id from kobo_library_snapshots where user_id in ${moved})
        and not exists (select 1 from kobo_snapshot_books t where t.book_id = ${targetBookId} and t.snapshot_id = r.snapshot_id)
    `);
    return moved;
  }

  /** Whether any reader has data on the book: the paths that replace a duplicate fold it in only then. */
  async carriesUserData(tx: ConsolidationTx, bookId: number): Promise<boolean> {
    const result = await tx.execute(sql`
      select exists (select 1 from user_book_status where book_id = ${bookId})
          or exists (select 1 from reading_attempts where book_id = ${bookId})
          or exists (select 1 from reading_sessions where book_id = ${bookId})
          or exists (select 1 from annotations where book_id = ${bookId})
          or exists (select 1 from bookmarks where book_id = ${bookId})
          or exists (select 1 from story_edits where book_id = ${bookId})
          or exists (select 1 from book_journal_entries where book_id = ${bookId})
          or exists (select 1 from user_book_notes where book_id = ${bookId})
          or exists (select 1 from user_book_ratings where book_id = ${bookId})
          or exists (select 1 from collection_books where book_id = ${bookId})
          or exists (select 1 from audiobook_progress where book_id = ${bookId})
          or exists (select 1 from kobo_book_entitlements where book_id = ${bookId})
          or exists (select 1 from hardcover_book_state where book_id = ${bookId})
          or exists (select 1 from storygraph_book_state where book_id = ${bookId})
          or exists (
            select 1 from reading_progress rp join book_files bf on bf.id = rp.book_file_id where bf.book_id = ${bookId}
          ) as carries
    `);
    return Boolean((result as unknown as { rows: Array<{ carries: boolean }> }).rows[0]?.carries);
  }

  /** Puts a book in another root, ahead of a consolidation that needs both books in one library. */
  async moveBookToLibrary(tx: ConsolidationTx, bookId: number, libraryId: number, libraryFolderId: number): Promise<void> {
    await tx.update(schema.books).set({ libraryId, libraryFolderId, updatedAt: new Date() }).where(eq(schema.books.id, bookId));
  }

  async findFilesAtPaths(tx: ConsolidationTx, bookId: number, absolutePaths: string[]): Promise<Array<{ id: number; absolutePath: string }>> {
    if (absolutePaths.length === 0) return [];
    return tx
      .select({ id: schema.bookFiles.id, absolutePath: schema.bookFiles.absolutePath })
      .from(schema.bookFiles)
      .where(and(eq(schema.bookFiles.bookId, bookId), inArray(schema.bookFiles.absolutePath, absolutePaths)));
  }

  async hasKoboEntitlements(tx: ConsolidationTx, bookId: number): Promise<boolean> {
    const [row] = await tx
      .select({ id: schema.koboBookEntitlements.id })
      .from(schema.koboBookEntitlements)
      .where(eq(schema.koboBookEntitlements.bookId, bookId))
      .limit(1);
    return Boolean(row);
  }

  /**
   * Where the kept book and the source are linked to different Hardcover books, the source's
   * attempts give up their Hardcover read ids, the way relinking a book does. Runs while the
   * attempts are still on the source, before the history merge could copy one onto the kept book.
   */
  async releaseConflictingRemoteReadIds(tx: ConsolidationTx, targetBookId: number, sourceBookId: number): Promise<void> {
    await tx.execute(sql`
      update reading_attempts a set external_provider = null, external_id = null, updated_at = now()
      from hardcover_book_state s
      join hardcover_book_state t on t.book_id = ${targetBookId} and t.user_id = s.user_id
      where s.book_id = ${sourceBookId} and a.user_id = s.user_id and a.book_id = ${sourceBookId}
        and a.external_provider = 'hardcover'
        and s.hardcover_book_id is not null and t.hardcover_book_id is not null
        and s.hardcover_book_id <> t.hardcover_book_id
    `);
  }

  /** Hardcover and StoryGraph state: only the source has one, it moves; both, the kept book's stays and is resynced. */
  async reconcileReadingServices(tx: ConsolidationTx, targetBookId: number, sourceBookId: number): Promise<void> {
    for (const table of [sql`hardcover_book_state`, sql`storygraph_book_state`]) {
      await tx.execute(sql`
        update ${table} t set last_synced_at = null, updated_at = now()
        where t.book_id = ${targetBookId} and exists (select 1 from ${table} s where s.book_id = ${sourceBookId} and s.user_id = t.user_id)
      `);
      await tx.execute(sql`
        update ${table} s set book_id = ${targetBookId}, updated_at = now()
        where s.book_id = ${sourceBookId} and not exists (select 1 from ${table} t where t.book_id = ${targetBookId} and t.user_id = s.user_id)
      `);
    }
  }

  // ── System rows ─────────────────────────────────────────────────────────────────────────────

  async moveSystemRows(tx: ConsolidationTx, targetBookId: number, sourceBookId: number, hiddenRequestIds: number[]): Promise<void> {
    const k = targetBookId;
    const s = sourceBookId;
    await tx.execute(sql`update file_write_log set book_id = ${k} where book_id = ${s}`);
    await tx.execute(sql`update email_send_log set book_id = ${k} where book_id = ${s}`);
    const keep = hiddenRequestIds.length > 0 ? sql`and id not in ${hiddenRequestIds}` : sql``;
    await tx.execute(sql`update book_requests set matched_book_id = ${k}, updated_at = now() where matched_book_id = ${s} ${keep}`);
    await tx.execute(sql`update book_requests set target_book_id = ${k}, updated_at = now() where target_book_id = ${s} ${keep}`);
    await tx.execute(sql`update upload_sessions set target_book_id = ${k}, updated_at = now() where target_book_id = ${s}`);
    await tx.execute(sql`update upload_sessions set result_book_id = ${k}, updated_at = now() where result_book_id = ${s}`);
    await tx.execute(sql`
      insert into book_duplicate_dismissals (user_id, kind, book_id_a, book_id_b, created_at)
      select user_id, kind,
        least(case when book_id_a = ${s} then ${k} else book_id_a end, case when book_id_b = ${s} then ${k} else book_id_b end),
        greatest(case when book_id_a = ${s} then ${k} else book_id_a end, case when book_id_b = ${s} then ${k} else book_id_b end),
        created_at
      from book_duplicate_dismissals
      where (book_id_a = ${s} or book_id_b = ${s})
        and (case when book_id_a = ${s} then ${k} else book_id_a end) <> (case when book_id_b = ${s} then ${k} else book_id_b end)
      on conflict do nothing
    `);
  }

  /**
   * Link groups: the kept book takes the source's place, groups merge (the kept book's lead wins), and
   * groups below two members dissolve. Two groups are never folded past BOOK_LINK_MAX_MEMBERS: then the
   * kept book keeps its group and the source's other members keep theirs.
   */
  async reconcileLinks(tx: ConsolidationTx, targetBookId: number, sourceBookId: number): Promise<void> {
    const rows = rowsOf<{ book_id: number; group_id: number }>(
      await tx.execute(sql`select book_id, group_id from book_links where book_id in (${targetBookId}, ${sourceBookId})`),
    );
    const targetGroup = rows.find((row) => Number(row.book_id) === targetBookId)?.group_id ?? null;
    const sourceGroup = rows.find((row) => Number(row.book_id) === sourceBookId)?.group_id ?? null;
    if (sourceGroup === null) return;

    if (targetGroup === null) {
      await tx.execute(sql`update book_links set book_id = ${targetBookId} where book_id = ${sourceBookId}`);
    } else if (Number(targetGroup) !== Number(sourceGroup)) {
      await tx.execute(sql`delete from book_links where book_id = ${sourceBookId}`);
      const sizes = rowsOf<{ members: number }>(
        await tx.execute(sql`select count(*)::int as members from book_links where group_id in (${targetGroup}, ${sourceGroup})`),
      );
      if (Number(sizes[0]?.members ?? 0) <= BOOK_LINK_MAX_MEMBERS) {
        await tx.execute(sql`update book_links set group_id = ${targetGroup} where group_id = ${sourceGroup}`);
        await tx.execute(sql`delete from book_link_groups where id = ${sourceGroup}`);
      }
    } else {
      await tx.execute(sql`delete from book_links where book_id = ${sourceBookId}`);
    }
    // A group the source led: the kept book leads it when it is a member, else the lowest id does (null).
    await tx.execute(sql`
      update book_link_groups g
      set lead_book_id = case when exists (select 1 from book_links l where l.group_id = g.id and l.book_id = ${targetBookId}) then ${targetBookId}::int end,
        updated_at = now()
      where g.lead_book_id = ${sourceBookId}
    `);
    await tx.execute(sql`
      delete from book_link_groups g
      where g.id in (${targetGroup ?? sourceGroup}, ${sourceGroup}) and (select count(*) from book_links l where l.group_id = g.id) < 2
    `);
  }

  /** Book ids kept inside JSON without a foreign key: achievement context and notification links. */
  async rewriteUnkeyedReferences(tx: ConsolidationTx, targetBookId: number, sourceBookId: number): Promise<void> {
    await tx.execute(sql`
      update user_achievements set context_json = jsonb_set(context_json, '{bookId}', to_jsonb(${targetBookId}::int))
      where context_json ? 'bookId' and (context_json->>'bookId') = ${String(sourceBookId)}
    `);
    await tx.execute(sql`
      update notifications set
        meta = case when meta ? 'bookId' and (meta->>'bookId') = ${String(sourceBookId)}
          then jsonb_set(meta, '{bookId}', to_jsonb(${targetBookId}::int)) else meta end,
        action_url = case when action_url = ${`/book/${sourceBookId}`} or action_url like ${`/book/${sourceBookId}/%`}
          then ${`/book/${targetBookId}`} || substr(action_url, ${`/book/${sourceBookId}`.length + 1}) else action_url end
      where (meta ? 'bookId' and (meta->>'bookId') = ${String(sourceBookId)})
        or action_url = ${`/book/${sourceBookId}`} or action_url like ${`/book/${sourceBookId}/%`}
    `);
  }

  async recordAlias(
    tx: ConsolidationTx,
    input: {
      sourceBookId: number;
      targetBookId: number;
      libraryId: number;
      mergedByUserId: number | null;
      jobId: number | null;
      snapshot: BookMergeSnapshot;
    },
  ): Promise<void> {
    await tx.update(schema.bookMerges).set({ targetBookId: input.targetBookId }).where(eq(schema.bookMerges.targetBookId, input.sourceBookId));
    await tx
      .insert(schema.bookMerges)
      .values(input)
      .onConflictDoUpdate({ target: schema.bookMerges.sourceBookId, set: { targetBookId: input.targetBookId } });
  }

  async deleteBook(tx: ConsolidationTx, bookId: number): Promise<void> {
    await deleteBooksWithHashInvalidation(tx, eq(schema.books.id, bookId));
  }

  /** KOReader re-reads a library's hash list only when its revision moves. */
  async bumpKoreaderRevisions(tx: ConsolidationTx, libraryIds: readonly number[]): Promise<void> {
    await bumpKoreaderHashRevisions(tx, libraryIds);
  }

  async finishTarget(
    tx: ConsolidationTx,
    input: { targetBookId: number; folderPath: string | null; addedAt: Date | null; libraryId: number },
  ): Promise<void> {
    await tx
      .update(schema.books)
      .set({
        ...(input.folderPath !== null ? { folderPath: input.folderPath } : {}),
        ...(input.addedAt !== null ? { addedAt: input.addedAt } : {}),
        status: 'present',
        updatedAt: new Date(),
      })
      .where(eq(schema.books.id, input.targetBookId));

    const [library] = await tx
      .select({ formatPriority: schema.libraries.formatPriority, allowedFormats: schema.libraries.allowedFormats })
      .from(schema.libraries)
      .where(eq(schema.libraries.id, input.libraryId))
      .limit(1);
    const [book] = await tx
      .select({ primaryFileId: schema.books.primaryFileId })
      .from(schema.books)
      .where(eq(schema.books.id, input.targetBookId))
      .limit(1);
    if (library && book) {
      const files = await tx
        .select({
          id: schema.bookFiles.id,
          role: schema.bookFiles.role,
          format: schema.bookFiles.format,
          sizeBytes: schema.bookFiles.sizeBytes,
          sortOrder: schema.bookFiles.sortOrder,
          mediaOverlayAvailable: schema.bookFiles.mediaOverlayAvailable,
        })
        .from(schema.bookFiles)
        .where(eq(schema.bookFiles.bookId, input.targetBookId));
      const winner = selectMovedPrimary(files, book.primaryFileId, {
        formatPriority: library.formatPriority,
        allowedFormats: library.allowedFormats ?? [],
      });
      if (winner && winner.id !== book.primaryFileId) {
        await tx.update(schema.books).set({ primaryFileId: winner.id }).where(eq(schema.books.id, input.targetBookId));
      }
    }
    await refreshPrimaryAuthorSortNamesForBooks(tx, [input.targetBookId]);
  }

  // ── Retiring an identical copy ──────────────────────────────────────────────────────────────

  async lockFiles(tx: ConsolidationTx, fileIds: number[]) {
    return tx
      .select({
        id: schema.bookFiles.id,
        bookId: schema.bookFiles.bookId,
        sizeBytes: schema.bookFiles.sizeBytes,
        absolutePath: schema.bookFiles.absolutePath,
        role: schema.bookFiles.role,
      })
      .from(schema.bookFiles)
      .where(inArray(schema.bookFiles.id, fileIds))
      .orderBy(asc(schema.bookFiles.id))
      .for('update');
  }

  /** 02-merge-rules.md section 9: every row keyed by the loser moves to the survivor before the loser row goes. */
  async retireFileRow(tx: ConsolidationTx, loserFileId: number, survivorFileId: number): Promise<void> {
    const l = loserFileId;
    const w = survivorFileId;
    const newerWins = async (table: SQL, key: SQL, stamp: SQL) => {
      await tx.execute(sql`
        delete from ${table} x using ${table} y
        where x.book_file_id = ${l} and y.book_file_id = ${w} and ${key} and y.${stamp} >= x.${stamp}
      `);
      await tx.execute(sql`
        delete from ${table} y using ${table} x
        where y.book_file_id = ${w} and x.book_file_id = ${l} and ${key} and x.${stamp} > y.${stamp}
      `);
      await tx.execute(sql`update ${table} set book_file_id = ${w} where book_file_id = ${l}`);
    };
    const survivorWins = async (table: SQL, key: SQL) => {
      await tx.execute(sql`
        update ${table} x set book_file_id = ${w}
        where x.book_file_id = ${l} and not exists (select 1 from ${table} y where y.book_file_id = ${w} and ${key})
      `);
    };

    await tx.execute(sql`update books set primary_file_id = ${w} where primary_file_id = ${l}`);
    await newerWins(sql`reading_progress`, sql`y.user_id = x.user_id`, sql`updated_at`);
    await newerWins(sql`tts_reading_position`, sql`y.user_id = x.user_id`, sql`updated_at`);
    await newerWins(sql`koreader_progress_resets`, sql`y.user_id = x.user_id`, sql`reset_at`);
    await tx.execute(sql`
      delete from koreader_device_progress x using koreader_device_progress y
      where x.book_file_id = ${l} and y.book_file_id = ${w} and not x.orphaned and not y.orphaned
        and y.user_id = x.user_id and y.device = x.device and y.device_id = x.device_id and y.updated_at >= x.updated_at
    `);
    await tx.execute(sql`
      delete from koreader_device_progress y using koreader_device_progress x
      where y.book_file_id = ${w} and x.book_file_id = ${l} and not x.orphaned and not y.orphaned
        and y.user_id = x.user_id and y.device = x.device and y.device_id = x.device_id and x.updated_at > y.updated_at
    `);
    await tx.execute(sql`update koreader_device_progress set book_file_id = ${w} where book_file_id = ${l}`);
    await survivorWins(sql`reader_preferences`, sql`y.user_id = x.user_id`);
    await survivorWins(
      sql`koreader_page_stats`,
      sql`y.user_id = x.user_id and y.device_id = x.device_id and y.page = x.page and y.start_time = x.start_time`,
    );
    await survivorWins(sql`book_file_hash_history`, sql`y.file_hash = x.file_hash`);
    for (const table of [
      sql`reading_sessions`,
      sql`annotation_positions`,
      sql`bookmarks`,
      sql`koreader_book_hash_links`,
      sql`koreader_session_tombstones`,
      sql`email_send_log`,
      sql`file_write_log`,
    ]) {
      await tx.execute(sql`update ${table} set book_file_id = ${w} where book_file_id = ${l}`);
    }
    await tx.execute(sql`update audiobook_progress set current_file_id = ${w} where current_file_id = ${l}`);
    await tx.execute(sql`update read_aloud_jobs set output_file_id = ${w} where output_file_id = ${l}`);
    await tx.execute(sql`update read_aloud_jobs set replace_file_id = ${w} where replace_file_id = ${l}`);
    await tx.execute(sql`delete from kobo_device_deliveries where source_file_id = ${l}`);
    await deleteBookFilesWithHashInvalidation(tx, eq(schema.bookFiles.id, l));
  }

  /** Raw access for checks that read one value. */
  async scalar<T>(tx: ConsolidationTx, query: SQL): Promise<T | null> {
    const [row] = rowsOf<{ value: T }>(await tx.execute(query));
    return row?.value ?? null;
  }
}
