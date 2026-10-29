import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import type { BookMetadataFetchReason } from '@bookorbit/types';
import { MetadataProviderKey, NotificationType, Permission, parseSeriesIndex } from '@bookorbit/types';
import { NotificationService } from '../notification/notification.service';
import { chapterProvenance, normalizeAudiobookChapters } from '../../common/utils/audiobook-chapters.utils';
import { coverFetchInputs, resolveIsAudiobook, resolveSearchMediaKind, type CoverFetchState } from '../../common/utils/book-media.utils';
import { AudiobookChaptersService } from '../audiobook-chapters/audiobook-chapters.service';
import { BookCoverStore } from '../book-cover-store/book-cover-store.service';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { normalizePublishedDate, publishedYearFromDateKey } from '../../common/utils/published-date.utils';
import { BookReadService } from '../book/book-read.service';
import * as schema from '../../db/schema';
import { MetadataScoreService } from '../metadata-score/metadata-score.service';
import { ComicMetadataRepository } from '../metadata/comic-metadata.repository';
import { MetadataService } from '../metadata/metadata.service';
import { ExistingMetadataFields, MetadataFetchPipeline, ResolvedMetadataFields } from '../metadata-fetch/metadata-fetch-pipeline';
import { isExternalProviderIdKey, ProviderIdStore } from '../metadata-fetch/provider-ids/provider-id.store';
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
// A book answered entirely from the metadata cache made no request, so the next one starts after a
// short yield instead of the usual pause. The chain is bounded so one poll never runs unchecked.
const CACHED_CHAIN_MAX_ITEMS = 50;
const CACHED_CHAIN_MAX_MS = 30_000;
const CACHED_ITEM_YIELD_MS = 100;
const STATUS_EMIT_MIN_INTERVAL_MS = 500;

interface ProcessOutcome {
  /** Provider requests and cover downloads the book caused; 0 when everything came from the cache. */
  outboundRequests: number;
  /** The book was handed back to the queue (still importing), so the next poll should not chain onto it. */
  deferred: boolean;
}

const NO_OUTBOUND: ProcessOutcome = { outboundRequests: 0, deferred: false };

type BookReadResult = NonNullable<Awaited<ReturnType<BookReadService['findById']>>>;

@Injectable()
export class BookMetadataFetchOrchestratorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BookMetadataFetchOrchestratorService.name);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private paused = false;
  private lastStatusEmitAt = 0;
  private pendingStatusEmit: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly queueRepo: BookMetadataFetchQueueRepository,
    private readonly configService: BookMetadataFetchConfigService,
    private readonly eligibilityService: BookMetadataFetchEligibilityService,
    private readonly bookReadService: BookReadService,
    private readonly pipeline: MetadataFetchPipeline,
    private readonly metadataService: MetadataService,
    private readonly comicMetadataRepository: ComicMetadataRepository,
    private readonly scoreService: MetadataScoreService,
    private readonly bookMetadataLockService: BookMetadataLockService,
    private readonly session: BookMetadataFetchSessionService,
    private readonly throttleTracker: ProviderThrottleTracker,
    private readonly notificationService: NotificationService,
    private readonly coverStore: BookCoverStore,
    @Optional() private readonly gateway?: BookMetadataFetchGateway,
    @Optional() private readonly audiobookChapters?: AudiobookChaptersService,
    @Optional() private readonly providerIdStore?: ProviderIdStore,
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
    if (this.pendingStatusEmit) {
      clearTimeout(this.pendingStatusEmit);
      this.pendingStatusEmit = null;
    }
  }

  async scheduleImportedBooksIfEligible(libraryId: number, bookIds: readonly number[]): Promise<number> {
    const config = await this.configService.getEffectiveConfig(libraryId);
    if (!config.enabled || !config.triggerOnImport) return 0;

    const queued = await this.queueRepo.scheduleEligibleBookIdsInBatches(config, 'event_import', libraryId, bookIds, SCHEDULE_BATCH_SIZE);
    if (queued > 0) {
      this.session.addToTotal(queued);
      await this.emitStatus();
    }
    return queued;
  }

  /** Runs every books library with its own effective rule, so a library override applies here too. */
  async triggerGlobal(ignoreCache = false): Promise<number> {
    const startedAt = Date.now();
    const libraryIds = await this.configService.bookLibraryIds();
    this.logger.log(
      `[book.metadata_fetch.run_all] [start] libraries=${libraryIds.length} ignoreCache=${ignoreCache} - metadata fetch run started for every library`,
    );
    let queued = 0;
    for (const libraryId of libraryIds) {
      const config = await this.configService.getEffectiveConfig(libraryId);
      const libraryQueued = await this.queueRepo.scheduleEligibleBooksInBatches(
        config,
        'manual_trigger',
        libraryId,
        SCHEDULE_BATCH_SIZE,
        ignoreCache,
      );
      await this.configService.recordLibraryRun(libraryId, libraryQueued);
      queued += libraryQueued;
    }
    this.logger.log(
      `[book.metadata_fetch.run_all] [end] libraries=${libraryIds.length} queued=${queued} durationMs=${Date.now() - startedAt} - metadata fetch run scheduled`,
    );
    await this.unpauseIfNeeded();
    if (queued > 0) {
      this.session.addToTotal(queued);
      await this.emitStatus();
      void this.pollOnce();
    }
    return queued;
  }

  async triggerForLibrary(libraryId: number, ignoreCache = false): Promise<number> {
    const config = await this.configService.getEffectiveConfig(libraryId);
    const queued = await this.queueRepo.scheduleEligibleBooksInBatches(config, 'manual_trigger', libraryId, SCHEDULE_BATCH_SIZE, ignoreCache);
    await this.configService.recordLibraryRun(libraryId, queued);
    await this.unpauseIfNeeded();
    if (queued > 0) {
      this.session.addToTotal(queued);
      await this.emitStatus();
      void this.pollOnce();
    }
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

      const chainStartedAt = Date.now();
      for (let processed = 0; ; processed++) {
        if (this.paused) return;
        const dueRows = await this.queueRepo.fetchDue(BATCH_SIZE);
        if (dueRows.length === 0) return;
        const row = dueRows[0];
        const outcome = await this.processOne(row.bookId, row.title, row.reason, row.ignoreCache);
        if (outcome.outboundRequests > 0 || outcome.deferred) {
          await this.randomDelay();
          return;
        }
        if (processed + 1 >= CACHED_CHAIN_MAX_ITEMS || Date.now() - chainStartedAt >= CACHED_CHAIN_MAX_MS) return;
        await new Promise((resolve) => setTimeout(resolve, CACHED_ITEM_YIELD_MS));
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

  private async processOne(
    bookId: number,
    title: string | null,
    reason: BookMetadataFetchReason = 'manual_trigger',
    ignoreCache = false,
  ): Promise<ProcessOutcome> {
    const startedAt = Date.now();
    const claimed = await this.queueRepo.markProcessing(bookId);
    if (!claimed) return NO_OUTBOUND;
    this.session.setCurrentItemName(title ?? null);
    this.logger.debug(`[book.metadata_fetch] [start] bookId=${bookId} - metadata fetch started`);
    await this.emitStatus();

    try {
      const found = await this.bookReadService.findById(bookId);
      if (!found) {
        await this.completeMissingBook(bookId, startedAt);
        return NO_OUTBOUND;
      }

      const { book, authorRows, genreRows, narratorRows, communityRatingRows, fileRows } = found;
      const meta = book.book_metadata;
      const libraryId = book.books.libraryId;

      if (book.books.status === 'processing') {
        await this.queueRepo.deferProcessing(bookId);
        this.session.setCurrentItemName(null);
        this.logger.debug(
          `[book.metadata_fetch] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} outcome=awaiting_import_completion - metadata fetch deferred`,
        );
        await this.emitStatus();
        return { outboundRequests: 0, deferred: true };
      }

      if (book.books.status !== undefined && book.books.status !== 'present') {
        await this.queueRepo.markDone(bookId);
        this.session.incrementDone();
        this.session.setCurrentItemName(null);
        this.logger.debug(
          `[book.metadata_fetch] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} outcome=book_not_present - metadata fetch completed`,
        );
        await this.emitStatus();
        return NO_OUTBOUND;
      }

      const coverState = await this.coverStore.fetchState(bookId);
      if (!coverState) {
        await this.completeMissingBook(bookId, startedAt);
        return NO_OUTBOUND;
      }
      const preserveExisting = reason === 'event_import';
      if (preserveExisting) {
        const config = await this.configService.getEffectiveConfig(libraryId);
        if (!config.enabled || !config.triggerOnImport || !this.eligibilityService.isEligible(this.toEligibilityData(found, coverState), config)) {
          await this.queueRepo.markDone(bookId);
          this.session.incrementDone();
          this.session.setCurrentItemName(null);
          this.logger.debug(
            `[book.metadata_fetch] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} outcome=event_import_no_longer_eligible - metadata fetch completed`,
          );
          await this.emitStatus();
          return NO_OUTBOUND;
        }
      }

      const isAudiobook = resolveIsAudiobook(fileRows, meta, book.books.primaryFileId);
      const searchParams: MetadataSearchParams = {
        title: meta?.title ?? undefined,
        author: authorRows[0]?.name ?? undefined,
        isbn: meta?.isbn13?.trim() || meta?.isbn10?.trim() || undefined,
        seriesName: meta?.seriesName ?? undefined,
        seriesIndex: meta?.seriesIndex ?? undefined,
        existingProviderIds: { ...this.collectProviderIds(meta ?? {}), ...(await this.providerIdStore?.read(bookId)) },
        hardcoverEditionId: meta?.hardcoverEditionId ?? undefined,
        isAudiobook,
        mediaKind: resolveSearchMediaKind(fileRows, isAudiobook, book.books.primaryFileId),
        maxCandidatesPerProvider: 1,
      };

      const existingFields: ExistingMetadataFields = {
        title: meta?.title,
        subtitle: meta?.subtitle,
        description: meta?.description,
        authors: authorRows.map((a) => a.name),
        publisher: meta?.publisher,
        publishedYear: meta?.publishedYear,
        language: meta?.language,
        pageCount: meta?.pageCount,
        isbn10: meta?.isbn10,
        isbn13: meta?.isbn13,
        communityRating: communityRatingRows,
        seriesName: meta?.seriesName,
        seriesIndex: meta?.seriesIndex,
        genres: genreRows.map((g) => g.name),
        duration: meta?.durationSeconds ?? undefined,
        abridged: meta?.abridged ?? undefined,
        narrators: narratorRows.map((n) => n.name),
        chapters: meta?.chapters,
        hardcoverEditionId: meta?.hardcoverEditionId,
      };
      if (meta?.lockedFields?.length) existingFields.lockedFields = meta.lockedFields;
      const coverInputs = coverFetchInputs(coverState);
      Object.assign(existingFields, coverInputs.existing);

      if (preserveExisting) {
        existingFields.comicMetadata = await this.comicMetadataRepository.findByBookId(bookId);
      }

      const { resolved, providerIds, cache } = await this.pipeline.runWithSources(searchParams, existingFields, libraryId, {
        ...coverInputs.options,
        ...(preserveExisting ? { preserveExisting: true } : {}),
        cacheDirective: { policy: ignoreCache ? 'refresh' : 'default', allowFallback: true },
      });

      const coverDownloads = await this.persistResolved(bookId, resolved, providerIds, authorRows, genreRows, narratorRows);

      await this.scoreService.calculateAndSave(bookId);

      const outboundRequests = cache.outboundRequests + coverDownloads;
      this.logger.debug(
        `[book.metadata_fetch] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} ignoreCache=${ignoreCache} cacheServed=${cache.servedProviders.length} outbound=${outboundRequests} - metadata fetch completed`,
      );
      await this.queueRepo.markDone(bookId);
      this.session.incrementDone();
      this.session.setCurrentItemName(null);
      await this.emitStatus();
      return { outboundRequests, deferred: false };
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
      // The failure may have come mid-request, so the usual pause applies.
      return { outboundRequests: 1, deferred: false };
    }
  }

  private async persistResolved(
    bookId: number,
    resolved: ResolvedMetadataFields,
    providerIds: Partial<Record<MetadataProviderKey, string>>,
    existingAuthorRows: { name: string }[],
    existingGenreRows: { name: string }[],
    existingNarratorRows: { name: string }[],
  ): Promise<number> {
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
    const publishedDate = this.asNullablePublishedDate(filteredResolved.publishedDate);
    if (publishedDate !== undefined) {
      scalarFields.publishedDate = publishedDate;
      if (publishedDate !== null) scalarFields.publishedYear = publishedYearFromDateKey(publishedDate);
    }
    const publishedYear = this.asNullableNumber(filteredResolved.publishedYear);
    if (publishedYear !== undefined && publishedDate === undefined) {
      scalarFields.publishedDate = null;
      scalarFields.publishedYear = publishedYear;
    } else if (publishedYear !== undefined && publishedDate === null) {
      scalarFields.publishedYear = publishedYear;
    }
    const language = this.asNullableString(filteredResolved.language);
    if (language !== undefined) scalarFields.language = language;
    const pageCount = this.asNullableNumber(filteredResolved.pageCount);
    if (pageCount !== undefined) scalarFields.pageCount = pageCount;
    const isbn10 = this.asNullableString(filteredResolved.isbn10);
    if (isbn10 !== undefined) scalarFields.isbn10 = isbn10;
    const isbn13 = this.asNullableString(filteredResolved.isbn13);
    if (isbn13 !== undefined) scalarFields.isbn13 = isbn13;
    const seriesName = this.asNullableString(filteredResolved.seriesName);
    if (seriesName !== undefined) scalarFields.seriesName = seriesName;
    const seriesIndex = filteredResolved.seriesIndex === null ? null : (parseSeriesIndex(filteredResolved.seriesIndex) ?? undefined);
    if (seriesIndex !== undefined) scalarFields.seriesIndex = seriesIndex;

    if (filteredProviderIds[MetadataProviderKey.GOOGLE]) scalarFields.googleBooksId = filteredProviderIds[MetadataProviderKey.GOOGLE];
    if (filteredProviderIds[MetadataProviderKey.GOODREADS]) scalarFields.goodreadsId = filteredProviderIds[MetadataProviderKey.GOODREADS];
    if (filteredProviderIds[MetadataProviderKey.AMAZON]) scalarFields.amazonId = filteredProviderIds[MetadataProviderKey.AMAZON];
    if (filteredProviderIds[MetadataProviderKey.HARDCOVER]) scalarFields.hardcoverId = filteredProviderIds[MetadataProviderKey.HARDCOVER];
    const hardcoverEditionId = this.asNullableString(filteredResolved.hardcoverEditionId);
    if (hardcoverEditionId !== undefined) scalarFields.hardcoverEditionId = hardcoverEditionId;
    if (filteredProviderIds[MetadataProviderKey.OPEN_LIBRARY]) scalarFields.openLibraryId = filteredProviderIds[MetadataProviderKey.OPEN_LIBRARY];
    if (filteredProviderIds[MetadataProviderKey.ITUNES]) scalarFields.itunesId = filteredProviderIds[MetadataProviderKey.ITUNES];
    if (filteredProviderIds[MetadataProviderKey.AUDIBLE]) scalarFields.audibleId = filteredProviderIds[MetadataProviderKey.AUDIBLE];
    if (filteredProviderIds[MetadataProviderKey.LIBROFM]) scalarFields.librofmId = filteredProviderIds[MetadataProviderKey.LIBROFM];
    if (filteredProviderIds[MetadataProviderKey.KOBO]) scalarFields.koboId = filteredProviderIds[MetadataProviderKey.KOBO];
    if (filteredProviderIds[MetadataProviderKey.COMICVINE]) scalarFields.comicvineId = filteredProviderIds[MetadataProviderKey.COMICVINE];
    if (filteredProviderIds[MetadataProviderKey.RANOBEDB]) scalarFields.ranobedbId = filteredProviderIds[MetadataProviderKey.RANOBEDB];
    if (filteredProviderIds[MetadataProviderKey.LUBIMYCZYTAC]) scalarFields.lubimyczytacId = filteredProviderIds[MetadataProviderKey.LUBIMYCZYTAC];
    if (filteredProviderIds[MetadataProviderKey.ALADIN]) scalarFields.aladinId = filteredProviderIds[MetadataProviderKey.ALADIN];
    // Ids from external providers have no column; they land in their own table, set-only like the columns above.
    const externalIds = Object.fromEntries(Object.entries(filteredProviderIds).filter(([key, value]) => value && isExternalProviderIdKey(key)));
    if (Object.keys(externalIds).length > 0) await this.providerIdStore?.write(bookId, externalIds);

    const duration = this.asNullableNumber(filteredResolved.duration);
    if (duration !== undefined) scalarFields.durationSeconds = duration;
    // Only overwrite abridged when the provider gives a definitive boolean - never let null
    // overwrite an existing true value.
    const abridged = this.asBoolean(filteredResolved.abridged);
    if (abridged !== undefined) scalarFields.abridged = abridged;
    if (filteredResolved.chapters !== undefined) {
      const chapters = filteredResolved.chapters.length > 0 ? normalizeAudiobookChapters(filteredResolved.chapters) : null;
      scalarFields.chapters = chapters;
      Object.assign(scalarFields, chapterProvenance(chapters, 'provider'));
      await this.audiobookChapters?.recordCurrentRevision(bookId);
    }

    scalarFields.lastMetadataFetchAt = new Date();
    scalarFields.updatedAt = new Date();
    await this.bookReadService.updateMetadataFields(bookId, scalarFields);

    if (filteredResolved.communityRatings !== undefined) {
      await this.bookReadService.replaceCommunityRatings(
        bookId,
        filteredResolved.communityRatings.map((rating) => ({
          provider: rating.provider,
          rating: rating.rating,
          ratingCount: rating.ratingCount,
        })),
      );
    }

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

    // Cover downloads reach provider CDNs too, so they count against the pause between books.
    let coverDownloads = 0;
    if (filteredResolved.coverUrl) {
      coverDownloads += 1;
      await this.metadataService.downloadAndSaveCover(filteredResolved.coverChoices ?? [{ url: filteredResolved.coverUrl }], bookId, 'ebook');
    }
    if (filteredResolved.audioCoverUrl) {
      coverDownloads += 1;
      await this.metadataService.downloadAndSaveCover(
        filteredResolved.audioCoverChoices ?? [{ url: filteredResolved.audioCoverUrl }],
        bookId,
        'audio',
      );
    }
    return coverDownloads;
  }

  private async completeMissingBook(bookId: number, startedAt: number): Promise<void> {
    await this.queueRepo.markDone(bookId);
    this.session.incrementDone();
    this.session.setCurrentItemName(null);
    this.logger.debug(
      `[book.metadata_fetch] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} outcome=book_missing - metadata fetch completed`,
    );
    await this.emitStatus();
  }

  private toEligibilityData(found: BookReadResult, coverState: CoverFetchState) {
    const { book, authorRows, genreRows, narratorRows, communityRatingRows } = found;
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
      isbn10: meta?.isbn10 ?? null,
      isbn13: meta?.isbn13 ?? null,
      communityRating: communityRatingRows,
      seriesName: meta?.seriesName ?? null,
      seriesIndex: meta?.seriesIndex ?? null,
      coverSource: meta?.coverSource ?? null,
      hasAudioCoverMedia: coverState.media.hasAudio,
      hasAudioCover: coverState.filled.audio,
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
    hardcoverEditionId?: string | null;
    openLibraryId?: string | null;
    itunesId?: string | null;
    audibleId?: string | null;
    librofmId?: string | null;
    koboId?: string | null;
    comicvineId?: string | null;
    ranobedbId?: string | null;
    lubimyczytacId?: string | null;
    aladinId?: string | null;
  }): Partial<Record<MetadataProviderKey, string>> {
    const ids: Partial<Record<MetadataProviderKey, string>> = {};
    if (meta.googleBooksId) ids[MetadataProviderKey.GOOGLE] = meta.googleBooksId;
    if (meta.goodreadsId) ids[MetadataProviderKey.GOODREADS] = meta.goodreadsId;
    if (meta.amazonId) ids[MetadataProviderKey.AMAZON] = meta.amazonId;
    if (meta.hardcoverId) ids[MetadataProviderKey.HARDCOVER] = meta.hardcoverId;
    if (meta.openLibraryId) ids[MetadataProviderKey.OPEN_LIBRARY] = meta.openLibraryId;
    if (meta.itunesId) ids[MetadataProviderKey.ITUNES] = meta.itunesId;
    if (meta.audibleId) ids[MetadataProviderKey.AUDIBLE] = meta.audibleId;
    if (meta.librofmId) ids[MetadataProviderKey.LIBROFM] = meta.librofmId;
    if (meta.koboId) ids[MetadataProviderKey.KOBO] = meta.koboId;
    if (meta.comicvineId) ids[MetadataProviderKey.COMICVINE] = meta.comicvineId;
    if (meta.ranobedbId) ids[MetadataProviderKey.RANOBEDB] = meta.ranobedbId;
    if (meta.lubimyczytacId) ids[MetadataProviderKey.LUBIMYCZYTAC] = meta.lubimyczytacId;
    if (meta.aladinId) ids[MetadataProviderKey.ALADIN] = meta.aladinId;
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
            scope: { kind: 'permission', permission: Permission.ManageMetadataConfig },
            meta: { sessionTotal: snapshot.sessionTotal, sessionDone: snapshot.sessionDone, failed: summary.failed },
          })
          .catch(() => {});
      }
      this.session.reset();
    }
  }

  /** Coalesced: cached books can complete several times a second, which would flood the socket. */
  private async emitStatus(): Promise<void> {
    if (!this.gateway) return;
    const wait = STATUS_EMIT_MIN_INTERVAL_MS - (Date.now() - this.lastStatusEmitAt);
    if (wait > 0) {
      this.pendingStatusEmit ??= setTimeout(() => {
        this.pendingStatusEmit = null;
        void this.emitStatusNow().catch(() => undefined);
      }, wait);
      return;
    }
    await this.emitStatusNow();
  }

  private async emitStatusNow(): Promise<void> {
    if (!this.gateway) return;
    this.lastStatusEmitAt = Date.now();
    const summary = await this.queueRepo.getStatusSummary();
    this.gateway.emitStatus({ ...summary, paused: this.paused, ...this.session.getSnapshot() });
  }

  private asNullableString(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return typeof value === 'string' ? value : undefined;
  }

  private asNullablePublishedDate(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string') return undefined;
    return normalizePublishedDate(value) ?? undefined;
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
