import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { basename, dirname, extname, join } from 'path';
import { access as fsAccess, readFile, stat, unlink } from 'fs/promises';
import { and, eq, ilike, inArray, or } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { StagingAutoFinalizeMetadataMode, StagingFinalizeFileResult, StagingFinalizeResult, StagingMetadata } from '@projectx/types';
import { resolveUploadPath } from '@projectx/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata, books, libraries, libraryFolders } from '../../db/schema';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { LibraryService } from '../library/library.service';
import { MetadataService } from '../metadata/metadata.service';
import { UploadProcessorService } from '../upload/upload-processor.service';
import { UploadStorageService } from '../upload/upload-storage.service';
import { UploadValidatorService } from '../upload/upload-validator.service';
import { StagingRepository } from './staging.repository';
import { StagingEventsService, STAGING_FILE_INGESTED } from './staging-events.service';
import { StagingGateway } from './staging.gateway';
import type { StagingFileRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const BATCH_SIZE = 100;

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
export class StagingFinalizeService implements OnModuleInit {
  private readonly logger = new Logger(StagingFinalizeService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: StagingRepository,
    private readonly libraryService: LibraryService,
    private readonly appSettings: AppSettingsService,
    private readonly metadataService: MetadataService,
    private readonly validator: UploadValidatorService,
    private readonly storage: UploadStorageService,
    private readonly processor: UploadProcessorService,
    private readonly events: StagingEventsService,
    private readonly gateway: StagingGateway,
  ) {}

  onModuleInit() {
    this.events.on(STAGING_FILE_INGESTED, (fileId: number) => {
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
  ): Promise<StagingFinalizeResult> {
    const ids = selectAll ? await this.repo.findAllIds(excludedIds, status, search) : dedupeIds(fileIds ?? []);
    const overrideMap = new Map((overrides ?? []).map((o) => [o.fileId, o]));

    const results: StagingFinalizeFileResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const rows = await this.repo.findByIds(batch);
      const rowById = new Map(rows.map((row) => [row.id, row]));

      for (const fileId of batch) {
        const row = rowById.get(fileId);
        if (!row) {
          failed++;
          results.push({
            fileId,
            fileName: `staging-file-${fileId}`,
            success: false,
            message: 'Staging file not found',
          });
          continue;
        }

        const result = await this.finalizeFile(row, defaultLibraryId, defaultFolderId, overrideMap, userId, isSuperuser);
        results.push(result);
        if (result.success) succeeded++;
        else failed++;
      }
    }

    await this.emitSummary();

    return { total: ids.length, succeeded, failed, results };
  }

  private async finalizeFile(
    row: StagingFileRow,
    defaultLibraryId: number | undefined,
    defaultFolderId: number | undefined,
    overrideMap: Map<number, { libraryId?: number; folderId?: number }>,
    userId: number,
    isSuperuser: boolean,
  ): Promise<StagingFinalizeFileResult> {
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
      const existingBookId = await this.findDuplicate(libraryId, meta);
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
        const bookFolderPath = dirname(destPath) === folder.path ? destPath : dirname(destPath);
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

      await this.cleanupStagingRecord(row);

      const newName = destPath.substring(folder.path.length + 1);
      return { fileId: row.id, fileName: row.fileName, newName, success: true, bookId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Finalization failed';
      this.logger.warn(`Finalize failed for staging file ${row.id}: ${message}`);
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
      this.logger.log(`Auto-finalized staging file ${fileId} -> book ${result.bookId} (confidence ${row.confidence}%)`);
      await this.emitSummary();
    } else {
      this.logger.warn(`Auto-finalize skipped for staging file ${fileId}: ${result.message}`);
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
    const appPattern = await this.appSettings.getUploadPattern();
    const libraryIds = [...new Set(rows.map((row) => row.targetLibraryId ?? defaultLibraryId).filter((id): id is number => id != null))];
    const libraryMap = libraryIds.length
      ? new Map((await this.db.select().from(libraries).where(inArray(libraries.id, libraryIds))).map((lib) => [lib.id, lib]))
      : new Map<number, typeof libraries.$inferSelect>();

    return rows.map((row) => {
      const format = row.format ?? extname(row.fileName).toLowerCase().slice(1);
      const meta = row.selectedMetadata ?? row.embeddedMetadata ?? {};
      let newName = row.fileName;
      const effectiveLibraryId = row.targetLibraryId ?? defaultLibraryId ?? null;
      const libraryPattern = effectiveLibraryId !== null ? (libraryMap.get(effectiveLibraryId)?.fileNamingPattern ?? null) : null;
      const pattern = libraryPattern ?? appPattern;

      if (pattern) {
        const tokens = this.buildPatternTokens(meta, row.fileName, format);
        const resolved = resolveUploadPath(pattern, tokens, format);
        if (resolved) newName = resolved;
      }

      return { fileId: row.id, fileName: row.fileName, newName };
    });
  }

  private async findDuplicate(libraryId: number, meta: Pick<NormalizedFinalizeMetadata, 'isbn13' | 'isbn10' | 'title'>): Promise<number | null> {
    const isbn = meta.isbn13 ?? meta.isbn10;

    if (isbn) {
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
      const [existing] = await this.db
        .select({ bookId: bookMetadata.bookId })
        .from(bookMetadata)
        .innerJoin(books, eq(books.id, bookMetadata.bookId))
        .where(and(eq(books.libraryId, libraryId), ilike(bookMetadata.title, meta.title)))
        .limit(1);

      if (existing) return existing.bookId;
    }

    return null;
  }

  private async resolveDestination(
    library: { fileNamingPattern?: string | null },
    folderPath: string,
    row: StagingFileRow,
    format: string,
  ): Promise<string> {
    const pattern = library.fileNamingPattern ?? (await this.appSettings.getUploadPattern());
    const meta = row.selectedMetadata ?? row.embeddedMetadata ?? {};

    if (pattern) {
      const tokens = this.buildPatternTokens(meta, row.fileName, format);
      const resolved = resolveUploadPath(pattern, tokens, format);
      if (resolved) return join(folderPath, resolved);
    }

    return join(folderPath, row.fileName);
  }

  private buildPatternTokens(meta: StagingMetadata, fileName: string, format: string): Record<string, string> {
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

  private async applyMetadata(bookId: number, row: StagingFileRow): Promise<void> {
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
        this.logger.warn(`Failed to copy staging cover to book ${bookId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await this.db
      .update(bookMetadata)
      .set({
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
      })
      .where(eq(bookMetadata.bookId, bookId));

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

  private async cleanupStagingRecord(row: StagingFileRow): Promise<void> {
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

function normalizeFinalizeMetadata(meta: StagingMetadata | null | undefined): NormalizedFinalizeMetadata {
  return {
    title: normalizeText(meta?.title, 1000),
    subtitle: normalizeText(meta?.subtitle, 1000),
    description: normalizeText(meta?.description),
    isbn10: normalizeIsbn(meta?.isbn10, 10),
    isbn13: normalizeIsbn(meta?.isbn13, 13),
    publisher: normalizeText(meta?.publisher, 500),
    publishedYear: normalizeInteger(meta?.publishedYear),
    language: normalizeLanguage(meta?.language),
    pageCount: normalizeInteger(meta?.pageCount),
    seriesName: normalizeText(meta?.seriesName, 500),
    seriesIndex: normalizeReal(meta?.seriesIndex),
    authors: normalizeStringArray(meta?.authors, 500),
    genres: normalizeStringArray(meta?.genres, 200),
    coverUrl: normalizeText(meta?.coverUrl),
  };
}

function mergeStagingMetadata(
  embedded: StagingMetadata | null | undefined,
  fetched: StagingMetadata | null | undefined,
  selected: StagingMetadata | null | undefined,
): StagingMetadata | null {
  const merged: StagingMetadata = {
    ...(embedded ?? {}),
    ...(fetched ?? {}),
    ...(selected ?? {}),
  };
  return Object.keys(merged).length > 0 ? merged : null;
}

function resolveAutoFinalizeMetadata(
  mode: StagingAutoFinalizeMetadataMode,
  embedded: StagingMetadata | null | undefined,
  fetched: StagingMetadata | null | undefined,
  selected: StagingMetadata | null | undefined,
): StagingMetadata | null {
  if (mode === 'embedded_only') return mergeStagingMetadata(embedded, null, selected);
  if (mode === 'fetched_only') return mergeStagingMetadata(null, fetched, selected);
  return mergeStagingMetadata(embedded, fetched, selected);
}

function shouldAutoFinalize(row: StagingFileRow, mode: StagingAutoFinalizeMetadataMode, threshold: number): boolean {
  if (mode === 'embedded_only') {
    return row.status === 'ready';
  }
  return row.confidence !== null && row.confidence >= threshold;
}

function dedupeIds(ids: number[]): number[] {
  return [...new Set(ids)];
}
