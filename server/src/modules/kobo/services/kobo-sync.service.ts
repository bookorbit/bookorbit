import { createHash } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';
import { KoboReadingStateService } from './kobo-reading-state.service';

type Db = NodePgDatabase<typeof schema>;

const SYNC_PAGE_SIZE = 5;
const TOKEN_PREFIX = 'PX.';

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

    const eligibleBooks = await this.fetchEligibleBooks(userId);
    const eligibleIds = eligibleBooks.map((b) => b.bookId);

    if (!snapshot) {
      await this.createSnapshot(userId, eligibleBooks);
    } else {
      await this.reconcileSnapshot(snapshot.id, eligibleIds, eligibleBooks);
    }

    return this.getPageFromSnapshot(userId, deviceToken, baseUrl, settings);
  }

  async getBookMetadata(userId: number, bookId: number, deviceToken: string, baseUrl: string): Promise<unknown[]> {
    const book = await this.fetchBookById(bookId, userId);
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

  private async createSnapshot(userId: number, books: KoboBookEntry[]) {
    const [snap] = await this.db.insert(schema.koboLibrarySnapshots).values({ userId }).returning();
    if (books.length > 0) {
      await this.db.insert(schema.koboSnapshotBooks).values(
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
      );
    }
  }

  private async reconcileSnapshot(snapshotId: number, eligibleIds: number[], eligibleBooks: KoboBookEntry[]) {
    const existing = await this.db.select().from(schema.koboSnapshotBooks).where(eq(schema.koboSnapshotBooks.snapshotId, snapshotId));

    const existingMap = new Map(existing.map((r) => [r.bookId, r]));
    const eligibleMap = new Map(eligibleBooks.map((b) => [b.bookId, b]));

    for (const row of existing) {
      if (!eligibleMap.has(row.bookId) && !row.pendingDelete) {
        if (row.removedByDevice) {
          await this.db
            .delete(schema.koboSnapshotBooks)
            .where(and(eq(schema.koboSnapshotBooks.snapshotId, snapshotId), eq(schema.koboSnapshotBooks.bookId, row.bookId)));
        } else if (row.synced) {
          await this.db
            .update(schema.koboSnapshotBooks)
            .set({ pendingDelete: true, synced: false })
            .where(and(eq(schema.koboSnapshotBooks.snapshotId, snapshotId), eq(schema.koboSnapshotBooks.bookId, row.bookId)));
        } else {
          await this.db
            .delete(schema.koboSnapshotBooks)
            .where(and(eq(schema.koboSnapshotBooks.snapshotId, snapshotId), eq(schema.koboSnapshotBooks.bookId, row.bookId)));
        }
      }
    }

    for (const book of eligibleBooks) {
      const snap = existingMap.get(book.bookId);
      if (!snap) {
        await this.db.insert(schema.koboSnapshotBooks).values({
          snapshotId,
          bookId: book.bookId,
          synced: false,
          pendingDelete: false,
          isNew: true,
          removedByDevice: false,
          fileHash: book.fileHash,
          metadataHash: book.metadataHash,
        });
      } else if (!snap.removedByDevice && snap.synced && (snap.fileHash !== book.fileHash || snap.metadataHash !== book.metadataHash)) {
        await this.db
          .update(schema.koboSnapshotBooks)
          .set({ synced: false, isNew: false, fileHash: book.fileHash, metadataHash: book.metadataHash })
          .where(and(eq(schema.koboSnapshotBooks.snapshotId, snapshotId), eq(schema.koboSnapshotBooks.bookId, book.bookId)));
      }
    }
  }

  private async getPageFromSnapshot(
    userId: number,
    deviceToken: string,
    baseUrl: string,
    settings: SyncSettings,
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
      .limit(SYNC_PAGE_SIZE + 1);

    const hasMore = pending.length > SYNC_PAGE_SIZE;
    const page = pending.slice(0, SYNC_PAGE_SIZE);

    if (page.length === 0) {
      const endItems: unknown[] = [];

      if (settings.twoWayProgressSync) {
        const pushed = await this.readingStateService.getAndMarkStatesNeedingPush(userId, settings.readingThreshold, settings.finishedThreshold);
        endItems.push(...pushed);
      }

      const tagItems = await this.buildTagItems(userId);
      endItems.push(...tagItems);

      return { entitlements: endItems, hasMore: false, syncToken };
    }

    const pageIds = page.map((r) => r.bookId);
    await this.db
      .update(schema.koboSnapshotBooks)
      .set({ synced: true })
      .where(and(eq(schema.koboSnapshotBooks.snapshotId, snapshot.id), inArray(schema.koboSnapshotBooks.bookId, pageIds)));

    const entitlements: unknown[] = [];

    for (const row of page) {
      if (row.pendingDelete) {
        entitlements.push(this.buildRemovedEntitlement(row.bookId));
        await this.db
          .delete(schema.koboSnapshotBooks)
          .where(and(eq(schema.koboSnapshotBooks.snapshotId, snapshot.id), eq(schema.koboSnapshotBooks.bookId, row.bookId)));
        continue;
      }

      const book = await this.fetchBookById(row.bookId, userId);
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

  private async buildTagItems(userId: number): Promise<unknown[]> {
    const collections = await this.db.query.collections.findMany({
      where: and(eq(schema.collections.userId, userId), eq(schema.collections.syncToKobo, true)),
    });
    if (collections.length === 0) return [];

    const collectionIds = collections.map((c) => c.id);
    const eligibleBooks = await this.fetchEligibleBooks(userId);
    const eligibleIds = new Set(eligibleBooks.map((b) => b.bookId));

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

  private async fetchEligibleBooks(userId: number): Promise<KoboBookEntry[]> {
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
      .innerJoin(schema.bookFiles, and(eq(schema.bookFiles.bookId, schema.books.id), eq(schema.bookFiles.role, 'primary')))
      .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
      .innerJoin(schema.collectionBooks, eq(schema.collectionBooks.bookId, schema.books.id))
      .innerJoin(
        schema.collections,
        and(
          eq(schema.collections.id, schema.collectionBooks.collectionId),
          eq(schema.collections.userId, userId),
          eq(schema.collections.syncToKobo, true),
        ),
      )
      .where(and(eq(schema.books.status, 'present'), sql`lower(${schema.bookFiles.format}) in ('epub')`))
      .groupBy(
        schema.books.id,
        schema.bookMetadata.title,
        schema.bookMetadata.description,
        schema.bookMetadata.publisher,
        schema.bookMetadata.publishedYear,
        schema.bookMetadata.language,
        schema.bookMetadata.seriesName,
        schema.bookMetadata.seriesIndex,
        schema.bookFiles.format,
        schema.bookFiles.sizeBytes,
        schema.bookFiles.hash,
        schema.bookMetadata.updatedAt,
        schema.books.addedAt,
        schema.books.updatedAt,
      );

    if (rows.length === 0) return [];

    const bookIds = rows.map((r) => r.bookId);

    const authorRows = await this.db
      .select({ bookId: schema.bookAuthors.bookId, name: schema.authors.name })
      .from(schema.bookAuthors)
      .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
      .where(inArray(schema.bookAuthors.bookId, bookIds))
      .orderBy(schema.bookAuthors.displayOrder);

    const collectionRows = await this.db
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
      .where(inArray(schema.collectionBooks.bookId, bookIds));

    const authorsByBook = new Map<number, string[]>();
    for (const r of authorRows) {
      const list = authorsByBook.get(r.bookId) ?? [];
      list.push(r.name);
      authorsByBook.set(r.bookId, list);
    }

    const collectionsByBook = new Map<number, string[]>();
    for (const r of collectionRows) {
      const list = collectionsByBook.get(r.bookId) ?? [];
      if (!list.includes(r.name)) list.push(r.name);
      collectionsByBook.set(r.bookId, list);
    }

    return rows.map((r) => {
      const metaStr = [
        r.title ?? '',
        (authorsByBook.get(r.bookId) ?? []).join(','),
        r.seriesName ?? '',
        String(r.seriesIndex ?? ''),
        String(r.metadataUpdatedAt ?? ''),
      ].join('|');
      const metadataHash = createHash('sha256').update(metaStr).digest('hex').slice(0, 16);
      return {
        bookId: r.bookId,
        title: r.title ?? `Book ${r.bookId}`,
        authors: authorsByBook.get(r.bookId) ?? [],
        description: r.description,
        publisher: r.publisher,
        publishedYear: r.publishedYear,
        language: r.language,
        seriesName: r.seriesName,
        seriesIndex: r.seriesIndex,
        fileFormat: r.fileFormat ?? 'epub',
        fileSizeBytes: r.fileSizeBytes,
        fileHash: r.fileHash,
        metadataHash,
        metadataUpdatedAt: r.metadataUpdatedAt,
        collectionNames: collectionsByBook.get(r.bookId) ?? [],
        addedAt: r.addedAt,
        updatedAt: r.updatedAt,
      };
    });
  }

  private async fetchBookById(bookId: number, userId: number): Promise<KoboBookEntry | null> {
    const books = await this.fetchEligibleBooks(userId);
    return books.find((b) => b.bookId === bookId) ?? null;
  }
}
