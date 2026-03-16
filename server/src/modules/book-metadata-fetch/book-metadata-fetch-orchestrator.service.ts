import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import type { BookMetadataFetchReason, MetadataField } from '@projectx/types';
import { MetadataProviderKey } from '@projectx/types';
import { BookRepository } from '../book/book.repository';
import { MetadataScoreService } from '../metadata-score/metadata-score.service';
import { MetadataService } from '../metadata/metadata.service';
import { MetadataFetchPipeline, ResolvedMetadataFields } from '../metadata-fetch/metadata-fetch-pipeline';
import type { MetadataSearchParams } from '../metadata-fetch/providers/metadata-search-params';
import { BookMetadataFetchConfigService } from './book-metadata-fetch-config.service';
import { BookMetadataFetchEligibilityService } from './book-metadata-fetch-eligibility.service';
import { BookMetadataFetchGateway } from './book-metadata-fetch.gateway';
import { BookMetadataFetchQueueRepository } from './book-metadata-fetch-queue.repository';
import { BookMetadataFetchSessionService } from './book-metadata-fetch-session.service';

const POLL_INTERVAL_MS = 4_000;
const BATCH_SIZE = 1;

@Injectable()
export class BookMetadataFetchOrchestratorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BookMetadataFetchOrchestratorService.name);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private paused = false;

  constructor(
    private readonly queueRepo: BookMetadataFetchQueueRepository,
    private readonly configService: BookMetadataFetchConfigService,
    private readonly eligibilityService: BookMetadataFetchEligibilityService,
    private readonly bookRepo: BookRepository,
    private readonly pipeline: MetadataFetchPipeline,
    private readonly metadataService: MetadataService,
    private readonly scoreService: MetadataScoreService,
    private readonly session: BookMetadataFetchSessionService,
    @Optional() private readonly gateway?: BookMetadataFetchGateway,
  ) {}

  async onApplicationBootstrap() {
    await this.queueRepo.resetAllProcessingOnBoot();
    this.paused = await this.configService.isPaused();
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, POLL_INTERVAL_MS);
    void this.pollOnce();
  }

  onModuleDestroy() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async scheduleIfEligible(bookId: number, libraryId: number, reason: BookMetadataFetchReason): Promise<void> {
    const config = await this.configService.getEffectiveConfig(libraryId);
    if (!config.enabled || !config.triggerOnImport) return;

    const bookData = await this.loadEligibilityData(bookId);
    if (!bookData) return;

    if (!this.eligibilityService.isEligible(bookData, config)) return;

    const queued = await this.queueRepo.upsertSchedule([bookId], reason);
    if (queued > 0) {
      this.session.sessionTotal += queued;
      await this.emitStatus();
    }
  }

  async triggerGlobal(): Promise<number> {
    const config = await this.configService.getGlobalConfig();
    const bookIds = await this.queueRepo.fetchEligibleBookIds(config);
    if (bookIds.length === 0) return 0;

    const queued = await this.queueRepo.upsertSchedule(bookIds, 'manual_trigger');
    if (queued > 0) {
      this.session.sessionTotal += queued;
      await this.unpauseIfNeeded();
      await this.emitStatus();
      void this.pollOnce();
    }
    return queued;
  }

  async triggerForLibrary(libraryId: number): Promise<number> {
    const config = await this.configService.getEffectiveConfig(libraryId);
    if (!config.enabled) return 0;

    const bookIds = await this.queueRepo.fetchEligibleBookIds(config, libraryId);
    if (bookIds.length === 0) return 0;

    const queued = await this.queueRepo.upsertSchedule(bookIds, 'manual_trigger');
    if (queued > 0) {
      this.session.sessionTotal += queued;
      await this.unpauseIfNeeded();
      await this.emitStatus();
      void this.pollOnce();
    }
    await this.configService.recordLibraryRun(libraryId, queued);
    return queued;
  }

  async pause(): Promise<void> {
    this.paused = true;
    await this.configService.setPaused(true);
    await this.emitStatus();
  }

  async resume(): Promise<void> {
    this.paused = false;
    await this.configService.setPaused(false);
    await this.emitStatus();
    void this.pollOnce();
  }

  async cancelPending(): Promise<void> {
    this.paused = true;
    await this.configService.setPaused(true);
    await this.queueRepo.cancelPending();
    this.session.reset();
    await this.emitStatus();
  }

  async requeueFailed(): Promise<number> {
    const requeued = await this.queueRepo.requeueFailed();
    if (requeued > 0) {
      this.session.sessionTotal += requeued;
      await this.emitStatus();
    }
    return requeued;
  }

  private async pollOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.queueRepo.recoverStuckProcessing();
      await this.checkAndResetSession();

      if (this.paused) return;
      const dueRows = await this.queueRepo.fetchDue(BATCH_SIZE);
      if (dueRows.length > 0) {
        await this.processOne(dueRows[0].bookId, dueRows[0].title);
        await this.randomDelay();
      }
    } catch (error) {
      this.logger.warn(`book-metadata-fetch poll failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async processOne(bookId: number, title: string | null): Promise<void> {
    const claimed = await this.queueRepo.markProcessing(bookId);
    if (!claimed) return;
    this.session.currentItemName = title ?? null;
    await this.emitStatus();

    try {
      const found = await this.bookRepo.findById(bookId);
      if (!found) {
        await this.queueRepo.markDone(bookId);
        this.session.sessionDone++;
        this.session.currentItemName = null;
        await this.emitStatus();
        return;
      }

      const { book, authorRows, genreRows } = found;
      const meta = book.book_metadata;
      const libraryId = book.books.libraryId;

      const searchParams: MetadataSearchParams = {
        title: meta?.title ?? undefined,
        author: authorRows[0]?.name ?? undefined,
        isbn: meta?.isbn13 ?? meta?.isbn10 ?? undefined,
        existingProviderIds: this.collectProviderIds(meta ?? {}),
      };

      const existingFields: Partial<Record<MetadataField, unknown>> = {
        title: meta?.title,
        subtitle: meta?.subtitle,
        description: meta?.description,
        authors: authorRows.map((a) => a.name),
        publisher: meta?.publisher,
        publishedYear: meta?.publishedYear,
        language: meta?.language,
        pageCount: meta?.pageCount,
        seriesName: meta?.seriesName,
        seriesIndex: meta?.seriesIndex,
        genres: genreRows.map((g) => g.name),
        cover: meta?.coverSource,
      };

      const { resolved, providerIds } = await this.pipeline.runWithSources(searchParams, existingFields, libraryId);

      await this.persistResolved(bookId, resolved, providerIds, authorRows, genreRows);

      this.scoreService
        .calculateAndSave(bookId)
        .catch((err: Error) => this.logger.warn(`book-metadata-fetch score recalc failed for book ${bookId}: ${err.message}`));

      this.logger.debug(`book-metadata-fetch.done bookId=${bookId}`);
      await this.queueRepo.markDone(bookId);
      this.session.sessionDone++;
      this.session.currentItemName = null;
      await this.emitStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const httpStatus = extractHttpStatus(error);
      this.logger.warn(`book-metadata-fetch.failed bookId=${bookId} status=${httpStatus ?? 'none'} message=${message.slice(0, 200)}`);
      await this.queueRepo.markFailed(bookId, message, httpStatus);
      this.session.currentItemName = null;
      await this.emitStatus();
    }
  }

  private async persistResolved(
    bookId: number,
    resolved: ResolvedMetadataFields,
    providerIds: Partial<Record<MetadataProviderKey, string>>,
    existingAuthorRows: { name: string }[],
    existingGenreRows: { name: string }[],
  ): Promise<void> {
    const r = resolved as Record<string, unknown>;
    const scalarFields: Partial<typeof bookMetadata.$inferInsert> = {};

    if (r.title !== undefined) scalarFields.title = (r.title as string | null) ?? null;
    if (r.subtitle !== undefined) scalarFields.subtitle = (r.subtitle as string | null) ?? null;
    if (r.description !== undefined) scalarFields.description = (r.description as string | null) ?? null;
    if (r.publisher !== undefined) scalarFields.publisher = (r.publisher as string | null) ?? null;
    if (r.publishedYear !== undefined) scalarFields.publishedYear = (r.publishedYear as number | null) ?? null;
    if (r.language !== undefined) scalarFields.language = (r.language as string | null) ?? null;
    if (r.pageCount !== undefined) scalarFields.pageCount = (r.pageCount as number | null) ?? null;
    if (r.seriesName !== undefined) scalarFields.seriesName = (r.seriesName as string | null) ?? null;
    if (r.seriesIndex !== undefined) scalarFields.seriesIndex = (r.seriesIndex as number | null) ?? null;

    if (providerIds[MetadataProviderKey.GOOGLE]) scalarFields.googleBooksId = providerIds[MetadataProviderKey.GOOGLE];
    if (providerIds[MetadataProviderKey.GOODREADS]) scalarFields.goodreadsId = providerIds[MetadataProviderKey.GOODREADS];
    if (providerIds[MetadataProviderKey.AMAZON]) scalarFields.amazonId = providerIds[MetadataProviderKey.AMAZON];
    if (providerIds[MetadataProviderKey.HARDCOVER]) scalarFields.hardcoverId = providerIds[MetadataProviderKey.HARDCOVER];
    if (providerIds[MetadataProviderKey.OPEN_LIBRARY]) scalarFields.openLibraryId = providerIds[MetadataProviderKey.OPEN_LIBRARY];
    if (providerIds[MetadataProviderKey.ITUNES]) scalarFields.itunesId = providerIds[MetadataProviderKey.ITUNES];

    scalarFields.lastMetadataFetchAt = new Date();
    scalarFields.updatedAt = new Date();
    await this.bookRepo.updateMetadataFields(bookId, scalarFields);

    if (r.authors !== undefined) {
      const names = r.authors as string[];
      if (names.length > 0 || existingAuthorRows.length > 0) {
        await this.metadataService.replaceAuthors(
          bookId,
          names.map((name) => ({ name, sortName: null })),
        );
      }
    }

    if (r.genres !== undefined) {
      const names = r.genres as string[];
      if (names.length > 0 || existingGenreRows.length > 0) {
        await this.metadataService.replaceGenres(bookId, names);
      }
    }

    if (resolved.coverUrl) {
      await this.metadataService.downloadAndSaveCover(resolved.coverUrl, bookId);
    }
  }

  private async loadEligibilityData(bookId: number) {
    const found = await this.bookRepo.findById(bookId);
    if (!found) return null;
    const { book, authorRows, genreRows } = found;
    const meta = book.book_metadata;
    return {
      metadataScore: meta?.metadataScore ?? null,
      lastMetadataFetchAt: meta?.lastMetadataFetchAt ?? null,
      title: meta?.title ?? null,
      subtitle: meta?.subtitle ?? null,
      description: meta?.description ?? null,
      publisher: meta?.publisher ?? null,
      publishedYear: meta?.publishedYear ?? null,
      language: meta?.language ?? null,
      pageCount: meta?.pageCount ?? null,
      seriesName: meta?.seriesName ?? null,
      seriesIndex: meta?.seriesIndex ?? null,
      coverSource: meta?.coverSource ?? null,
      hasAuthors: authorRows.length > 0,
      hasGenres: genreRows.length > 0,
    };
  }

  private collectProviderIds(meta: {
    googleBooksId?: string | null;
    goodreadsId?: string | null;
    amazonId?: string | null;
    hardcoverId?: string | null;
    openLibraryId?: string | null;
    itunesId?: string | null;
  }): Partial<Record<MetadataProviderKey, string>> {
    const ids: Partial<Record<MetadataProviderKey, string>> = {};
    if (meta.googleBooksId) ids[MetadataProviderKey.GOOGLE] = meta.googleBooksId;
    if (meta.goodreadsId) ids[MetadataProviderKey.GOODREADS] = meta.goodreadsId;
    if (meta.amazonId) ids[MetadataProviderKey.AMAZON] = meta.amazonId;
    if (meta.hardcoverId) ids[MetadataProviderKey.HARDCOVER] = meta.hardcoverId;
    if (meta.openLibraryId) ids[MetadataProviderKey.OPEN_LIBRARY] = meta.openLibraryId;
    if (meta.itunesId) ids[MetadataProviderKey.ITUNES] = meta.itunesId;
    return ids;
  }

  private randomDelay(): Promise<void> {
    const ms = 2_000 + Math.random() * 3_000;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async unpauseIfNeeded(): Promise<void> {
    if (!this.paused) return;
    this.paused = false;
    await this.configService.setPaused(false);
  }

  private async checkAndResetSession(): Promise<void> {
    const summary = await this.queueRepo.getStatusSummary();
    if (summary.queued === 0 && summary.processing === 0) {
      this.session.reset();
    }
  }

  private async emitStatus(): Promise<void> {
    if (!this.gateway) return;
    const summary = await this.queueRepo.getStatusSummary();
    this.gateway.emitStatus({ ...summary, paused: this.paused, ...this.session.getSnapshot() });
  }
}

function extractHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = Reflect.get(error, 'status') ?? Reflect.get(error, 'statusCode') ?? Reflect.get(error, 'response');
  if (typeof status === 'number') return status;
  return undefined;
}
