import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { basename, dirname, extname, join } from 'path';
import { access as fsAccess, readFile, stat, unlink } from 'fs/promises';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { BookDockAutoFinalizeMetadataMode, BookDockFinalizeFileResult, BookDockFinalizeResult, BookDockMetadata } from '@bookorbit/types';
import { NotificationType, resolveUploadPath } from '@bookorbit/types';
import { NotificationService } from '../notification/notification.service';
import { SeriesIdentityService } from '../../common/services/series-identity.service';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookMetadata, books, libraries, libraryFolders } from '../../db/schema';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { LibraryService } from '../library/library.service';
import { MetadataService } from '../metadata/metadata.service';
import { UploadProcessorService } from '../upload/upload-processor.service';
import { UploadStorageService } from '../upload/upload-storage.service';
import { UploadValidatorService } from '../upload/upload-validator.service';
import { BookDockRepository } from './book-dock.repository';
import { BookDockEventsService, BOOK_DOCK_FILE_INGESTED } from './book-dock-events.service';
import { BookDockGateway } from './book-dock.gateway';
import type { BookDockFileRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const BATCH_SIZE = 100;
const MIN_PUBLISHED_YEAR = 1000;
const MAX_PUBLISHED_YEAR = 2200;
const PUBLISHED_YEAR_RANGE_CONSTRAINT = 'book_metadata_published_year_range_chk';
const INVALID_PUBLISHED_YEAR_MESSAGE = `Invalid metadata: published year must be between ${MIN_PUBLISHED_YEAR} and ${MAX_PUBLISHED_YEAR}.`;
const INVALID_METADATA_MESSAGE = 'Invalid metadata values for this file. Review metadata fields and try again.';

type NormalizedFinalizeMetadata = {
  title: string | null;
  subtitle: string | null;
  description: string | null;
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  authors: string[];
  genres: string[];
  coverUrl: string | null;
};

@Injectable()
export class BookDockFinalizeService implements OnModuleInit {
  private readonly logger = new Logger(BookDockFinalizeService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: BookDockRepository,
    private readonly libraryService: LibraryService,
    private readonly appSettings: AppSettingsService,
    private readonly metadataService: MetadataService,
    private readonly validator: UploadValidatorService,
    private readonly storage: UploadStorageService,
    private readonly processor: UploadProcessorService,
    private readonly events: BookDockEventsService,
    private readonly gateway: BookDockGateway,
    private readonly notificationService: NotificationService,
    @Optional() private readonly seriesIdentity?: SeriesIdentityService,
  ) {}

  onModuleInit() {
    this.events.on(BOOK_DOCK_FILE_INGESTED, (fileId: number) => {
      void this.triggerAutoFinalize(fileId);
    });
  }

  async finalize(
    userId: number,
    isSuperuser: boolean,
    fileIds: number[] | undefined,
    selectAll: boolean | undefined,
    excludedIds: number[] | undefined,
    defaultLibraryId: number | undefined,
    defaultFolderId: number | undefined,
    overrides?: Array<{ fileId: number; libraryId?: number; folderId?: number }>,
    status?: string,
    search?: string,
  ): Promise<BookDockFinalizeResult> {
    const ids = selectAll ? [] : dedupeIds(fileIds ?? []);
    const overrideMap = new Map((overrides ?? []).map((o) => [o.fileId, o]));

    const results: BookDockFinalizeFileResult[] = [];
    let succeeded = 0;
    let failed = 0;

    if (selectAll) {
      let afterId: number | undefined;
      while (true) {
        const rows = await this.repo.findSelectionBatch({
          limit: BATCH_SIZE,
          afterId,
          excludedIds,
          status,
          search,
          userId,
          isSuperuser,
        });
        if (rows.length === 0) break;

        const duplicateLookup = await this.buildDuplicateLookup(rows, defaultLibraryId, overrideMap);
        for (const row of rows) {
          const result = await this.finalizeFile(row, defaultLibraryId, defaultFolderId, overrideMap, userId, isSuperuser, duplicateLookup);
          results.push(result);
          if (result.success) succeeded++;
          else failed++;
        }

        afterId = rows[rows.length - 1]?.id;
      }
    } else {
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        const rows = await this.repo.findByIds(batch);
        const rowById = new Map(rows.map((row) => [row.id, row]));
        const duplicateLookup = await this.buildDuplicateLookup(rows, defaultLibraryId, overrideMap);

        for (const fileId of batch) {
          const row = rowById.get(fileId);
          if (!row) {
            failed++;
            results.push({
              fileId,
              fileName: `book-dock-file-${fileId}`,
              success: false,
              message: 'Book Dock file not found',
            });
            continue;
          }

          const result = await this.finalizeFile(row, defaultLibraryId, defaultFolderId, overrideMap, userId, isSuperuser, duplicateLookup);
          results.push(result);
          if (result.success) succeeded++;
          else failed++;
        }
      }
    }

    await this.emitSummary();

    this.notificationService
      .notify({
        type: NotificationType.BookDockFinalized,
        title: 'Book Dock finalization completed',
        message: `${succeeded} succeeded, ${failed} failed`,
        scope: { kind: 'user', userId },
        meta: { total: results.length, succeeded, failed },
      })
      .catch(() => {});

    return { total: results.length, succeeded, failed, results };
  }

  private async finalizeFile(
    row: BookDockFileRow,
    defaultLibraryId: number | undefined,
    defaultFolderId: number | undefined,
    overrideMap: Map<number, { libraryId?: number; folderId?: number }>,
    userId: number,
    isSuperuser: boolean,
    duplicateLookup?: Map<string, number>,
  ): Promise<BookDockFinalizeFileResult> {
    try {
      const override = overrideMap.get(row.id);
      const libraryId = override?.libraryId ?? row.targetLibraryId ?? defaultLibraryId ?? null;
      const folderId = override?.folderId ?? row.targetFolderId ?? defaultFolderId ?? null;

      if (libraryId === null || folderId === null) {
        return {
          fileId: row.id,
          fileName: row.fileName,
          success: false,
          message: 'Destination is not set for this file',
        };
      }

      const library = await this.findLibraryOrFail(libraryId);
      await this.libraryService.verifyUserAccess(userId, libraryId, isSuperuser);

      const folder = await this.findFolderOrFail(folderId, libraryId);
      const format = row.format ?? extname(row.fileName).toLowerCase().slice(1);
      this.validator.validateFormat(row.fileName, library.allowedFormats);

      const destPath = await this.resolveDestination(library, folder.path, row, format);

      const exists = await fsAccess(destPath)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        return { fileId: row.id, fileName: row.fileName, success: false, message: 'A file with this name already exists at the target location' };
      }

      const meta = normalizeFinalizeMetadata(row.selectedMetadata ?? row.embeddedMetadata ?? {});
      const existingBookId = await this.findDuplicate(libraryId, meta, duplicateLookup);
      if (existingBookId !== null) {
        return {
          fileId: row.id,
          fileName: row.fileName,
          success: false,
          isDuplicate: true,
          existingBookId,
          message: `Duplicate: this book already exists in the library`,
        };
      }

      await this.storage.moveToPath(row.absolutePath, destPath);

      let bookId: number;
      try {
        const { size } = await stat(destPath);
        const bookFolderPath = library.organizationMode === 'book_per_file' ? destPath : dirname(destPath);
        ({ bookId } = await this.processor.createBookRecord(
          libraryId,
          folder.id,
          bookFolderPath,
          destPath,
          destPath.substring(folder.path.length + 1),
          format,
          size,
        ));
        await this.applyMetadata(bookId, row);
      } catch (err) {
        await this.storage.moveToPath(destPath, row.absolutePath).catch(() => {});
        throw err;
      }

      await this.cleanupBookDockRecord(row);

      const newName = destPath.substring(folder.path.length + 1);
      return { fileId: row.id, fileName: row.fileName, newName, success: true, bookId };
    } catch (err) {
      const message = resolveFinalizeErrorMessage(err);
      this.logger.warn(`Finalize failed for Book Dock file ${row.id}: ${message}`);
      return { fileId: row.id, fileName: row.fileName, success: false, message };
    }
  }

  async triggerAutoFinalize(fileId: number): Promise<void> {
    const settings = await this.appSettings.getAutoFinalizeSettings();
    if (!settings.enabled || settings.libraryId === null || settings.folderId === null) return;

    const row = await this.repo.findById(fileId);
    if (!row) return;
    if (!shouldAutoFinalize(row, settings.metadataMode, settings.threshold)) return;

    const autoFinalizeMetadata = resolveAutoFinalizeMetadata(settings.metadataMode, row.embeddedMetadata, row.fetchedMetadata, row.selectedMetadata);
    const rowForFinalize = autoFinalizeMetadata
      ? {
          ...row,
          selectedMetadata: autoFinalizeMetadata,
        }
      : row;

    const result = await this.finalizeFile(rowForFinalize, settings.libraryId, settings.folderId, new Map(), 0, true);
    if (result.success) {
      this.logger.log(`Auto-finalized Book Dock file ${fileId} -> book ${result.bookId} (confidence ${row.confidence}%)`);
      await this.emitSummary();

      this.notificationService
        .notify({
          type: NotificationType.BookDockFinalized,
          title: 'Book auto-finalized',
          message: `"${row.fileName}" was added to your library`,
          scope: row.uploadedBy ? { kind: 'user', userId: row.uploadedBy } : { kind: 'all' },
          meta: { fileId, bookId: result.bookId },
        })
        .catch(() => {});
    } else {
      this.logger.warn(`Auto-finalize skipped for Book Dock file ${fileId}: ${result.message}`);
    }
  }

  async previewNames(
    fileIds: number[] | undefined,
    selectAll: boolean | undefined,
    excludedIds: number[] | undefined,
    defaultLibraryId: number | undefined,
    status?: string,
    search?: string,
  ): Promise<{ fileId: number; fileName: string; newName: string }[]> {
    const ids = selectAll ? await this.repo.findAllIds(excludedIds, status, search) : (fileIds ?? []);
    if (!ids.length) return [];

    const rows = await this.repo.findByIds(ids);
    const appPatternFile = await this.appSettings.getUploadPattern();
    const appPatternFolder = await this.appSettings.getUploadPatternBookPerFolder();
    const sanitizeForCrossPlatform = await this.appSettings.isCrossPlatformPathSanitizationEnabled();
    const libraryIds = [...new Set(rows.map((row) => row.targetLibraryId ?? defaultLibraryId).filter((id): id is number => id != null))];
    const libraryMap = libraryIds.length
      ? new Map((await this.db.select().from(libraries).where(inArray(libraries.id, libraryIds))).map((lib) => [lib.id, lib]))
      : new Map<number, typeof libraries.$inferSelect>();

    return rows.map((row) => {
      const format = row.format ?? extname(row.fileName).toLowerCase().slice(1);
      const meta = row.selectedMetadata ?? row.embeddedMetadata ?? {};
      let newName = row.fileName;
      const effectiveLibraryId = row.targetLibraryId ?? defaultLibraryId ?? null;
      const lib = effectiveLibraryId !== null ? libraryMap.get(effectiveLibraryId) : undefined;
      const libraryPattern = lib?.fileNamingPattern ?? null;
      const appPattern = lib?.organizationMode === 'book_per_folder' ? appPatternFolder : appPatternFile;
      const pattern = libraryPattern ?? appPattern;

      if (pattern) {
        const tokens = this.buildPatternTokens(meta, row.fileName, format);
        const resolved = resolveUploadPath(pattern, tokens, format, { sanitizeForCrossPlatform });
        if (resolved) newName = resolved;
      }

      return { fileId: row.id, fileName: row.fileName, newName };
    });
  }

  private async buildDuplicateLookup(
    rows: BookDockFileRow[],
    defaultLibraryId: number | undefined,
    overrideMap: Map<number, { libraryId?: number; folderId?: number }>,
  ): Promise<Map<string, number>> {
    const needsByLibrary = new Map<
      number,
      { isbn13: Set<string>; isbn10: Set<string>; titles: Set<string>; authors: Set<string>; titleAuthorPairs: Set<string> }
    >();

    for (const row of rows) {
      const override = overrideMap.get(row.id);
      const libraryId = override?.libraryId ?? row.targetLibraryId ?? defaultLibraryId ?? null;
      if (libraryId === null) continue;

      const meta = normalizeFinalizeMetadata(row.selectedMetadata ?? row.embeddedMetadata ?? {});
      let bucket = needsByLibrary.get(libraryId);
      if (!bucket) {
        bucket = { isbn13: new Set(), isbn10: new Set(), titles: new Set(), authors: new Set(), titleAuthorPairs: new Set() };
        needsByLibrary.set(libraryId, bucket);
      }

      if (meta.isbn13) {
        bucket.isbn13.add(meta.isbn13);
      } else if (meta.isbn10) {
        bucket.isbn10.add(meta.isbn10);
      } else if (meta.title) {
        const normalizedAuthors = normalizeDuplicateAuthors(meta.authors);
        if (normalizedAuthors.length === 0) continue;
        bucket.titles.add(meta.title.toLowerCase());
        for (const authorName of normalizedAuthors) {
          bucket.authors.add(authorName);
          bucket.titleAuthorPairs.add(`${meta.title.toLowerCase()}|${authorName}`);
        }
      }
    }

    const lookup = new Map<string, number>();
    for (const [libraryId, values] of needsByLibrary) {
      if (values.isbn13.size > 0) {
        const rowsByIsbn13 = await this.db
          .select({ bookId: bookMetadata.bookId, isbn13: bookMetadata.isbn13 })
          .from(bookMetadata)
          .innerJoin(books, eq(books.id, bookMetadata.bookId))
          .where(and(eq(books.libraryId, libraryId), inArray(bookMetadata.isbn13, [...values.isbn13])));
        for (const row of rowsByIsbn13) {
          if (!row.isbn13) continue;
          const key = this.buildDuplicateLookupKey(libraryId, { isbn13: row.isbn13, isbn10: null, title: null });
          if (key && !lookup.has(key)) {
            lookup.set(key, row.bookId);
          }
        }
      }

      if (values.isbn10.size > 0) {
        const rowsByIsbn10 = await this.db
          .select({ bookId: bookMetadata.bookId, isbn10: bookMetadata.isbn10 })
          .from(bookMetadata)
          .innerJoin(books, eq(books.id, bookMetadata.bookId))
          .where(and(eq(books.libraryId, libraryId), inArray(bookMetadata.isbn10, [...values.isbn10])));
        for (const row of rowsByIsbn10) {
          if (!row.isbn10) continue;
          const key = this.buildDuplicateLookupKey(libraryId, { isbn13: null, isbn10: row.isbn10, title: null });
          if (key && !lookup.has(key)) {
            lookup.set(key, row.bookId);
          }
        }
      }

      if (values.titles.size > 0 && values.authors.size > 0) {
        const rowsByTitleAuthor = await this.db
          .select({
            bookId: bookMetadata.bookId,
            normalizedTitle: sql<string>`lower(${bookMetadata.title})`,
            normalizedAuthor: sql<string>`lower(${authors.name})`,
          })
          .from(bookMetadata)
          .innerJoin(books, eq(books.id, bookMetadata.bookId))
          .innerJoin(bookAuthors, eq(bookAuthors.bookId, bookMetadata.bookId))
          .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
          .where(
            and(
              eq(books.libraryId, libraryId),
              inArray(sql<string>`lower(${bookMetadata.title})`, [...values.titles]),
              inArray(sql<string>`lower(${authors.name})`, [...values.authors]),
            ),
          );
        for (const row of rowsByTitleAuthor) {
          if (!row.normalizedTitle || !row.normalizedAuthor) continue;
          const pairKey = `${row.normalizedTitle}|${row.normalizedAuthor}`;
          if (!values.titleAuthorPairs.has(pairKey)) continue;
          const key = this.buildDuplicateLookupKey(libraryId, {
            isbn13: null,
            isbn10: null,
            title: row.normalizedTitle,
            author: row.normalizedAuthor,
          });
          if (key && !lookup.has(key)) {
            lookup.set(key, row.bookId);
          }
        }
      }
    }

    return lookup;
  }

  private buildDuplicateLookupKey(
    libraryId: number,
    meta: { isbn13: string | null; isbn10: string | null; title: string | null; author?: string | null },
  ): string | null {
    const isbn = meta.isbn13 ?? meta.isbn10;
    if (isbn) {
      const isbnKind = meta.isbn13 ? 'isbn13' : 'isbn10';
      return `library:${libraryId}|${isbnKind}:${isbn}`;
    }
    if (meta.title && meta.author) {
      return `library:${libraryId}|title:${meta.title.toLowerCase()}|author:${meta.author.toLowerCase()}`;
    }
    return null;
  }

  private async findDuplicate(
    libraryId: number,
    meta: Pick<NormalizedFinalizeMetadata, 'isbn13' | 'isbn10' | 'title' | 'authors'>,
    duplicateLookup?: Map<string, number>,
  ): Promise<number | null> {
    const isbn = meta.isbn13 ?? meta.isbn10;

    if (isbn) {
      const lookupKey = this.buildDuplicateLookupKey(libraryId, { isbn13: meta.isbn13, isbn10: meta.isbn10, title: null, author: null });
      if (lookupKey && duplicateLookup?.has(lookupKey)) {
        return duplicateLookup.get(lookupKey) ?? null;
      }

      const conditions = meta.isbn13 ? [eq(bookMetadata.isbn13, meta.isbn13)] : [eq(bookMetadata.isbn10, meta.isbn10!)];

      const [existing] = await this.db
        .select({ bookId: bookMetadata.bookId })
        .from(bookMetadata)
        .innerJoin(books, eq(books.id, bookMetadata.bookId))
        .where(and(eq(books.libraryId, libraryId), or(...conditions)))
        .limit(1);

      if (existing) return existing.bookId;
    }

    if (!isbn && meta.title) {
      const normalizedAuthors = normalizeDuplicateAuthors(meta.authors);
      if (normalizedAuthors.length === 0) return null;

      for (const authorName of normalizedAuthors) {
        const lookupKey = this.buildDuplicateLookupKey(libraryId, {
          isbn13: null,
          isbn10: null,
          title: meta.title,
          author: authorName,
        });
        if (lookupKey && duplicateLookup?.has(lookupKey)) {
          return duplicateLookup.get(lookupKey) ?? null;
        }
      }

      const [existing] = await this.db
        .select({ bookId: bookMetadata.bookId })
        .from(bookMetadata)
        .innerJoin(books, eq(books.id, bookMetadata.bookId))
        .innerJoin(bookAuthors, eq(bookAuthors.bookId, bookMetadata.bookId))
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(
          and(
            eq(books.libraryId, libraryId),
            sql`lower(${bookMetadata.title}) = lower(${meta.title})`,
            inArray(sql<string>`lower(${authors.name})`, normalizedAuthors),
          ),
        )
        .limit(1);

      if (existing) return existing.bookId;
    }

    return null;
  }

  private async resolveDestination(
    library: { fileNamingPattern?: string | null; organizationMode?: string | null },
    folderPath: string,
    row: BookDockFileRow,
    format: string,
  ): Promise<string> {
    const pattern =
      library.fileNamingPattern ??
      (library.organizationMode === 'book_per_folder'
        ? await this.appSettings.getUploadPatternBookPerFolder()
        : await this.appSettings.getUploadPattern());
    const sanitizeForCrossPlatform = await this.appSettings.isCrossPlatformPathSanitizationEnabled();
    const meta = row.selectedMetadata ?? row.embeddedMetadata ?? {};

    if (pattern) {
      const tokens = this.buildPatternTokens(meta, row.fileName, format);
      const resolved = resolveUploadPath(pattern, tokens, format, { sanitizeForCrossPlatform });
      if (resolved) return join(folderPath, resolved);
    }

    return join(folderPath, row.fileName);
  }

  private buildPatternTokens(meta: BookDockMetadata, fileName: string, format: string): Record<string, string> {
    const stem = basename(fileName, extname(fileName));
    const tokens: Record<string, string> = { originalFilename: stem, extension: format };

    if (meta.title) tokens['title'] = meta.title;
    if (meta.subtitle) tokens['subtitle'] = meta.subtitle;
    if (meta.publisher) tokens['publisher'] = meta.publisher;
    if (meta.language) tokens['language'] = meta.language;
    if (meta.isbn13) tokens['isbn'] = meta.isbn13;
    if (meta.publishedYear) tokens['year'] = String(meta.publishedYear);
    if (meta.seriesName) tokens['series'] = meta.seriesName;
    if (meta.seriesIndex != null) {
      const whole = Math.floor(meta.seriesIndex);
      const fraction = meta.seriesIndex - whole;
      const padded = String(whole).padStart(2, '0');
      tokens['seriesIndex'] = fraction > 0 ? `${padded}.${String(fraction).split('.')[1]}` : padded;
    }
    if (meta.authors && meta.authors.length > 0) {
      tokens['authors'] = meta.authors.join(', ');
    }

    return tokens;
  }

  private async applyMetadata(bookId: number, row: BookDockFileRow): Promise<void> {
    const meta = normalizeFinalizeMetadata(row.selectedMetadata ?? row.embeddedMetadata);
    let selectedCoverApplied = false;

    const selectedCoverUrl = meta.coverUrl;
    if (selectedCoverUrl) {
      selectedCoverApplied = await this.metadataService.downloadAndSaveCover(selectedCoverUrl, bookId);
    }

    if (!selectedCoverApplied && row.coverPath) {
      try {
        const bytes = await readFile(row.coverPath);
        await this.metadataService.saveExtractedCoverBytes(bookId, bytes);
      } catch (err) {
        this.logger.warn(`Failed to copy Book Dock cover to book ${bookId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const scalarFields = {
      title: meta.title ?? null,
      subtitle: meta.subtitle ?? null,
      description: meta.description ?? null,
      isbn10: meta.isbn10 ?? null,
      isbn13: meta.isbn13 ?? null,
      publisher: meta.publisher ?? null,
      publishedYear: meta.publishedYear ?? null,
      language: meta.language ?? null,
      seriesName: meta.seriesName ?? null,
      seriesIndex: meta.seriesIndex ?? null,
      pageCount: meta.pageCount ?? null,
      updatedAt: new Date(),
    };
    const patch = (await this.seriesIdentity?.resolveMetadataPatch(scalarFields)) ?? scalarFields;

    await this.db.update(bookMetadata).set(patch).where(eq(bookMetadata.bookId, bookId));

    if (meta.authors.length > 0) {
      await this.metadataService.replaceAuthors(
        bookId,
        meta.authors.map((name) => ({ name, sortName: null })),
      );
    }

    if (meta.genres.length > 0) {
      await this.metadataService.replaceGenres(bookId, meta.genres);
    }
  }

  private async cleanupBookDockRecord(row: BookDockFileRow): Promise<void> {
    if (row.coverPath) {
      await safeUnlink(row.coverPath);
      const thumbPath = row.coverPath.replace(/\.\w+$/, '_thumb.jpg');
      await safeUnlink(thumbPath);
    }
    await this.repo.deleteById(row.id);
  }

  private async findLibraryOrFail(libraryId: number) {
    const [library] = await this.db.select().from(libraries).where(eq(libraries.id, libraryId)).limit(1);
    if (!library) throw new NotFoundException('Library not found');
    return library;
  }

  private async findFolderOrFail(folderId: number, libraryId: number) {
    const [folder] = await this.db.select().from(libraryFolders).where(eq(libraryFolders.id, folderId)).limit(1);
    if (!folder || folder.libraryId !== libraryId) throw new BadRequestException('Folder does not belong to this library');
    return folder;
  }

  private async emitSummary(): Promise<void> {
    const summary = await this.repo.countsByStatus();
    this.gateway.emitSummary(summary);
  }
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // file may already be deleted
  }
}

function normalizeText(value: unknown, maxLength?: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!maxLength) return trimmed;
  return trimmed.slice(0, maxLength);
}

function normalizeInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value.trim(), 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function normalizePublishedYear(value: unknown): number | null {
  const parsed = normalizeInteger(value);
  if (parsed === null) return null;
  if (parsed < MIN_PUBLISHED_YEAR || parsed > MAX_PUBLISHED_YEAR) return null;
  return parsed;
}

function normalizeReal(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value.trim()) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeIsbn(value: unknown, len: 10 | 13): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[\s-]+/g, '').toUpperCase();
  if (!compact) return null;
  if (len === 10) {
    return /^[0-9]{9}[0-9X]$/.test(compact) ? compact : null;
  }
  return /^[0-9]{13}$/.test(compact) ? compact : null;
}

function normalizeLanguage(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  const primary = raw.split(/[;,/|]/)[0]?.trim() ?? '';
  if (primary.length > 0 && primary.length <= 10) return primary;
  const firstWord = primary.split(/\s+/)[0]?.trim() ?? '';
  if (firstWord.length > 0 && firstWord.length <= 10) return firstWord;
  return raw.length <= 10 ? raw : null;
}

function normalizeStringArray(value: unknown, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    normalized.push(trimmed.slice(0, maxLength));
  }
  return normalized;
}

function normalizeDuplicateAuthors(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = new Set<string>();
  for (const author of value) {
    if (typeof author !== 'string') continue;
    const trimmed = author.trim().toLowerCase();
    if (!trimmed) continue;
    normalized.add(trimmed);
  }
  return [...normalized];
}

function normalizeFinalizeMetadata(meta: BookDockMetadata | null | undefined): NormalizedFinalizeMetadata {
  return {
    title: normalizeText(meta?.title, 1000),
    subtitle: normalizeText(meta?.subtitle, 1000),
    description: normalizeText(meta?.description),
    isbn10: normalizeIsbn(meta?.isbn10, 10),
    isbn13: normalizeIsbn(meta?.isbn13, 13),
    publisher: normalizeText(meta?.publisher, 500),
    publishedYear: normalizePublishedYear(meta?.publishedYear),
    language: normalizeLanguage(meta?.language),
    pageCount: normalizeInteger(meta?.pageCount),
    seriesName: normalizeText(meta?.seriesName, 500),
    seriesIndex: normalizeReal(meta?.seriesIndex),
    authors: normalizeStringArray(meta?.authors, 500),
    genres: normalizeStringArray(meta?.genres, 200),
    coverUrl: normalizeText(meta?.coverUrl),
  };
}

function resolveFinalizeErrorMessage(error: unknown): string {
  if (isPublishedYearConstraintViolation(error)) {
    return INVALID_PUBLISHED_YEAR_MESSAGE;
  }
  if (isBookMetadataConstraintViolation(error)) {
    return INVALID_METADATA_MESSAGE;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Finalization failed';
}

function isPublishedYearConstraintViolation(error: unknown): boolean {
  for (const entry of iterateErrorChain(error)) {
    if (entry.code === '23514') {
      const constraint = asString(entry.constraint);
      if (constraint === PUBLISHED_YEAR_RANGE_CONSTRAINT) return true;
      const message = asString(entry.message);
      if (message.includes(PUBLISHED_YEAR_RANGE_CONSTRAINT)) return true;
    }
  }
  return false;
}

function isBookMetadataConstraintViolation(error: unknown): boolean {
  for (const entry of iterateErrorChain(error)) {
    if (entry.code !== '23514') continue;
    const constraint = asString(entry.constraint);
    if (constraint.startsWith('book_metadata_')) return true;
    const message = asString(entry.message);
    if (message.includes('book_metadata')) return true;
  }
  return false;
}

function* iterateErrorChain(error: unknown): Generator<Record<string, unknown>> {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    yield current as Record<string, unknown>;
    current = (current as { cause?: unknown }).cause;
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function mergeBookDockMetadata(
  embedded: BookDockMetadata | null | undefined,
  fetched: BookDockMetadata | null | undefined,
  selected: BookDockMetadata | null | undefined,
): BookDockMetadata | null {
  const merged: BookDockMetadata = {
    ...(embedded ?? {}),
    ...(fetched ?? {}),
    ...(selected ?? {}),
  };
  return Object.keys(merged).length > 0 ? merged : null;
}

function resolveAutoFinalizeMetadata(
  mode: BookDockAutoFinalizeMetadataMode,
  embedded: BookDockMetadata | null | undefined,
  fetched: BookDockMetadata | null | undefined,
  selected: BookDockMetadata | null | undefined,
): BookDockMetadata | null {
  if (mode === 'embedded_only') return mergeBookDockMetadata(embedded, null, selected);
  if (mode === 'fetched_only') return mergeBookDockMetadata(null, fetched, selected);
  return mergeBookDockMetadata(embedded, fetched, selected);
}

function shouldAutoFinalize(row: BookDockFileRow, mode: BookDockAutoFinalizeMetadataMode, threshold: number): boolean {
  if (mode === 'embedded_only') {
    return row.status === 'ready';
  }
  return row.confidence !== null && row.confidence >= threshold;
}

function dedupeIds(ids: number[]): number[] {
  return [...new Set(ids)];
}
