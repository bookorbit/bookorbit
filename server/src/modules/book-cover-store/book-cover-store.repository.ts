import { Inject, Injectable } from '@nestjs/common';
import { AUDIO_FORMAT_LIST, type CoverMedia, type CoverMedium } from '@bookorbit/types';
import { and, eq, getTableName, gt, inArray, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookCovers, bookFiles, bookMetadata, books, libraries } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

export type BookCoverOrigin = 'embedded' | 'folder_image' | 'opf' | 'provider' | 'dock' | 'upload' | 'legacy';
export type BookCoverSource = 'extracted' | 'custom';
export type BookCoverSlotRow = typeof bookCovers.$inferSelect;

type DatabaseCoverMediaFile = Pick<typeof bookFiles.$inferSelect, 'format' | 'role' | 'mediaOverlayAvailable'>;

export function getCoverMediaFromDatabaseFiles(files: readonly DatabaseCoverMediaFile[]): CoverMedia {
  let hasEbook = false;
  let hasAudio = false;
  for (const file of files) {
    if (file.role !== 'content' && file.role !== 'primary') continue;
    const format = file.format?.trim().toLowerCase();
    if (!format) continue;
    if ((AUDIO_FORMAT_LIST as readonly string[]).includes(format)) hasAudio = true;
    else hasEbook = true;
    if (format === 'epub' && file.mediaOverlayAvailable) hasAudio = true;
  }
  return { hasEbook, hasAudio };
}

const AUDIO_FORMAT_SQL = sql.join(
  AUDIO_FORMAT_LIST.map((format) => sql`${format}`),
  sql`, `,
);

type OuterBookId = number | typeof books.id | typeof bookMetadata.bookId;

/**
 * Drizzle leaves a column unqualified when the outer query reads a single table, and inside these
 * subqueries a bare `"id"` or `"book_id"` then binds to the subquery's own table, so every book
 * would get the same answer. Naming the table keeps the reference on the outer row.
 */
function outerBookIdSql(bookId: OuterBookId): SQL {
  if (typeof bookId === 'number') return sql`${bookId}`;
  return sql`${sql.identifier(getTableName(bookId.table))}.${sql.identifier(bookId.name)}`;
}

export function coverMediaSql(bookId: OuterBookId) {
  const outer = outerBookIdSql(bookId);
  return {
    hasEbook: sql<boolean>`exists (
      select 1 from ${bookFiles}
      where ${bookFiles.bookId} = ${outer}
        and ${bookFiles.role} in ('content', 'primary')
        and ${bookFiles.format} is not null
        and lower(${bookFiles.format}) not in (${AUDIO_FORMAT_SQL})
    )`,
    hasAudio: sql<boolean>`exists (
      select 1 from ${bookFiles}
      where ${bookFiles.bookId} = ${outer}
        and ${bookFiles.role} in ('content', 'primary')
        and (
          lower(${bookFiles.format}) in (${AUDIO_FORMAT_SQL})
          or (lower(${bookFiles.format}) = 'epub' and ${bookFiles.mediaOverlayAvailable} = true)
        )
    )`,
  };
}

/** A filled, served slot of this medium. Callers pair it with `coverMediaSql` for the medium's presence. */
export function activeCoverSlotSql(bookId: OuterBookId, medium: CoverMedium) {
  return sql<boolean>`exists (
    select 1 from ${bookCovers}
    where ${bookCovers.bookId} = ${outerBookIdSql(bookId)}
      and ${bookCovers.medium} = ${medium}
      and ${bookCovers.dormantSince} is null
  )`;
}

export type BookCoverContext = {
  bookId: number;
  libraryId: number;
  coverAspectRatio: string;
  primaryFileId: number | null;
  coverSource: BookCoverSource | null;
  coverUpdatedAt: Date | null;
  metadataUpdatedAt: Date | null;
  lockedFields: string[];
  media: CoverMedia;
  files: Array<{ id: number; format: string | null; role: string; mediaOverlayAvailable: boolean }>;
  slots: BookCoverSlotRow[];
};

export type BookCoverSourceFile = {
  id: number;
  absolutePath: string;
  format: string | null;
  role: string;
  sizeBytes: number | null;
  mediaOverlayAvailable: boolean;
};

export type BookCoverSources = {
  formatPriority: string[];
  files: BookCoverSourceFile[];
};

type SlotMutation =
  | {
      kind: 'upsert';
      row: Omit<typeof bookCovers.$inferInsert, 'bookId' | 'medium'>;
    }
  | { kind: 'delete' };

function mediumIsActive(medium: CoverMedium, media: CoverMedia): boolean {
  return medium === 'ebook' ? media.hasEbook : media.hasAudio;
}

export function resolveKoboCoverMedium(rows: readonly BookCoverSlotRow[], media: CoverMedia): CoverMedium | null {
  const active = new Set(
    rows.filter((row) => row.dormantSince === null && mediumIsActive(row.medium as CoverMedium, media)).map((row) => row.medium as CoverMedium),
  );
  if (active.has('ebook')) return 'ebook';
  if (active.has('audio')) return 'audio';
  return null;
}

export function didKoboCoverChange(
  before: readonly BookCoverSlotRow[],
  after: readonly BookCoverSlotRow[],
  media: CoverMedia,
  mutatedMedium: CoverMedium,
  servedBytesChanged: boolean,
  beforeMedia: CoverMedia = media,
): boolean {
  const beforeKobo = resolveKoboCoverMedium(before, beforeMedia);
  const afterKobo = resolveKoboCoverMedium(after, media);
  return beforeKobo !== afterKobo || (servedBytesChanged && (beforeKobo === mutatedMedium || afterKobo === mutatedMedium));
}

@Injectable()
export class BookCoverStoreRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findContext(bookId: number): Promise<BookCoverContext | null> {
    const mediaProjection = coverMediaSql(books.id);
    const [book] = await this.db
      .select({
        bookId: books.id,
        libraryId: books.libraryId,
        coverAspectRatio: libraries.coverAspectRatio,
        primaryFileId: books.primaryFileId,
        coverSource: bookMetadata.coverSource,
        coverUpdatedAt: bookMetadata.coverUpdatedAt,
        metadataUpdatedAt: bookMetadata.updatedAt,
        lockedFields: bookMetadata.lockedFields,
        ...mediaProjection,
      })
      .from(books)
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(eq(books.id, bookId))
      .limit(1);
    if (!book) return null;

    const [files, slots] = await Promise.all([
      this.db
        .select({
          id: bookFiles.id,
          format: bookFiles.format,
          role: bookFiles.role,
          mediaOverlayAvailable: bookFiles.mediaOverlayAvailable,
        })
        .from(bookFiles)
        .where(eq(bookFiles.bookId, bookId)),
      this.db.select().from(bookCovers).where(eq(bookCovers.bookId, bookId)),
    ]);

    return {
      bookId: book.bookId,
      libraryId: book.libraryId,
      coverAspectRatio: book.coverAspectRatio,
      primaryFileId: book.primaryFileId,
      coverSource: (book.coverSource as BookCoverSource | null) ?? null,
      coverUpdatedAt: book.coverUpdatedAt ?? null,
      metadataUpdatedAt: book.metadataUpdatedAt ?? null,
      lockedFields: book.lockedFields ?? [],
      media: { hasEbook: book.hasEbook, hasAudio: book.hasAudio },
      files,
      slots,
    };
  }

  async slotsFor(bookIds: number[]): Promise<Map<number, BookCoverSlotRow[]>> {
    const result = new Map<number, BookCoverSlotRow[]>();
    if (bookIds.length === 0) return result;
    const rows = await this.db.select().from(bookCovers).where(inArray(bookCovers.bookId, bookIds));
    for (const row of rows) {
      const list = result.get(row.bookId) ?? [];
      list.push(row);
      result.set(row.bookId, list);
    }
    return result;
  }

  async applySlotMutation(
    bookId: number,
    medium: CoverMedium,
    media: CoverMedia,
    mutation: SlotMutation,
    options: { bumpBook: boolean; servedBytesChanged: boolean; updatedAt: Date; beforeMedia?: CoverMedia },
  ): Promise<{ libraryId: number; koboCoverChanged: boolean }> {
    return this.db.transaction(async (tx) => {
      const before = await this.selectSlots(bookId, tx);
      if (mutation.kind === 'delete') {
        await tx.delete(bookCovers).where(and(eq(bookCovers.bookId, bookId), eq(bookCovers.medium, medium)));
      } else {
        await tx
          .insert(bookCovers)
          .values({ bookId, medium, ...mutation.row })
          .onConflictDoUpdate({
            target: [bookCovers.bookId, bookCovers.medium],
            set: mutation.row,
          });
      }
      const after = await this.selectSlots(bookId, tx);
      const koboCoverChanged = didKoboCoverChange(before, after, media, medium, options.servedBytesChanged, options.beforeMedia);
      const activeRows = after.filter((row) => row.dormantSince === null && mediumIsActive(row.medium as CoverMedium, media));
      const coverSource: BookCoverSource | null = activeRows.some((row) => row.source === 'custom')
        ? 'custom'
        : activeRows.length > 0
          ? 'extracted'
          : null;

      const [existingMetadata] = await tx
        .select({ updatedAt: bookMetadata.updatedAt, coverUpdatedAt: bookMetadata.coverUpdatedAt })
        .from(bookMetadata)
        .where(eq(bookMetadata.bookId, bookId))
        .limit(1);
      const metadataUpdatedAt = koboCoverChanged ? options.updatedAt : (existingMetadata?.updatedAt ?? options.updatedAt);
      const coverUpdatedAt = koboCoverChanged ? options.updatedAt : (existingMetadata?.coverUpdatedAt ?? null);

      await tx
        .insert(bookMetadata)
        .values({ bookId, coverSource, coverUpdatedAt, updatedAt: metadataUpdatedAt })
        .onConflictDoUpdate({
          target: bookMetadata.bookId,
          set: { coverSource, coverUpdatedAt, updatedAt: metadataUpdatedAt },
        });

      if (options.bumpBook) {
        await tx.update(books).set({ updatedAt: options.updatedAt }).where(eq(books.id, bookId));
      }

      const [book] = await tx.select({ libraryId: books.libraryId }).from(books).where(eq(books.id, bookId)).limit(1);
      return { libraryId: book?.libraryId ?? 0, koboCoverChanged };
    });
  }

  async importSlotWithoutStamp(bookId: number, medium: CoverMedium, row: Omit<typeof bookCovers.$inferInsert, 'bookId' | 'medium'>): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx
        .insert(bookCovers)
        .values({ bookId, medium, ...row })
        .onConflictDoNothing({ target: [bookCovers.bookId, bookCovers.medium] });
      await this.recomputeSummary(bookId, tx);
      const [book] = await tx.select({ libraryId: books.libraryId }).from(books).where(eq(books.id, bookId)).limit(1);
      return book?.libraryId ?? 0;
    });
  }

  async copyCoverLockToAudio(bookId: number): Promise<void> {
    await this.db
      .update(bookMetadata)
      .set({
        lockedFields: sql`case
          when 'cover' = any(${bookMetadata.lockedFields}) and not ('audioCover' = any(${bookMetadata.lockedFields}))
          then array_append(${bookMetadata.lockedFields}, 'audioCover')
          else ${bookMetadata.lockedFields}
        end`,
        updatedAt: sql`${bookMetadata.updatedAt}`,
      })
      .where(eq(bookMetadata.bookId, bookId));
  }

  async listBookIdsAfter(afterId: number, limit: number): Promise<number[]> {
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .where(sql`${books.id} > ${afterId}`)
      .orderBy(books.id)
      .limit(limit);
    return rows.map((row) => row.id);
  }

  async findCoverSources(bookId: number): Promise<BookCoverSources | null> {
    const [book] = await this.db
      .select({ formatPriority: libraries.formatPriority })
      .from(books)
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .where(eq(books.id, bookId))
      .limit(1);
    if (!book) return null;
    const files = await this.db
      .select({
        id: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        role: bookFiles.role,
        sizeBytes: bookFiles.sizeBytes,
        mediaOverlayAvailable: bookFiles.mediaOverlayAvailable,
      })
      .from(bookFiles)
      .where(eq(bookFiles.bookId, bookId));
    return { formatPriority: book.formatPriority, files };
  }

  /**
   * Rewrites `cover_source` wherever it disagrees with the book's active slots, leaving
   * `updated_at` and the Kobo stamp alone. Only books with slot rows are touched: a book without any
   * may still hold a legacy root cover that its summary rightly describes.
   */
  async repairCoverSummaries(): Promise<Array<{ bookId: number; libraryId: number }>> {
    const { hasEbook, hasAudio } = coverMediaSql(bookCovers.bookId);
    const result = await this.db.execute<{ book_id: number; library_id: number }>(sql`
      with slot_states as (
        select
          "book_covers"."book_id" as book_id,
          "book_covers"."source" as source,
          "book_covers"."dormant_since" is null
            and (("book_covers"."medium" = 'ebook' and ${hasEbook}) or ("book_covers"."medium" = 'audio' and ${hasAudio})) as active
        from "book_covers"
      ),
      derived as (
        select
          book_id,
          case
            when bool_or(active and source = 'custom') then 'custom'
            when bool_or(active) then 'extracted'
          end as cover_source
        from slot_states
        group by book_id
      )
      update "book_metadata"
      set "cover_source" = derived.cover_source
      from derived, "books"
      where "book_metadata"."book_id" = derived.book_id
        and "books"."id" = derived.book_id
        and "book_metadata"."cover_source" is distinct from derived.cover_source
      returning "book_metadata"."book_id" as book_id, "books"."library_id" as library_id
    `);
    return result.rows.map((row) => ({ bookId: Number(row.book_id), libraryId: Number(row.library_id) }));
  }

  async listBookIdsWithBothCoverMediaAfter(afterId: number, limit: number): Promise<number[]> {
    const media = coverMediaSql(books.id);
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .where(and(gt(books.id, afterId), media.hasEbook, media.hasAudio))
      .orderBy(books.id)
      .limit(limit);
    return rows.map((row) => row.id);
  }

  async listBookIdsWithExpiredDormantSlots(libraryId: number, dormantBefore: Date, limit: number): Promise<number[]> {
    const rows = await this.db
      .selectDistinct({ id: bookCovers.bookId })
      .from(bookCovers)
      .innerJoin(books, eq(books.id, bookCovers.bookId))
      .where(
        and(
          eq(books.libraryId, libraryId),
          eq(bookCovers.source, 'extracted'),
          isNotNull(bookCovers.dormantSince),
          lte(bookCovers.dormantSince, dormantBefore),
        ),
      )
      .orderBy(bookCovers.bookId)
      .limit(limit);
    return rows.map((row) => row.id);
  }

  private async selectSlots(bookId: number, executor: Db | DbTransaction): Promise<BookCoverSlotRow[]> {
    return executor.select().from(bookCovers).where(eq(bookCovers.bookId, bookId));
  }

  private async recomputeSummary(bookId: number, tx: DbTransaction): Promise<void> {
    const mediaProjection = coverMediaSql(books.id);
    const [book] = await tx
      .select({ ...mediaProjection })
      .from(books)
      .where(eq(books.id, bookId))
      .limit(1);
    if (!book) return;
    const slots = await this.selectSlots(bookId, tx);
    const activeRows = slots.filter(
      (row) => row.dormantSince === null && mediumIsActive(row.medium as CoverMedium, { hasEbook: book.hasEbook, hasAudio: book.hasAudio }),
    );
    const coverSource: BookCoverSource | null = activeRows.some((row) => row.source === 'custom')
      ? 'custom'
      : activeRows.length > 0
        ? 'extracted'
        : null;
    const [metadata] = await tx.select({ updatedAt: bookMetadata.updatedAt }).from(bookMetadata).where(eq(bookMetadata.bookId, bookId)).limit(1);
    const updatedAt = metadata?.updatedAt ?? new Date();
    await tx
      .insert(bookMetadata)
      .values({ bookId, coverSource, updatedAt })
      .onConflictDoUpdate({ target: bookMetadata.bookId, set: { coverSource, updatedAt } });
  }
}
