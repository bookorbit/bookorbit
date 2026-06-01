import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import type { BookMetadataFetchReason, MetadataField } from '@bookorbit/types';
import { MetadataProviderKey, NotificationType } from '@bookorbit/types';
import { NotificationService } from '../notification/notification.service';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookReadService } from '../book/book-read.service';
import * as schema from '../../db/schema';
import { MetadataScoreService } from '../metadata-score/metadata-score.service';
import { MetadataService } from '../metadata/metadata.service';
import { MetadataFetchPipeline, ResolvedMetadataFields } from '../metadata-fetch/metadata-fetch-pipeline';
import { ProviderThrottleTracker } from '../metadata-fetch/provider-throttle.tracker';
import type { MetadataSearchParams } from '../metadata-fetch/providers/metadata-search-params';
import { BookMetadataLockService } from '../book-metadata-lock/book-metadata-lock.service';
import { BookMetadataFetchConfigService } from './book-metadata-fetch-config.service';
import { BookMetadataFetchEligibilityService } from './book-metadata-fetch-eligibility.service';
import { BookMetadataFetchGateway } from './book-metadata-fetch.gateway';
import { BookMetadataFetchQueueRepository } from './book-metadata-fetch-queue.repository';
import { BookMetadataFetchSessionService } from './book-metadata-fetch-session.service';

const POLL_INTERVAL_MS = 4_000;
const BATCH_SIZE = 1;
const SCHEDULE_BATCH_SIZE = 1000;

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
    private readonly bookReadService: BookReadService,
    private readonly pipeline: MetadataFetchPipeline,
    private readonly metadataService: MetadataService,
    private readonly scoreService: MetadataScoreService,
    private readonly bookMetadataLockService: BookMetadataLockService,
    private readonly session: BookMetadataFetchSessionService,
    private readonly throttleTracker: ProviderThrottleTracker,
    private readonly notificationService: NotificationService,
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
      this.session.addToTotal(queued);
      await this.emitStatus();
    }
  }

  async triggerGlobal(): Promise<number> {
    const config = await this.configService.getGlobalConfig();
    const queued = await this.queueRepo.scheduleEligibleBooksInBatches(config, 'manual_trigger', undefined, SCHEDULE_BATCH_SIZE);
    if (queued === 0) return 0;
    if (queued > 0) {
      this.session.addToTotal(queued);
      await this.unpauseIfNeeded();
      await this.emitStatus();
      void this.pollOnce();
    }
    return queued;
  }

  async triggerForLibrary(libraryId: number): Promise<number> {
    const config = await this.configService.getEffectiveConfig(libraryId);
    if (!config.enabled) return 0;

    const queued = await this.queueRepo.scheduleEligibleBooksInBatches(config, 'manual_trigger', libraryId, SCHEDULE_BATCH_SIZE);
    if (queued === 0) return 0;
    if (queued > 0) {
      this.session.addToTotal(queued);
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
      this.session.addToTotal(requeued);
      await this.emitStatus();
    }
    return requeued;
  }

  private async pollOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = Date.now();
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
      const errorClass = error instanceof Error ? error.name : 'Error';
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[book.metadata_fetch.poll] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - metadata fetch poll failed`,
      );
    } finally {
      this.running = false;
    }
  }

  private async processOne(bookId: number, title: string | null): Promise<void> {
    const startedAt = Date.now();
    const claimed = await this.queueRepo.markProcessing(bookId);
    if (!claimed) return;
    this.session.setCurrentItemName(title ?? null);
    this.logger.debug(`[book.metadata_fetch] [start] bookId=${bookId} - metadata fetch started`);
    await this.emitStatus();

    try {
      const found = await this.bookReadService.findById(bookId);
      if (!found) {
        await this.queueRepo.markDone(bookId);
        this.session.incrementDone();
        this.session.setCurrentItemName(null);
        this.logger.debug(
          `[book.metadata_fetch] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} outcome=book_missing - metadata fetch completed`,
        );
        await this.emitStatus();
        return;
      }

      const { book, authorRows, genreRows, narratorRows } = found;
      const meta = book.book_metadata;
      const libraryId = book.books.libraryId;

      const searchParams: MetadataSearchParams = {
        title: meta?.title ?? undefined,
        author: authorRows[0]?.name ?? undefined,
        isbn: meta?.isbn13 ?? meta?.isbn10 ?? undefined,
        existingProviderIds: this.collectProviderIds(meta ?? {}),
        isAudiobook: (meta?.durationSeconds !== null && meta?.durationSeconds !== undefined) || !!meta?.audibleId,
        maxCandidatesPerProvider: 1,
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
        duration: meta?.durationSeconds ?? undefined,
        abridged: meta?.abridged ?? undefined,
        narrators: narratorRows.map((n) => n.name),
      };

      const { resolved, providerIds } = await this.pipeline.runWithSources(searchParams, existingFields, libraryId);

      await this.persistResolved(bookId, resolved, providerIds, authorRows, genreRows, narratorRows);

      this.scoreService
        .calculateAndSave(bookId)
        .catch((err: Error) =>
          this.logger.warn(
            `[book.metadata_fetch.score_recalc] [fail] bookId=${bookId} errorClass=${err.name} error="${sanitizeLogValue(err.message)}" - metadata score recalculation failed`,
          ),
        );

      this.logger.debug(`[book.metadata_fetch] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} - metadata fetch completed`);
      await this.queueRepo.markDone(bookId);
      this.session.incrementDone();
      this.session.setCurrentItemName(null);
      await this.emitStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const httpStatus = extractHttpStatus(error);
      const errorClass = error instanceof Error ? error.name : 'Error';
      this.logger.warn(
        `[book.metadata_fetch] [fail] bookId=${bookId} durationMs=${Date.now() - startedAt} status=${httpStatus ?? 'none'} errorClass=${errorClass} error="${sanitizeLogValue(message.slice(0, 200))}" - metadata fetch failed`,
      );
      await this.queueRepo.markFailed(bookId, message, httpStatus);
      this.session.setCurrentItemName(null);
      await this.emitStatus();
    }
  }

  private async persistResolved(
    bookId: number,
    resolved: ResolvedMetadataFields,
    providerIds: Partial<Record<MetadataProviderKey, string>>,
    existingAuthorRows: { name: string }[],
    existingGenreRows: { name: string }[],
    existingNarratorRows: { name: string }[],
  ): Promise<void> {
    const {
      resolved: filteredResolved,
      providerIds: filteredProviderIds,
      skippedFields,
    } = await this.bookMetadataLockService.filterResolvedMetadata(bookId, resolved, providerIds);
    if (skippedFields.length > 0) {
      this.logger.debug(
        `[book.metadata_fetch.persist] [end] bookId=${bookId} skippedLockedFields=${skippedFields.join('|')} - metadata fetch skipped locked fields`,
      );
    }

    const scalarFields: Partial<typeof schema.bookMetadata.$inferInsert> = {};

    const title = this.asNullableString(filteredResolved.title);
    if (title !== undefined) scalarFields.title = title;
    const subtitle = this.asNullableString(filteredResolved.subtitle);
    if (subtitle !== undefined) scalarFields.subtitle = subtitle;
    const description = this.asNullableString(filteredResolved.description);
    if (description !== undefined) scalarFields.description = description;
    const publisher = this.asNullableString(filteredResolved.publisher);
    if (publisher !== undefined) scalarFields.publisher = publisher;
    const publishedYear = this.asNullableNumber(filteredResolved.publishedYear);
    if (publishedYear !== undefined) scalarFields.publishedYear = publishedYear;
    const language = this.asNullableString(filteredResolved.language);
    if (language !== undefined) scalarFields.language = language;
    const pageCount = this.asNullableNumber(filteredResolved.pageCount);
    if (pageCount !== undefined) scalarFields.pageCount = pageCount;
    const seriesName = this.asNullableString(filteredResolved.seriesName);
    if (seriesName !== undefined) scalarFields.seriesName = seriesName;
    const seriesIndex = this.asNullableNumber(filteredResolved.seriesIndex);
    if (seriesIndex !== undefined) scalarFields.seriesIndex = seriesIndex;

    if (filteredProviderIds[MetadataProviderKey.GOOGLE]) scalarFields.googleBooksId = filteredProviderIds[MetadataProviderKey.GOOGLE];
    if (filteredProviderIds[MetadataProviderKey.GOODREADS]) scalarFields.goodreadsId = filteredProviderIds[MetadataProviderKey.GOODREADS];
    if (filteredProviderIds[MetadataProviderKey.AMAZON]) scalarFields.amazonId = filteredProviderIds[MetadataProviderKey.AMAZON];
    if (filteredProviderIds[MetadataProviderKey.HARDCOVER]) scalarFields.hardcoverId = filteredProviderIds[MetadataProviderKey.HARDCOVER];
    if (filteredProviderIds[MetadataProviderKey.OPEN_LIBRARY]) scalarFields.openLibraryId = filteredProviderIds[MetadataProviderKey.OPEN_LIBRARY];
    if (filteredProviderIds[MetadataProviderKey.ITUNES]) scalarFields.itunesId = filteredProviderIds[MetadataProviderKey.ITUNES];
    if (filteredProviderIds[MetadataProviderKey.AUDIBLE]) scalarFields.audibleId = filteredProviderIds[MetadataProviderKey.AUDIBLE];
    if (filteredProviderIds[MetadataProviderKey.COMICVINE]) scalarFields.comicvineId = filteredProviderIds[MetadataProviderKey.COMICVINE];
    if (filteredProviderIds[MetadataProviderKey.RANOBEDB]) scalarFields.ranobedbId = filteredProviderIds[MetadataProviderKey.RANOBEDB];

    const duration = this.asNullableNumber(filteredResolved.duration);
    if (duration !== undefined) scalarFields.durationSeconds = duration;
    // Only overwrite abridged when the provider gives a definitive boolean - never let null
    // overwrite an existing true value.
    const abridged = this.asBoolean(filteredResolved.abridged);
    if (abridged !== undefined) scalarFields.abridged = abridged;
    if (filteredResolved.chapters !== undefined) scalarFields.chapters = filteredResolved.chapters;

    scalarFields.lastMetadataFetchAt = new Date();
    scalarFields.updatedAt = new Date();
    await this.bookReadService.updateMetadataFields(bookId, scalarFields);

    const resolvedAuthors = this.asStringArray(filteredResolved.authors);
    if (resolvedAuthors !== undefined) {
      const names = resolvedAuthors;
      if (names.length > 0 || existingAuthorRows.length > 0) {
        await this.metadataService.replaceAuthors(
          bookId,
          names.map((name) => ({ name, sortName: null })),
        );
      }
    }

    const resolvedGenres = this.asStringArray(filteredResolved.genres);
    if (resolvedGenres !== undefined) {
      const names = resolvedGenres;
      if (names.length > 0 || existingGenreRows.length > 0) {
        await this.metadataService.replaceGenres(bookId, names);
      }
    }

    const resolvedNarrators = this.asStringArray(filteredResolved.narrators);
    if (resolvedNarrators !== undefined) {
      const names = resolvedNarrators;
      if (names.length > 0 || existingNarratorRows.length > 0) {
        await this.metadataService.replaceNarrators(
          bookId,
          names.map((name) => ({ name, sortName: null })),
        );
      }
    }

    if (filteredResolved.comicMetadata !== undefined) {
      await this.metadataService.upsertComicMetadata(bookId, filteredResolved.comicMetadata);
    }

    if (filteredResolved.coverUrl) {
      await this.metadataService.downloadAndSaveCover(filteredResolved.coverUrl, bookId);
    }
  }

  private async loadEligibilityData(bookId: number) {
    const found = await this.bookReadService.findById(bookId);
    if (!found) return null;
    const { book, authorRows, genreRows, narratorRows } = found;
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
      hasNarrators: narratorRows.length > 0,
      durationSeconds: meta?.durationSeconds ?? null,
      abridged: meta?.abridged ?? null,
    };
  }

  private collectProviderIds(meta: {
    googleBooksId?: string | null;
    goodreadsId?: string | null;
    amazonId?: string | null;
    hardcoverId?: string | null;
    openLibraryId?: string | null;
    itunesId?: string | null;
    audibleId?: string | null;
    comicvineId?: string | null;
    ranobedbId?: string | null;
  }): Partial<Record<MetadataProviderKey, string>> {
    const ids: Partial<Record<MetadataProviderKey, string>> = {};
    if (meta.googleBooksId) ids[MetadataProviderKey.GOOGLE] = meta.googleBooksId;
    if (meta.goodreadsId) ids[MetadataProviderKey.GOODREADS] = meta.goodreadsId;
    if (meta.amazonId) ids[MetadataProviderKey.AMAZON] = meta.amazonId;
    if (meta.hardcoverId) ids[MetadataProviderKey.HARDCOVER] = meta.hardcoverId;
    if (meta.openLibraryId) ids[MetadataProviderKey.OPEN_LIBRARY] = meta.openLibraryId;
    if (meta.itunesId) ids[MetadataProviderKey.ITUNES] = meta.itunesId;
    if (meta.audibleId) ids[MetadataProviderKey.AUDIBLE] = meta.audibleId;
    if (meta.comicvineId) ids[MetadataProviderKey.COMICVINE] = meta.comicvineId;
    if (meta.ranobedbId) ids[MetadataProviderKey.RANOBEDB] = meta.ranobedbId;
    return ids;
  }

  private randomDelay(): Promise<void> {
    const throttleActive = this.throttleTracker.hasAnyActive();
    const ms = throttleActive ? 10_000 + Math.random() * 10_000 : 2_000 + Math.random() * 3_000;
    if (throttleActive) {
      this.logger.debug(`throttle active - extending inter-book delay to ${Math.round(ms)}ms`);
    }
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
      const snapshot = this.session.getSnapshot();
      if (snapshot.sessionTotal > 0) {
        const hasFailed = summary.failed > 0;
        this.notificationService
          .notify({
            type: hasFailed ? NotificationType.MetadataFetchFailed : NotificationType.MetadataFetchCompleted,
            title: hasFailed ? 'Metadata fetch completed with errors' : 'Metadata fetch completed',
            message: `Processed ${snapshot.sessionDone} of ${snapshot.sessionTotal} books` + (hasFailed ? `, ${summary.failed} failed` : ''),
            scope: { kind: 'all' },
            meta: { sessionTotal: snapshot.sessionTotal, sessionDone: snapshot.sessionDone, failed: summary.failed },
          })
          .catch(() => {});
      }
      this.session.reset();
    }
  }

  private async emitStatus(): Promise<void> {
    if (!this.gateway) return;
    const summary = await this.queueRepo.getStatusSummary();
    this.gateway.emitStatus({ ...summary, paused: this.paused, ...this.session.getSnapshot() });
  }

  private asNullableString(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return typeof value === 'string' ? value : undefined;
  }

  private asNullableNumber(value: unknown): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private asBoolean(value: unknown): boolean | undefined {
    if (value === undefined || value === null) return undefined;
    return typeof value === 'boolean' ? value : undefined;
  }

  private asStringArray(value: unknown): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) return undefined;
    if (!value.every((item) => typeof item === 'string')) return undefined;
    return value;
  }
}

function extractHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = Reflect.get(error, 'status') ?? Reflect.get(error, 'statusCode') ?? Reflect.get(error, 'response');
  if (typeof status === 'number') return status;
  return undefined;
}
