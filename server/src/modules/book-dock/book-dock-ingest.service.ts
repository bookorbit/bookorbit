import { BadRequestException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { basename, extname, join, relative, sep } from 'path';
import { mkdir, realpath, stat } from 'fs/promises';
import { Readable } from 'stream';

import { isAudioFormat, MetadataProviderKey, resolveBookDockSearchTitle, type BookDockMetadata } from '@bookorbit/types';
import type { BookDockFileRow } from '../../db/schema';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { SUPPORTED_BOOK_FORMATS, UploadValidatorService } from '../upload/upload-validator.service';
import { UploadStorageService } from '../upload/upload-storage.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { MetadataFetchPipeline } from '../metadata-fetch/metadata-fetch-pipeline';
import { interpretRelease } from '../scanner/lib/release-plan';
import { buildSingleBookCandidate } from '../scanner/lib/walk';
import { BookDockRepository } from './book-dock.repository';
import { BookDockMetadataService } from './book-dock-metadata.service';
import { BookDockEventsService, BOOK_DOCK_FILE_INGESTED } from './book-dock-events.service';
import { BookDockGateway } from './book-dock.gateway';
import { normalizeBookDockMetadata, normalizeBookDockMetadataSources } from './book-dock-metadata.utils';
import { BookDockProcessingStateService } from './book-dock-processing-state.service';
import { BookDockWorkQueue, type BookDockWorkPriority } from './book-dock-work-queue';

const METADATA_QUEUE_CONCURRENCY = 1;
const METADATA_QUEUE_DRAIN_DELAY_MS = 250;
const METADATA_QUEUE_INTER_BOOK_DELAY_MIN_MS = 500;
const METADATA_QUEUE_INTER_BOOK_DELAY_MAX_MS = 1_000;
const REQUEUE_BATCH_SIZE = 500;
const PROCESSABLE_METADATA_STATUSES = new Set(['pending', 'extracting', 'fetching']);

@Injectable()
export class BookDockIngestService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BookDockIngestService.name);
  private bookDockPath: string;
  private readonly metadataQueue: BookDockWorkQueue;
  private readonly forcedAutoFetchFileIds = new Set<number>();

  constructor(
    private readonly config: ConfigService,
    private readonly repo: BookDockRepository,
    private readonly validator: UploadValidatorService,
    private readonly storage: UploadStorageService,
    private readonly metadataService: BookDockMetadataService,
    private readonly events: BookDockEventsService,
    private readonly appSettings: AppSettingsService,
    private readonly metadataFetchPipeline: MetadataFetchPipeline,
    private readonly processingState: BookDockProcessingStateService,
    private readonly gateway: BookDockGateway,
  ) {
    const appDataPath = this.config.get<string>('storage.appDataPath') ?? '/data';
    this.bookDockPath = this.config.get<string>('storage.bookDockPath') ?? join(appDataPath, 'book-dock');
    this.metadataQueue = new BookDockWorkQueue(
      METADATA_QUEUE_CONCURRENCY,
      (fileId) => this.processMetadataJob(fileId),
      (fileId, error) => this.logMetadataQueueFailure(fileId, error),
      {
        pendingOrder: 'priority-desc',
        drainDelayMs: METADATA_QUEUE_DRAIN_DELAY_MS,
        interJobDelayMs: { minMs: METADATA_QUEUE_INTER_BOOK_DELAY_MIN_MS, maxMs: METADATA_QUEUE_INTER_BOOK_DELAY_MAX_MS },
      },
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    await mkdir(this.bookDockPath, { recursive: true });
    this.bookDockPath = await realpath(this.bookDockPath);
    if (await this.processingState.isPaused()) {
      this.metadataQueue.pause();
    }
  }

  onModuleDestroy(): void {
    this.metadataQueue.stop();
  }

  async ingestUpload(rawFilename: string, fileStream: Readable, uploadedBy?: number): Promise<number> {
    const filename = this.validator.sanitizeFilename(rawFilename);
    const ext = extname(filename).toLowerCase().slice(1);

    if (!SUPPORTED_BOOK_FORMATS.has(ext)) {
      throw new BadRequestException(`Unsupported file type .${ext}. Allowed types: ${[...SUPPORTED_BOOK_FORMATS].join(', ')}`);
    }

    const { tempPath, sizeBytes } = await this.storage.streamToTemp(fileStream);
    let destPath: string | null = null;

    try {
      destPath = await this.resolveUniquePath(join(this.bookDockPath, filename));

      await this.storage.moveToPath(tempPath, destPath);

      const row = await this.repo.create({
        fileName: basename(destPath),
        absolutePath: destPath,
        fileSize: sizeBytes,
        format: ext,
        status: 'pending',
        uploadedBy: uploadedBy ?? null,
      });

      this.extractMetadataAsync(row.id, ext, metadataQueuePriority(row));

      return row.id;
    } catch (err) {
      await Promise.allSettled([this.storage.cleanup(tempPath), destPath ? this.storage.cleanup(destPath) : Promise.resolve()]);
      throw err;
    }
  }

  async retryFetch(fileId: number): Promise<void> {
    const row = await this.repo.findById(fileId);
    if (!row || row.status !== 'error' || !row.format) return;
    await this.repo.update(fileId, { status: 'pending', errorMessage: null });
    this.extractMetadataAsync(fileId, row.format, metadataQueuePriority(row));
  }

  async refetchMetadata(fileId: number): Promise<boolean> {
    const row = await this.repo.findById(fileId);
    if (!row || (row.status !== 'ready' && row.status !== 'error')) return false;

    const format = resolveSupportedFormat(row);
    if (!format) return false;

    this.forcedAutoFetchFileIds.add(fileId);
    const updated = await this.repo.update(fileId, { status: 'pending', errorMessage: null });
    if (!updated) {
      this.forcedAutoFetchFileIds.delete(fileId);
      return false;
    }

    const queued = this.extractMetadataAsync(fileId, format, metadataQueuePriority(row));
    if (!queued) {
      this.forcedAutoFetchFileIds.delete(fileId);
      await this.repo.update(fileId, { status: row.status, errorMessage: row.errorMessage });
    }
    return queued;
  }

  async ingestFromWatchedFolder(absolutePath: string): Promise<number | null> {
    const existing = await this.repo.findByAbsolutePath(absolutePath);
    if (existing) {
      this.requeueExistingIfProcessable(existing);
      return null;
    }

    const ext = extname(absolutePath).toLowerCase().slice(1);
    if (!SUPPORTED_BOOK_FORMATS.has(ext)) return null;

    let fileSize: number;
    try {
      const s = await stat(absolutePath);
      fileSize = s.size;
    } catch {
      return null;
    }

    const row = await this.repo.create({
      fileName: basename(absolutePath),
      absolutePath,
      fileSize,
      format: ext,
      status: 'pending',
    });

    this.extractMetadataAsync(row.id, ext, metadataQueuePriority(row));

    return row.id;
  }

  /**
   * A folder dropped into the dock, read as books rather than as loose files. Returns how many
   * units it created.
   *
   * The folder is read once with the scanner's own `buildSingleBookCandidate`, which already
   * handles disc subdirectories, natural sort, roles and covers. Its file list then goes through
   * the release interpreter for **grouping**, because `buildSingleBookCandidate` returns exactly
   * one candidate for any folder whatever it holds: a dropped 60-issue comic run would otherwise
   * become one book of 60 files, and the dock would disagree with the request pipeline about the
   * same folder.
   */
  async ingestUnitDirectory(unitDirectory: string): Promise<number> {
    const candidate = await buildSingleBookCandidate(unitDirectory, unitDirectory, [], (message) =>
      this.logger.debug(`[book_dock.ingest_unit] ${sanitizeLogValue(message)}`),
    );
    if (!candidate) return 0;

    const byPath = new Map(candidate.files.map((file) => [file.absolutePath, file]));
    const plan = interpretRelease(
      candidate.files.map((file) => ({ path: relative(unitDirectory, file.absolutePath).split(sep).join('/'), sizeBytes: file.sizeBytes })),
      { rootName: basename(unitDirectory) },
    );

    let created = 0;
    for (const unit of plan.units) {
      const primaryPath = join(unitDirectory, unit.primaryPath);
      if (await this.repo.findByAbsolutePath(primaryPath)) continue;

      const primary = byPath.get(primaryPath);
      if (!primary?.format || !SUPPORTED_BOOK_FORMATS.has(primary.format)) continue;

      // One unit per folder is the ordinary case, and it owns the folder outright. Several units
      // share it, so none of them may claim it: claiming would make the others invisible to the
      // watcher, and deleting one would take the whole folder with it.
      const owned = plan.units.length === 1;

      const row = await this.repo.createUnit(
        {
          fileName: basename(primaryPath),
          absolutePath: primaryPath,
          fileSize: primary.sizeBytes,
          format: primary.format,
          unitDirectory: owned ? unitDirectory : null,
          status: 'pending',
        },
        unit.files.map((file) => {
          const stat = byPath.get(join(unitDirectory, file.path));
          return {
            absolutePath: join(unitDirectory, file.path),
            fileName: basename(file.path),
            fileSize: stat?.sizeBytes ?? file.sizeBytes,
            format: file.format,
            role: file.role,
            sortOrder: file.sortOrder,
          };
        }),
      );

      this.extractMetadataAsync(row.id, primary.format, metadataQueuePriority(row));
      created++;
    }

    if (created > 0) {
      this.logger.log(
        `[book_dock.ingest_unit] [end] path="${sanitizeLogValue(unitDirectory)}" units=${created} files=${candidate.files.length} - folder ingested as units`,
      );
    }
    return created;
  }

  private extractMetadataAsync(fileId: number, format: string, priority?: BookDockWorkPriority): boolean {
    if (!isSupportedFormat(format)) return false;
    if (this.processingState.getCachedPaused()) this.metadataQueue.pause();
    return this.metadataQueue.enqueue(fileId, priority);
  }

  pauseProcessing(): void {
    this.metadataQueue.pause();
  }

  async resumeProcessing(): Promise<void> {
    if (await this.processingState.isPaused()) return;
    this.metadataQueue.resume();
  }

  async requeueProcessableFiles(): Promise<number> {
    if (await this.processingState.isPaused()) return 0;

    let queued = 0;
    let afterId: number | undefined;
    while (!(await this.processingState.isPaused())) {
      const rows = await this.repo.findSelectionBatch({
        limit: REQUEUE_BATCH_SIZE,
        afterId,
        status: 'pending',
        userId: 0,
        canManageAll: true,
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        if (this.requeueExistingIfProcessable(row)) queued++;
      }
      afterId = rows[rows.length - 1]?.id;
    }

    return queued;
  }

  private requeueExistingIfProcessable(row: BookDockFileRow): boolean {
    if (!PROCESSABLE_METADATA_STATUSES.has(row.status)) return false;
    const format = resolveSupportedFormat(row);
    if (!format) return false;
    if (this.processingState.getCachedPaused()) this.metadataQueue.pause();
    return this.metadataQueue.enqueue(row.id, metadataQueuePriority(row));
  }

  private async processMetadataJob(fileId: number): Promise<void> {
    if (await this.processingState.isPaused()) {
      this.metadataQueue.pause();
      return;
    }

    const forceAutoFetch = this.forcedAutoFetchFileIds.has(fileId);
    try {
      const row = await this.repo.findById(fileId);
      if (!row || !PROCESSABLE_METADATA_STATUSES.has(row.status)) return;

      const format = resolveSupportedFormat(row);
      if (!format) return;

      const coversDir = join(this.bookDockPath, 'covers');
      await this.repo.update(fileId, { status: 'extracting' });
      this.emitChange();
      await this.metadataService.extractAndSave(fileId, row.absolutePath, format, coversDir);
      await this.autoFetchMetadataAsync(fileId, forceAutoFetch);
      this.emitChange();
      this.events.emit(BOOK_DOCK_FILE_INGESTED, fileId);
    } finally {
      this.forcedAutoFetchFileIds.delete(fileId);
    }
  }

  private logMetadataQueueFailure(fileId: number, err: unknown): void {
    const errorClass = err instanceof Error ? err.name : 'Error';
    const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
    this.logger.warn(
      `[book_dock.metadata_queue] [fail] fileId=${fileId} errorClass=${errorClass} error="${errorMessage}" - metadata queue job failed`,
    );
  }

  private async autoFetchMetadataAsync(fileId: number, force = false): Promise<void> {
    if (!force) {
      const enabled = await this.appSettings.isBookDockAutoFetchEnabled();
      if (!enabled) return;
    }

    const row = await this.repo.findById(fileId);
    if (!row || row.status === 'error') return;

    const meta = row.embeddedMetadata;
    const params = {
      title: resolveBookDockSearchTitle(row.fileName, meta?.title),
      author: meta?.authors?.[0] ?? undefined,
      isbn: meta?.isbn13 ?? meta?.isbn10 ?? undefined,
      isAudiobook: row.format != null && isAudioFormat(row.format),
    };
    if (!params.title && !params.isbn) return;

    await this.repo.update(fileId, { status: 'fetching' });
    this.emitChange();
    try {
      const { resolved, sources, providerIds = {} } = await this.metadataFetchPipeline.runWithSources(params, {});
      const fetched = normalizeBookDockMetadata(resolved) ?? {};
      for (const [provider, providerId] of Object.entries(providerIds)) {
        const field = BOOK_DOCK_PROVIDER_ID_FIELDS[provider as MetadataProviderKey];
        if (!field || !providerId) continue;
        (fetched as Record<string, unknown>)[field] = providerId;
        sources[field] = provider;
      }
      const fetchedMetadataSources = normalizeBookDockMetadataSources(sources);
      const updates =
        Object.keys(fetched).length > 0
          ? {
              status: 'ready' as const,
              fetchedMetadata: fetched,
              confidence: computeConfidence(row.embeddedMetadata ?? {}, fetched),
              fetchedMetadataSources,
            }
          : force
            ? {
                status: 'ready' as const,
                fetchedMetadata: null,
                confidence: null,
                fetchedMetadataSources: null,
              }
            : { status: 'ready' as const };
      await this.repo.update(fileId, updates);
    } catch (err) {
      this.logger.warn(`Auto-fetch metadata failed for Book Dock file ${fileId}: ${err instanceof Error ? err.message : String(err)}`);
      await this.repo.update(fileId, { status: 'ready' });
    }
  }

  private async resolveUniquePath(desiredPath: string): Promise<string> {
    const exists = await stat(desiredPath)
      .then(() => true)
      .catch(() => false);
    if (!exists) return desiredPath;

    const ext = extname(desiredPath);
    const stem = basename(desiredPath, ext);
    const dir = desiredPath.substring(0, desiredPath.length - basename(desiredPath).length);
    const uniqueName = `${stem}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
    return join(dir, uniqueName);
  }

  private emitChange(): void {
    this.gateway.emitChanged();
  }
}

const BOOK_DOCK_PROVIDER_ID_FIELDS: Partial<Record<MetadataProviderKey, keyof BookDockMetadata>> = {
  [MetadataProviderKey.GOOGLE]: 'googleBooksId',
  [MetadataProviderKey.GOODREADS]: 'goodreadsId',
  [MetadataProviderKey.AMAZON]: 'amazonId',
  [MetadataProviderKey.HARDCOVER]: 'hardcoverId',
  [MetadataProviderKey.OPEN_LIBRARY]: 'openLibraryId',
  [MetadataProviderKey.ITUNES]: 'itunesId',
  [MetadataProviderKey.AUDIBLE]: 'audibleId',
  [MetadataProviderKey.LIBROFM]: 'librofmId',
  [MetadataProviderKey.KOBO]: 'koboId',
  [MetadataProviderKey.COMICVINE]: 'comicvineId',
  [MetadataProviderKey.RANOBEDB]: 'ranobedbId',
  [MetadataProviderKey.LUBIMYCZYTAC]: 'lubimyczytacId',
  [MetadataProviderKey.ALADIN]: 'aladinId',
};

function resolveSupportedFormat(row: Pick<BookDockFileRow, 'format' | 'absolutePath'>): string | null {
  const format = row.format ?? extname(row.absolutePath).toLowerCase().slice(1);
  return isSupportedFormat(format) ? format : null;
}

function isSupportedFormat(format: string | null | undefined): format is string {
  return typeof format === 'string' && SUPPORTED_BOOK_FORMATS.has(format);
}

function metadataQueuePriority(row: Pick<BookDockFileRow, 'id'> & Partial<Pick<BookDockFileRow, 'createdAt'>>): BookDockWorkPriority {
  const createdAtMs = row.createdAt instanceof Date ? row.createdAt.getTime() : Number.NaN;
  return {
    primary: Number.isFinite(createdAtMs) ? createdAtMs : row.id,
    secondary: row.id,
  };
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'to', 'for', 'by', 'at', 'on', 'is', 'it']);

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((t) => b.has(t)).length;
  return intersection / (a.size + b.size - intersection);
}

function titleSimilarity(a: string, b: string): number {
  // Strip subtitles (after ': ' or ' - ') before comparing
  const strip = (s: string) => s.split(/:\s+|-\s+/)[0].trim();
  return jaccard(tokenize(strip(a)), tokenize(strip(b)));
}

function normalizeAuthorName(name: string): string {
  // Normalize "Last, First" → "first last"
  const comma = name.indexOf(',');
  if (comma > 0) {
    const last = name.slice(0, comma).trim();
    const first = name.slice(comma + 1).trim();
    return `${first} ${last}`.toLowerCase();
  }
  return name.toLowerCase();
}

function authorSimilarity(embAuthors: string[], fetchAuthors: string[]): number {
  let best = 0;
  for (const ea of embAuthors) {
    const tokA = new Set(
      normalizeAuthorName(ea)
        .replace(/[^a-z\s]/g, '')
        .split(/\s+/)
        .filter((t) => t.length > 1),
    );
    for (const fa of fetchAuthors) {
      const tokB = new Set(
        normalizeAuthorName(fa)
          .replace(/[^a-z\s]/g, '')
          .split(/\s+/)
          .filter((t) => t.length > 1),
      );
      best = Math.max(best, jaccard(tokA, tokB));
    }
  }
  return best;
}

function computeConfidence(embedded: BookDockMetadata, fetched: BookDockMetadata): number {
  // ISBN exact match - definitive
  if (embedded.isbn13 && fetched.isbn13 && embedded.isbn13 === fetched.isbn13) return 95;
  if (embedded.isbn10 && fetched.isbn10 && embedded.isbn10 === fetched.isbn10) return 90;

  // Conflicting ISBNs - almost certainly wrong book
  const embIsbn = embedded.isbn13 ?? embedded.isbn10;
  const fetchIsbn = fetched.isbn13 ?? fetched.isbn10;
  if (embIsbn && fetchIsbn && embIsbn !== fetchIsbn) return 10;

  let score = 0;

  // Title: up to 55 points
  if (embedded.title && fetched.title) {
    score += Math.round(titleSimilarity(embedded.title, fetched.title) * 55);
  }

  // Authors: up to 30 points
  if (embedded.authors?.length && fetched.authors?.length) {
    score += Math.round(authorSimilarity(embedded.authors, fetched.authors) * 30);
  }

  // Published year: up to 10 points
  if (embedded.publishedYear && fetched.publishedYear) {
    if (embedded.publishedYear === fetched.publishedYear) score += 10;
  }

  // Series: up to 5 points
  if (embedded.seriesName && fetched.seriesName) {
    if (jaccard(tokenize(embedded.seriesName), tokenize(fetched.seriesName)) >= 0.5) score += 5;
  }

  return Math.min(score, 100);
}
