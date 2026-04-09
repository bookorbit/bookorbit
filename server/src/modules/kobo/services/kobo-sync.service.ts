import { createHash } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, asc, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';
import { KoboBookAccessService } from './kobo-book-access.service';
import { KoboReadingStateService } from './kobo-reading-state.service';

type Db = NodePgDatabase<typeof schema>;

const SYNC_PAGE_SIZE = 5;
const SNAPSHOT_RECONCILE_BATCH_SIZE = 5000;
const TOKEN_PREFIX = 'PX.';

type EligibleSnapshotRow = {
  bookId: number;
  fileHash: string | null;
  metadataHash: string;
};

export interface KoboBookEntry {
  bookId: number;
  title: string;
  authors: string[];
  description: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  seriesName: string | null;
  seriesIndex: number | null;
  fileFormat: string;
  fileSizeBytes: number | null;
  fileHash: string | null;
  metadataHash: string;
  metadataUpdatedAt: Date | null;
  collectionNames: string[];
  addedAt: Date;
  updatedAt: Date;
}

export interface SyncSettings {
  readingThreshold: number;
  finishedThreshold: number;
  twoWayProgressSync: boolean;
}

function encodeSyncToken(snapshotId: number): string {
  return TOKEN_PREFIX + Buffer.from(JSON.stringify({ snapshotId })).toString('base64');
}

@Injectable()
export class KoboSyncService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly bookAccessService: KoboBookAccessService,
    private readonly readingStateService: KoboReadingStateService,
  ) {}

  async getDelta(
    userId: number,
    deviceToken: string,
    baseUrl: string,
    syncToken: string | null,
    settings: SyncSettings,
  ): Promise<{ entitlements: unknown[]; hasMore: boolean; syncToken: string }> {
    const snapshot = await this.db.query.koboLibrarySnapshots.findFirst({
      where: eq(schema.koboLibrarySnapshots.userId, userId),
    });

    const eligibleSnapshotRows = await this.fetchEligibleSnapshotRows(userId);

    if (!snapshot) {
      await this.createSnapshot(userId, eligibleSnapshotRows);
    } else {
      await this.reconcileSnapshot(snapshot.id, eligibleSnapshotRows);
    }

    return this.getPageFromSnapshot(userId, deviceToken, baseUrl, settings, new Set(eligibleSnapshotRows.map((row) => row.bookId)));
  }

  async getBookMetadata(userId: number, bookId: number, deviceToken: string, baseUrl: string): Promise<unknown[]> {
    const booksById = await this.fetchEligibleBooksByIds(userId, [bookId]);
    const book = booksById.get(bookId) ?? null;
    if (!book) return [];
    return [this.buildBookMetadata(book, deviceToken, baseUrl)];
  }

  async removeBookFromSync(userId: number, bookId: number): Promise<void> {
    const snapshot = await this.db.query.koboLibrarySnapshots.findFirst({
      where: eq(schema.koboLibrarySnapshots.userId, userId),
    });
    if (!snapshot) return;

    const row = await this.db.query.koboSnapshotBooks.findFirst({
      where: and(eq(schema.koboSnapshotBooks.snapshotId, snapshot.id), eq(schema.koboSnapshotBooks.bookId, bookId)),
    });
    if (!row) return;

    if (row.pendingDelete) {
      await this.db
        .delete(schema.koboSnapshotBooks)
        .where(and(eq(schema.koboSnapshotBooks.snapshotId, snapshot.id), eq(schema.koboSnapshotBooks.bookId, bookId)));
    } else {
      await this.db
        .update(schema.koboSnapshotBooks)
        .set({ removedByDevice: true, synced: true })
        .where(and(eq(schema.koboSnapshotBooks.snapshotId, snapshot.id), eq(schema.koboSnapshotBooks.bookId, bookId)));
    }
  }

  async invalidateSnapshot(userId: number) {
    const snapshot = await this.db.query.koboLibrarySnapshots.findFirst({
      where: eq(schema.koboLibrarySnapshots.userId, userId),
    });
    if (!snapshot) return;
    await this.db.update(schema.koboSnapshotBooks).set({ synced: false }).where(eq(schema.koboSnapshotBooks.snapshotId, snapshot.id));
  }

  private async createSnapshot(userId: number, books: EligibleSnapshotRow[]) {
    const [snap] = await this.db.insert(schema.koboLibrarySnapshots).values({ userId }).returning();
    if (books.length > 0) {
      await this.db
        .insert(schema.koboSnapshotBooks)
        .values(
          books.map((b) => ({
            snapshotId: snap.id,
            bookId: b.bookId,
            synced: false,
            pendingDelete: false,
            isNew: true,
            removedByDevice: false,
            fileHash: b.fileHash,
            metadataHash: b.metadataHash,
          })),
        )
        .onConflictDoNothing();
    }
  }

  private async reconcileSnapshot(snapshotId: number, eligibleBooks: EligibleSnapshotRow[]) {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TEMP TABLE kobo_eligible_books_tmp (
          book_id integer PRIMARY KEY,
          file_hash varchar(64),
          metadata_hash varchar(64) NOT NULL
        ) ON COMMIT DROP
      `);

      for (let index = 0; index < eligibleBooks.length; index += SNAPSHOT_RECONCILE_BATCH_SIZE) {
        const chunk = eligibleBooks.slice(index, index + SNAPSHOT_RECONCILE_BATCH_SIZE);
        const bookIds = chunk.map((book) => book.bookId);
        const fileHashes = chunk.map((book) => book.fileHash);
        const metadataHashes = chunk.map((book) => book.metadataHash);

        await tx.execute(sql`
          INSERT INTO kobo_eligible_books_tmp (book_id, file_hash, metadata_hash)
          SELECT * FROM unnest(${bookIds}::integer[], ${fileHashes}::text[], ${metadataHashes}::text[])
          ON CONFLICT (book_id)
          DO UPDATE
          SET file_hash = EXCLUDED.file_hash,
              metadata_hash = EXCLUDED.metadata_hash
        `);
      }

      await tx.execute(sql`
        UPDATE ${schema.koboSnapshotBooks} AS sb
        SET pending_delete = true,
            synced = false
        WHERE sb.snapshot_id = ${snapshotId}
          AND sb.pending_delete = false
          AND sb.removed_by_device = false
          AND sb.synced = true
          AND NOT EXISTS (SELECT 1 FROM kobo_eligible_books_tmp e WHERE e.book_id = sb.book_id)
      `);

      await tx.execute(sql`
        DELETE FROM ${schema.koboSnapshotBooks} AS sb
        WHERE sb.snapshot_id = ${snapshotId}
          AND sb.pending_delete = false
          AND (sb.removed_by_device = true OR sb.synced = false)
          AND NOT EXISTS (SELECT 1 FROM kobo_eligible_books_tmp e WHERE e.book_id = sb.book_id)
      `);

      await tx.execute(sql`
        INSERT INTO ${schema.koboSnapshotBooks}
          (snapshot_id, book_id, synced, pending_delete, is_new, removed_by_device, file_hash, metadata_hash)
        SELECT ${snapshotId}, e.book_id, false, false, true, false, e.file_hash, e.metadata_hash
        FROM kobo_eligible_books_tmp e
        LEFT JOIN ${schema.koboSnapshotBooks} sb
          ON sb.snapshot_id = ${snapshotId}
         AND sb.book_id = e.book_id
        WHERE sb.book_id IS NULL
      `);

      await tx.execute(sql`
        UPDATE ${schema.koboSnapshotBooks} AS sb
        SET pending_delete = false,
            synced = false,
            is_new = true,
            file_hash = e.file_hash,
            metadata_hash = e.metadata_hash
        FROM kobo_eligible_books_tmp e
        WHERE sb.snapshot_id = ${snapshotId}
          AND sb.book_id = e.book_id
          AND sb.pending_delete = true
          AND sb.removed_by_device = false
      `);

      await tx.execute(sql`
        UPDATE ${schema.koboSnapshotBooks} AS sb
        SET synced = false,
            is_new = false,
            file_hash = e.file_hash,
            metadata_hash = e.metadata_hash
        FROM kobo_eligible_books_tmp e
        WHERE sb.snapshot_id = ${snapshotId}
          AND sb.book_id = e.book_id
          AND sb.removed_by_device = false
          AND sb.synced = true
          AND (sb.file_hash IS DISTINCT FROM e.file_hash OR sb.metadata_hash IS DISTINCT FROM e.metadata_hash)
      `);
    });
  }

  private async getPageFromSnapshot(
    userId: number,
    deviceToken: string,
    baseUrl: string,
    settings: SyncSettings,
    eligibleIds: Set<number>,
  ): Promise<{ entitlements: unknown[]; hasMore: boolean; syncToken: string }> {
    const snapshot = await this.db.query.koboLibrarySnapshots.findFirst({
      where: eq(schema.koboLibrarySnapshots.userId, userId),
    });

    if (!snapshot) return { entitlements: [], hasMore: false, syncToken: encodeSyncToken(0) };

    const syncToken = encodeSyncToken(snapshot.id);

    const pending = await this.db
      .select()
      .from(schema.koboSnapshotBooks)
      .where(and(eq(schema.koboSnapshotBooks.snapshotId, snapshot.id), eq(schema.koboSnapshotBooks.synced, false)))
      .orderBy(asc(schema.koboSnapshotBooks.bookId))
      .limit(SYNC_PAGE_SIZE + 1);

    const hasMore = pending.length > SYNC_PAGE_SIZE;
    const page = pending.slice(0, SYNC_PAGE_SIZE);

    if (page.length === 0) {
      const endItems: unknown[] = [];

      if (settings.twoWayProgressSync) {
        const pushed = await this.readingStateService.getAndMarkStatesNeedingPush(userId, settings.readingThreshold, settings.finishedThreshold);
        endItems.push(...pushed.items);
        if (pushed.hasMore) {
          return { entitlements: endItems, hasMore: true, syncToken };
        }
      }

      const tagItems = await this.buildTagItems(userId, eligibleIds);
      endItems.push(...tagItems);

      return { entitlements: endItems, hasMore: false, syncToken };
    }

    const pageIds = page.map((r) => r.bookId);
    await this.db
      .update(schema.koboSnapshotBooks)
      .set({ synced: true })
      .where(and(eq(schema.koboSnapshotBooks.snapshotId, snapshot.id), inArray(schema.koboSnapshotBooks.bookId, pageIds)));

    const entitlements: unknown[] = [];
    const booksById = await this.fetchEligibleBooksByIds(
      userId,
      page.filter((row) => !row.pendingDelete).map((row) => row.bookId),
    );

    for (const row of page) {
      if (row.pendingDelete) {
        entitlements.push(this.buildRemovedEntitlement(row.bookId));
        await this.db
          .delete(schema.koboSnapshotBooks)
          .where(and(eq(schema.koboSnapshotBooks.snapshotId, snapshot.id), eq(schema.koboSnapshotBooks.bookId, row.bookId)));
        continue;
      }

      const book = booksById.get(row.bookId) ?? null;
      if (!book) continue;

      if (row.isNew) {
        const readingState = (await this.readingStateService.getRawState(userId, row.bookId)) ?? this.buildDefaultReadingState(row.bookId);
        entitlements.push({
          NewEntitlement: {
            BookEntitlement: this.buildBookEntitlement(book),
            BookMetadata: this.buildBookMetadata(book, deviceToken, baseUrl),
            ReadingState: readingState,
          },
        });
      } else {
        entitlements.push({
          ChangedProductMetadata: {
            BookEntitlement: this.buildBookEntitlement(book),
            BookMetadata: this.buildBookMetadata(book, deviceToken, baseUrl),
          },
        });
      }
    }

    return { entitlements, hasMore, syncToken };
  }

  private async buildTagItems(userId: number, eligibleIds: Set<number>): Promise<unknown[]> {
    const collections = await this.db.query.collections.findMany({
      where: and(eq(schema.collections.userId, userId), eq(schema.collections.syncToKobo, true)),
    });
    if (collections.length === 0) return [];

    const collectionIds = collections.map((c) => c.id);

    const collectionBooks = await this.db
      .select({ collectionId: schema.collectionBooks.collectionId, bookId: schema.collectionBooks.bookId })
      .from(schema.collectionBooks)
      .where(inArray(schema.collectionBooks.collectionId, collectionIds));

    const booksByCollection = new Map<number, number[]>();
    for (const row of collectionBooks) {
      const list = booksByCollection.get(row.collectionId) ?? [];
      list.push(row.bookId);
      booksByCollection.set(row.collectionId, list);
    }

    const now = new Date().toISOString();
    return collections.map((col) => {
      const bookIds = (booksByCollection.get(col.id) ?? []).filter((id) => eligibleIds.has(id));
      return {
        ChangedTag: {
          Tag: {
            Id: `col-${col.id}`,
            Name: col.name,
            Created: now,
            LastModified: now,
            Type: 'UserTag',
            Items: bookIds.map((bookId) => ({ RevisionId: String(bookId), Type: 'ProductRevisionTagItem' })),
          },
        },
      };
    });
  }

  private buildRemovedEntitlement(bookId: number) {
    const id = String(bookId);
    const now = new Date().toISOString();
    return {
      ChangedEntitlement: {
        BookEntitlement: {
          Accessibility: 'Full',
          ActivePeriod: { From: now },
          Created: now,
          CrossRevisionId: id,
          Id: id,
          IsRemoved: true,
          IsHiddenFromArchive: false,
          IsLocked: false,
          LastModified: now,
          OriginCategory: 'Imported',
          RevisionId: id,
          Status: 'Deleted',
          Type: 'ebook',
        },
        BookMetadata: { CrossRevisionId: id, RevisionId: id, EntitlementId: id, WorkId: id, Title: id },
      },
    };
  }

  private buildBookEntitlement(book: KoboBookEntry) {
    const id = String(book.bookId);
    const addedAt = book.addedAt.toISOString();
    const updatedAt = book.updatedAt.toISOString();
    return {
      Accessibility: 'Full',
      ActivePeriod: { From: addedAt },
      Created: addedAt,
      CrossRevisionId: id,
      Id: id,
      IsRemoved: false,
      IsHiddenFromArchive: false,
      IsLocked: false,
      LastModified: updatedAt,
      OriginCategory: 'Imported',
      RevisionId: id,
      Status: 'Active',
      Type: 'ebook',
    };
  }

  private buildBookMetadata(book: KoboBookEntry, deviceToken: string, baseUrl: string) {
    const id = String(book.bookId);
    const format = book.fileFormat.toLowerCase() === 'pdf' ? 'PDF' : 'EPUB3';
    const downloadUrl = `${baseUrl}/api/v1/kobo/${deviceToken}/v1/books/${book.bookId}/download`;
    const slug = book.title ? book.title.toLowerCase().replace(/[^a-z0-9]/g, '-') : id;
    const publicationDate = book.publishedYear ? new Date(Date.UTC(book.publishedYear, 0, 1)).toISOString() : null;
    const publisher = book.publisher ? { Name: book.publisher, Imprint: book.publisher } : null;
    const series = book.seriesName
      ? {
          Id: `series_${book.seriesName}`,
          Name: book.seriesName,
          Number: book.seriesIndex != null ? String(book.seriesIndex) : '1',
          NumberFloat: book.seriesIndex ?? 1.0,
        }
      : { Id: '', Name: '', Number: '', NumberFloat: 0.0 };

    const coverImageId = book.metadataUpdatedAt ? `${id}-${book.metadataUpdatedAt.getTime()}` : id;

    return {
      CrossRevisionId: id,
      RevisionId: id,
      EntitlementId: id,
      WorkId: id,
      Title: book.title,
      Slug: slug,
      Description: book.description,
      Publisher: publisher,
      PublicationDate: publicationDate,
      Language: book.language ?? 'en',
      Genre: '00000000-0000-0000-0000-000000000001',
      CoverImageId: coverImageId,
      Contributors: book.authors,
      ContributorRoles: [],
      Series: series,
      Categories: ['00000000-0000-0000-0000-000000000001'],
      IsSocialEnabled: true,
      ExternalIds: [],
      IsPreOrder: false,
      IsInternetArchive: false,
      IsEligibleForKoboLove: false,
      PhoneticPronunciations: {},
      CurrentDisplayPrice: { TotalAmount: 0, CurrencyCode: 'USD' },
      CurrentLoveDisplayPrice: { TotalAmount: 0 },
      DownloadUrls: [{ Format: format, Size: book.fileSizeBytes ?? 0, Url: downloadUrl, Platform: 'Generic', DrmType: 'None' }],
    };
  }

  private buildDefaultReadingState(bookId: number) {
    const id = String(bookId);
    const now = new Date().toISOString();
    return {
      EntitlementId: id,
      Created: now,
      LastModified: now,
      PriorityTimestamp: now,
      StatusInfo: { LastModified: now, Status: 'ReadyToRead', TimesStartedReading: 0 },
      Statistics: { LastModified: now },
      CurrentBookmark: { LastModified: now, ProgressPercent: 0, ContentSourceProgressPercent: 0 },
    };
  }

  private buildMetadataHash(params: {
    title: string | null;
    authors: string[];
    seriesName: string | null;
    seriesIndex: number | null;
    metadataUpdatedAt: Date | null;
  }): string {
    const metaStr = [
      params.title ?? '',
      params.authors.join(','),
      params.seriesName ?? '',
      String(params.seriesIndex ?? ''),
      String(params.metadataUpdatedAt ?? ''),
    ].join('|');
    return createHash('sha256').update(metaStr).digest('hex').slice(0, 16);
  }

  private async buildEligibleBooksWhereClause(userId: number): Promise<SQL | undefined> {
    const accessibleLibraryIds = await this.bookAccessService.getAccessibleLibraryIds(userId);
    const libraryAccessFilter =
      accessibleLibraryIds === null
        ? undefined
        : accessibleLibraryIds.length === 0
          ? sql`false`
          : inArray(schema.books.libraryId, accessibleLibraryIds);

    const collectionMembershipFilter = sql`EXISTS (
      SELECT 1
      FROM ${schema.collectionBooks}
      INNER JOIN ${schema.collections}
        ON ${schema.collections.id} = ${schema.collectionBooks.collectionId}
      WHERE ${schema.collectionBooks.bookId} = ${schema.books.id}
        AND ${schema.collections.userId} = ${userId}
        AND ${schema.collections.syncToKobo} = true
    )`;

    return and(eq(schema.books.status, 'present'), eq(schema.bookFiles.format, 'epub'), libraryAccessFilter, collectionMembershipFilter);
  }

  private async fetchEligibleSnapshotRows(userId: number): Promise<EligibleSnapshotRow[]> {
    const whereClause = await this.buildEligibleBooksWhereClause(userId);
    if (!whereClause) return [];

    const rows = await this.db
      .select({
        bookId: schema.books.id,
        title: schema.bookMetadata.title,
        seriesName: schema.bookMetadata.seriesName,
        seriesIndex: schema.bookMetadata.seriesIndex,
        metadataUpdatedAt: schema.bookMetadata.updatedAt,
        fileHash: schema.bookFiles.hash,
        authorNamesCsv: sql<string>`coalesce(string_agg(${schema.authors.name}, ',' ORDER BY ${schema.bookAuthors.displayOrder}, ${schema.bookAuthors.authorId}), '')`,
      })
      .from(schema.books)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.books.primaryFileId))
      .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
      .leftJoin(schema.bookAuthors, eq(schema.bookAuthors.bookId, schema.books.id))
      .leftJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
      .where(whereClause)
      .groupBy(
        schema.books.id,
        schema.bookMetadata.title,
        schema.bookMetadata.seriesName,
        schema.bookMetadata.seriesIndex,
        schema.bookMetadata.updatedAt,
        schema.bookFiles.hash,
      );

    return rows.map((row) => ({
      bookId: row.bookId,
      fileHash: row.fileHash,
      metadataHash: this.buildMetadataHash({
        title: row.title,
        authors: row.authorNamesCsv ? row.authorNamesCsv.split(',').filter((name) => name.length > 0) : [],
        seriesName: row.seriesName,
        seriesIndex: row.seriesIndex,
        metadataUpdatedAt: row.metadataUpdatedAt,
      }),
    }));
  }

  private async fetchEligibleBooksByIds(userId: number, bookIds: number[]): Promise<Map<number, KoboBookEntry>> {
    const uniqueBookIds = [...new Set(bookIds)];
    if (uniqueBookIds.length === 0) return new Map();

    const whereClause = await this.buildEligibleBooksWhereClause(userId);
    if (!whereClause) return new Map();

    const rows = await this.db
      .select({
        bookId: schema.books.id,
        title: schema.bookMetadata.title,
        description: schema.bookMetadata.description,
        publisher: schema.bookMetadata.publisher,
        publishedYear: schema.bookMetadata.publishedYear,
        language: schema.bookMetadata.language,
        seriesName: schema.bookMetadata.seriesName,
        seriesIndex: schema.bookMetadata.seriesIndex,
        fileFormat: schema.bookFiles.format,
        fileSizeBytes: schema.bookFiles.sizeBytes,
        fileHash: schema.bookFiles.hash,
        metadataUpdatedAt: schema.bookMetadata.updatedAt,
        addedAt: schema.books.addedAt,
        updatedAt: schema.books.updatedAt,
      })
      .from(schema.books)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.books.primaryFileId))
      .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
      .where(and(whereClause, inArray(schema.books.id, uniqueBookIds)));

    if (rows.length === 0) return new Map();

    const fetchedBookIds = rows.map((row) => row.bookId);
    const [authorRows, collectionRows] = await Promise.all([
      this.db
        .select({ bookId: schema.bookAuthors.bookId, name: schema.authors.name })
        .from(schema.bookAuthors)
        .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
        .where(inArray(schema.bookAuthors.bookId, fetchedBookIds))
        .orderBy(schema.bookAuthors.displayOrder),
      this.db
        .select({ bookId: schema.collectionBooks.bookId, name: schema.collections.name })
        .from(schema.collectionBooks)
        .innerJoin(
          schema.collections,
          and(
            eq(schema.collections.id, schema.collectionBooks.collectionId),
            eq(schema.collections.userId, userId),
            eq(schema.collections.syncToKobo, true),
          ),
        )
        .where(inArray(schema.collectionBooks.bookId, fetchedBookIds)),
    ]);

    const authorsByBook = new Map<number, string[]>();
    for (const row of authorRows) {
      const names = authorsByBook.get(row.bookId) ?? [];
      names.push(row.name);
      authorsByBook.set(row.bookId, names);
    }

    const collectionsByBook = new Map<number, string[]>();
    for (const row of collectionRows) {
      const names = collectionsByBook.get(row.bookId) ?? [];
      if (!names.includes(row.name)) names.push(row.name);
      collectionsByBook.set(row.bookId, names);
    }

    const byId = new Map<number, KoboBookEntry>();
    for (const row of rows) {
      const authors = authorsByBook.get(row.bookId) ?? [];
      byId.set(row.bookId, {
        bookId: row.bookId,
        title: row.title ?? `Book ${row.bookId}`,
        authors,
        description: row.description,
        publisher: row.publisher,
        publishedYear: row.publishedYear,
        language: row.language,
        seriesName: row.seriesName,
        seriesIndex: row.seriesIndex,
        fileFormat: row.fileFormat ?? 'epub',
        fileSizeBytes: row.fileSizeBytes,
        fileHash: row.fileHash,
        metadataHash: this.buildMetadataHash({
          title: row.title,
          authors,
          seriesName: row.seriesName,
          seriesIndex: row.seriesIndex,
          metadataUpdatedAt: row.metadataUpdatedAt,
        }),
        metadataUpdatedAt: row.metadataUpdatedAt,
        collectionNames: collectionsByBook.get(row.bookId) ?? [],
        addedAt: row.addedAt,
        updatedAt: row.updatedAt,
      });
    }

    return byId;
  }
}
