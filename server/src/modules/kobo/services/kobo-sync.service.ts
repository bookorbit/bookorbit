import { createHash } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SQL, and, asc, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';
import { buildContentFilterClauses } from '../../../common/utils/content-filter-sql.utils';
import { ContentFilterRepository } from '../../user/content-filter.repository';
import { KoboBookAccessService } from './kobo-book-access.service';
import { KoboBookIdentityService } from './kobo-book-identity.service';
import { KoboReadingStateService } from './kobo-reading-state.service';

type Db = NodePgDatabase<typeof schema>;

const SYNC_PAGE_SIZE = 5;
const SNAPSHOT_RECONCILE_BATCH_SIZE = 5000;
const TOKEN_PREFIX = 'PX.';

type EligibleSnapshotRow = {
  bookId: number;
  fileHash: string | null;
  deliveryHash: string;
  metadataHash: string;
};

type KoboDeliverySettings = {
  convertToKepub: boolean;
  forceEnableHyphenation: boolean;
  kepubConversionLimitMb: number;
};

type KoboDeliveryFormat = 'EPUB3' | 'KEPUB' | 'PDF';

type KoboDeliveryInfo = {
  format: KoboDeliveryFormat;
  hash: string;
};

export interface KoboBookEntry {
  bookId: number;
  koboEntitlementId: string;
  koboCoverImageId: string;
  needsLegacyNumericRemoval: boolean;
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
  deliveryFormat: KoboDeliveryFormat;
  metadataUpdatedAt: Date | null;
  collectionNames: string[];
  addedAt: Date;
  updatedAt: Date;
}

function encodeSyncToken(snapshotId: number): string {
  return TOKEN_PREFIX + Buffer.from(JSON.stringify({ snapshotId })).toString('base64');
}

@Injectable()
export class KoboSyncService {
  private readonly logger = new Logger(KoboSyncService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly bookAccessService: KoboBookAccessService,
    private readonly readingStateService: KoboReadingStateService,
    private readonly contentFilterRepository: ContentFilterRepository,
    private readonly bookIdentityService: KoboBookIdentityService,
  ) {}

  async getDelta(userId: number, deviceToken: string, baseUrl: string): Promise<{ entitlements: unknown[]; hasMore: boolean; syncToken: string }> {
    const snapshot = await this.db.query.koboLibrarySnapshots.findFirst({
      where: eq(schema.koboLibrarySnapshots.userId, userId),
    });

    const hadSnapshot = Boolean(snapshot);
    const eligibleSnapshotRows = await this.fetchEligibleSnapshotRows(userId, hadSnapshot);

    if (!snapshot) {
      await this.createSnapshot(userId, eligibleSnapshotRows);
    } else {
      await this.reconcileSnapshot(snapshot.id, eligibleSnapshotRows);
    }

    return this.getPageFromSnapshot(userId, deviceToken, baseUrl, new Set(eligibleSnapshotRows.map((row) => row.bookId)));
  }

  async getBookMetadata(userId: number, bookId: number, deviceToken: string, baseUrl: string): Promise<unknown[]> {
    const snapshot = await this.db.query.koboLibrarySnapshots.findFirst({
      where: eq(schema.koboLibrarySnapshots.userId, userId),
      columns: { id: true },
    });
    const booksById = await this.fetchEligibleBooksByIds(userId, [bookId], Boolean(snapshot));
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
    const start = Date.now();
    const snapshot = await this.db.query.koboLibrarySnapshots.findFirst({
      where: eq(schema.koboLibrarySnapshots.userId, userId),
    });
    if (!snapshot) return;

    const resetRows = await this.db
      .update(schema.koboSnapshotBooks)
      .set({ synced: false })
      .where(and(eq(schema.koboSnapshotBooks.snapshotId, snapshot.id), eq(schema.koboSnapshotBooks.synced, true)))
      .returning({ bookId: schema.koboSnapshotBooks.bookId });

    this.logger.debug(
      `[kobo.snapshot.invalidate] [end] userId=${userId} snapshotId=${snapshot.id} durationMs=${Date.now() - start} resetSyncedCount=${resetRows.length} - snapshot invalidated`,
    );
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
            deliveryHash: b.deliveryHash,
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
          delivery_hash varchar(64) NOT NULL,
          metadata_hash varchar(64) NOT NULL
        ) ON COMMIT DROP
      `);

      for (let index = 0; index < eligibleBooks.length; index += SNAPSHOT_RECONCILE_BATCH_SIZE) {
        const chunk = eligibleBooks.slice(index, index + SNAPSHOT_RECONCILE_BATCH_SIZE);
        const valueRows = sql.join(
          chunk.map((b) => sql`(${b.bookId}, ${b.fileHash}, ${b.deliveryHash}, ${b.metadataHash})`),
          sql`, `,
        );

        await tx.execute(sql`
          INSERT INTO kobo_eligible_books_tmp (book_id, file_hash, delivery_hash, metadata_hash)
          VALUES ${valueRows}
          ON CONFLICT (book_id)
          DO UPDATE
          SET file_hash = EXCLUDED.file_hash,
              delivery_hash = EXCLUDED.delivery_hash,
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
          (snapshot_id, book_id, synced, pending_delete, is_new, removed_by_device, file_hash, delivery_hash, metadata_hash)
        SELECT ${snapshotId}, e.book_id, false, false, true, false, e.file_hash, e.delivery_hash, e.metadata_hash
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
            delivery_hash = e.delivery_hash,
            metadata_hash = e.metadata_hash
        FROM kobo_eligible_books_tmp e
        WHERE sb.snapshot_id = ${snapshotId}
          AND sb.book_id = e.book_id
          AND sb.pending_delete = true
          AND sb.removed_by_device = false
      `);

      await tx.execute(sql`
        UPDATE ${schema.koboSnapshotBooks} AS sb
        SET removed_by_device = false,
            synced = false,
            is_new = true,
            file_hash = e.file_hash,
            delivery_hash = e.delivery_hash,
            metadata_hash = e.metadata_hash
        FROM kobo_eligible_books_tmp e
        WHERE sb.snapshot_id = ${snapshotId}
          AND sb.book_id = e.book_id
          AND sb.removed_by_device = true
          AND sb.synced = true
          AND sb.pending_delete = false
      `);

      await tx.execute(sql`
        UPDATE ${schema.koboSnapshotBooks} AS sb
        SET delivery_hash = e.delivery_hash
        FROM kobo_eligible_books_tmp e
        WHERE sb.snapshot_id = ${snapshotId}
          AND sb.book_id = e.book_id
          AND sb.pending_delete = false
          AND sb.removed_by_device = false
          AND sb.delivery_hash IS NULL
          AND sb.file_hash IS NOT DISTINCT FROM e.file_hash
      `);

      await tx.execute(sql`
        UPDATE ${schema.koboSnapshotBooks} AS sb
        SET synced = false,
            is_new = true,
            file_hash = e.file_hash,
            delivery_hash = e.delivery_hash,
            metadata_hash = e.metadata_hash
        FROM kobo_eligible_books_tmp e
        WHERE sb.snapshot_id = ${snapshotId}
          AND sb.book_id = e.book_id
          AND sb.pending_delete = false
          AND sb.removed_by_device = false
          AND sb.synced = true
          AND (sb.file_hash IS DISTINCT FROM e.file_hash OR sb.delivery_hash IS DISTINCT FROM e.delivery_hash)
      `);

      await tx.execute(sql`
        UPDATE ${schema.koboSnapshotBooks} AS sb
        SET synced = false,
            is_new = false,
            file_hash = e.file_hash,
            delivery_hash = e.delivery_hash,
            metadata_hash = e.metadata_hash
        FROM kobo_eligible_books_tmp e
        WHERE sb.snapshot_id = ${snapshotId}
          AND sb.book_id = e.book_id
          AND sb.pending_delete = false
          AND sb.removed_by_device = false
          AND sb.synced = true
          AND sb.file_hash IS NOT DISTINCT FROM e.file_hash
          AND sb.delivery_hash IS NOT DISTINCT FROM e.delivery_hash
          AND sb.metadata_hash IS DISTINCT FROM e.metadata_hash
      `);
    });
  }

  private async getPageFromSnapshot(
    userId: number,
    deviceToken: string,
    baseUrl: string,
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
      const tagItems = await this.buildTagItems(userId, eligibleIds);
      return { entitlements: tagItems, hasMore: false, syncToken };
    }

    const pageIds = page.map((r) => r.bookId);
    await this.db
      .update(schema.koboSnapshotBooks)
      .set({ synced: true })
      .where(and(eq(schema.koboSnapshotBooks.snapshotId, snapshot.id), inArray(schema.koboSnapshotBooks.bookId, pageIds)));

    const entitlements: unknown[] = [];
    const identitiesById = await this.bookIdentityService.findByBookIds(
      userId,
      page.map((row) => row.bookId),
    );
    const legacyRemovalCompletedBookIds: number[] = [];
    const booksById = await this.fetchEligibleBooksByIds(
      userId,
      page.filter((row) => !row.pendingDelete).map((row) => row.bookId),
      false,
    );

    for (const row of page) {
      if (row.pendingDelete) {
        const identity = identitiesById.get(row.bookId) ?? null;
        if (identity) {
          if (identity.needsLegacyNumericRemoval) {
            entitlements.push(this.buildRemovedEntitlement(row.bookId));
            legacyRemovalCompletedBookIds.push(row.bookId);
          }
          entitlements.push(this.buildRemovedEntitlement(identity.entitlementId));
        } else {
          entitlements.push(this.buildRemovedEntitlement(row.bookId));
        }
        await this.db
          .delete(schema.koboSnapshotBooks)
          .where(and(eq(schema.koboSnapshotBooks.snapshotId, snapshot.id), eq(schema.koboSnapshotBooks.bookId, row.bookId)));
        continue;
      }

      const book = booksById.get(row.bookId) ?? null;
      if (!book) continue;

      const readingState = await this.readingStateService.getRawState(userId, row.bookId);
      const defaultReadingState = readingState ?? this.buildDefaultReadingState(book.koboEntitlementId);

      if (row.isNew || book.needsLegacyNumericRemoval) {
        if (book.needsLegacyNumericRemoval) {
          entitlements.push(this.buildRemovedEntitlement(row.bookId));
          legacyRemovalCompletedBookIds.push(row.bookId);
        }
        entitlements.push({
          NewEntitlement: {
            BookEntitlement: this.buildBookEntitlement(book),
            BookMetadata: this.buildBookMetadata(book, deviceToken, baseUrl),
            ReadingState: defaultReadingState,
          },
        });
      } else {
        entitlements.push({
          ChangedProductMetadata: {
            BookEntitlement: this.buildBookEntitlement(book),
            BookMetadata: this.buildBookMetadata(book, deviceToken, baseUrl),
          },
        });
        if (readingState) {
          entitlements.push({
            ChangedReadingState: {
              ReadingState: readingState,
            },
          });
        }
      }
    }

    await this.bookIdentityService.markLegacyNumericRemovalComplete(userId, legacyRemovalCompletedBookIds);

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
    const allEligibleBookIds = [...eligibleIds];
    const identitiesById = await this.bookIdentityService.ensureForBooks(userId, allEligibleBookIds, false);
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
            Items: bookIds.flatMap((bookId) => {
              const identity = identitiesById.get(bookId);
              return identity ? [{ RevisionId: identity.entitlementId, Type: 'ProductRevisionTagItem' }] : [];
            }),
          },
        },
      };
    });
  }

  private buildRemovedEntitlement(bookId: number | string) {
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
    const id = book.koboEntitlementId;
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
    const id = book.koboEntitlementId;
    const downloadUrl = `${baseUrl}/api/v1/kobo/${deviceToken}/v1/books/${id}/download`;
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
      CoverImageId: book.koboCoverImageId,
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
      DownloadUrls: [{ Format: book.deliveryFormat, Size: book.fileSizeBytes ?? 0, Url: downloadUrl, Platform: 'Generic', DrmType: 'None' }],
    };
  }

  private buildDefaultReadingState(entitlementId: string) {
    const id = entitlementId;
    const now = new Date().toISOString();
    return {
      EntitlementId: id,
      Created: now,
      LastModified: now,
      PriorityTimestamp: now,
      StatusInfo: { LastModified: now, Status: 'ReadyToRead', TimesStartedReading: 0 },
      Statistics: { LastModified: now },
      CurrentBookmark: { LastModified: now, ProgressPercent: 0 },
    };
  }

  private buildMetadataHash(params: {
    title: string | null;
    authors: string[];
    seriesName: string | null;
    seriesIndex: number | null;
    metadataUpdatedAt: Date | null;
    entitlementId: string;
    coverImageId: string;
  }): string {
    const metaStr = [
      params.title ?? '',
      params.authors.join(','),
      params.seriesName ?? '',
      String(params.seriesIndex ?? ''),
      String(params.metadataUpdatedAt ?? ''),
      params.entitlementId,
      params.coverImageId,
    ].join('|');
    return createHash('sha256').update(metaStr).digest('hex').slice(0, 16);
  }

  private buildDeliveryHash(format: KoboDeliveryFormat, hyphenate: boolean): string {
    return createHash('sha256')
      .update([format, format === 'KEPUB' && hyphenate ? 'hyphenate' : 'plain'].join('|'))
      .digest('hex')
      .slice(0, 16);
  }

  private getDeliveryInfo(fileFormat: string | null, fileSizeBytes: number | null, settings: KoboDeliverySettings): KoboDeliveryInfo {
    const normalizedFormat = (fileFormat ?? 'epub').toLowerCase();

    if (normalizedFormat === 'pdf') {
      return { format: 'PDF', hash: this.buildDeliveryHash('PDF', false) };
    }

    if (normalizedFormat === 'kepub') {
      return { format: 'KEPUB', hash: this.buildDeliveryHash('KEPUB', false) };
    }

    if (normalizedFormat === 'epub') {
      const limitBytes = settings.kepubConversionLimitMb * 1024 * 1024;
      const withinLimit = !fileSizeBytes || fileSizeBytes <= limitBytes;

      if (settings.convertToKepub && withinLimit) {
        return { format: 'KEPUB', hash: this.buildDeliveryHash('KEPUB', settings.forceEnableHyphenation) };
      }
    }

    return { format: 'EPUB3', hash: this.buildDeliveryHash('EPUB3', false) };
  }

  private async getDeliverySettings(userId: number): Promise<KoboDeliverySettings> {
    const settings = await this.db.query.koboSyncSettings.findFirst({
      where: eq(schema.koboSyncSettings.userId, userId),
      columns: {
        convertToKepub: true,
        forceEnableHyphenation: true,
        kepubConversionLimitMb: true,
        twoWayProgressSync: true,
      },
    });

    return {
      convertToKepub: settings?.twoWayProgressSync ? true : (settings?.convertToKepub ?? true),
      forceEnableHyphenation: settings?.forceEnableHyphenation ?? false,
      kepubConversionLimitMb: settings?.kepubConversionLimitMb ?? 100,
    };
  }

  private async buildEligibleBooksWhereClause(userId: number): Promise<SQL | undefined> {
    const [accessibleLibraryIds, contentFilters] = await Promise.all([
      this.bookAccessService.getAccessibleLibraryIds(userId),
      this.contentFilterRepository.findByUserId(userId),
    ]);

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

    const contentFilterClauses = accessibleLibraryIds !== null ? buildContentFilterClauses(contentFilters, this.db) : [];

    return and(
      eq(schema.books.status, 'present'),
      inArray(schema.bookFiles.format, ['epub', 'kepub']),
      libraryAccessFilter,
      collectionMembershipFilter,
      ...contentFilterClauses,
    );
  }

  private async fetchEligibleSnapshotRows(userId: number, needsLegacyNumericRemovalForNewMappings: boolean): Promise<EligibleSnapshotRow[]> {
    const whereClause = await this.buildEligibleBooksWhereClause(userId);
    if (!whereClause) return [];
    const deliverySettings = await this.getDeliverySettings(userId);

    const rows = await this.db
      .select({
        bookId: schema.books.id,
        title: schema.bookMetadata.title,
        seriesName: schema.bookMetadata.seriesName,
        seriesIndex: schema.bookMetadata.seriesIndex,
        metadataUpdatedAt: schema.bookMetadata.updatedAt,
        fileFormat: schema.bookFiles.format,
        fileSizeBytes: schema.bookFiles.sizeBytes,
        fileHash: schema.bookFiles.fileHash,
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
        schema.bookFiles.format,
        schema.bookFiles.sizeBytes,
        schema.bookFiles.fileHash,
      );

    const identitiesById = await this.bookIdentityService.ensureForBooks(
      userId,
      rows.map((row) => row.bookId),
      needsLegacyNumericRemovalForNewMappings,
    );

    return rows.map((row) => {
      const delivery = this.getDeliveryInfo(row.fileFormat, row.fileSizeBytes, deliverySettings);
      const identity = identitiesById.get(row.bookId);
      const coverImageId = identity
        ? this.bookIdentityService.buildVersionedCoverImageId(identity.coverImageId, row.metadataUpdatedAt)
        : String(row.bookId);
      return {
        bookId: row.bookId,
        fileHash: row.fileHash,
        deliveryHash: delivery.hash,
        metadataHash: this.buildMetadataHash({
          title: row.title,
          authors: row.authorNamesCsv ? row.authorNamesCsv.split(',').filter((name) => name.length > 0) : [],
          seriesName: row.seriesName,
          seriesIndex: row.seriesIndex,
          metadataUpdatedAt: row.metadataUpdatedAt,
          entitlementId: identity?.entitlementId ?? String(row.bookId),
          coverImageId,
        }),
      };
    });
  }

  private async fetchEligibleBooksByIds(
    userId: number,
    bookIds: number[],
    needsLegacyNumericRemovalForNewMappings: boolean,
  ): Promise<Map<number, KoboBookEntry>> {
    const uniqueBookIds = [...new Set(bookIds)];
    if (uniqueBookIds.length === 0) return new Map();

    const whereClause = await this.buildEligibleBooksWhereClause(userId);
    if (!whereClause) return new Map();
    const deliverySettings = await this.getDeliverySettings(userId);

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
        fileHash: schema.bookFiles.fileHash,
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

    const identitiesById = await this.bookIdentityService.ensureForBooks(userId, fetchedBookIds, needsLegacyNumericRemovalForNewMappings);
    const byId = new Map<number, KoboBookEntry>();
    for (const row of rows) {
      const authors = authorsByBook.get(row.bookId) ?? [];
      const delivery = this.getDeliveryInfo(row.fileFormat, row.fileSizeBytes, deliverySettings);
      const identity = identitiesById.get(row.bookId);
      if (!identity) continue;
      const coverImageId = this.bookIdentityService.buildVersionedCoverImageId(identity.coverImageId, row.metadataUpdatedAt);
      byId.set(row.bookId, {
        bookId: row.bookId,
        koboEntitlementId: identity.entitlementId,
        koboCoverImageId: coverImageId,
        needsLegacyNumericRemoval: identity.needsLegacyNumericRemoval,
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
        deliveryFormat: delivery.format,
        metadataHash: this.buildMetadataHash({
          title: row.title,
          authors,
          seriesName: row.seriesName,
          seriesIndex: row.seriesIndex,
          metadataUpdatedAt: row.metadataUpdatedAt,
          entitlementId: identity.entitlementId,
          coverImageId,
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
