import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { AuthorEnrichmentFailedPage } from '@bookorbit/types';
import { NotificationType } from '@bookorbit/types';

import { AppSettingsService } from '../app-settings/app-settings.service';
import { NotificationService } from '../notification/notification.service';
import { METADATA_AUTHORS_REPLACED, MetadataAuthorsReplacedEvent, MetadataEventsService } from '../metadata/metadata-events.service';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AuthorEnrichmentConfigService } from './author-enrichment-config.service';
import { AuthorEnrichmentExecutorService } from './author-enrichment-executor.service';
import { AuthorEnrichmentGateway } from './author-enrichment.gateway';
import { AUTHOR_ENRICHMENT_REASONS, AuthorEnrichmentReason } from './author-enrichment-reasons';
import { AuthorEnrichmentRepository } from './author-enrichment.repository';
import { AuthorEnrichmentSessionService } from './author-enrichment-session.service';

const POLL_INTERVAL_MS = 4_000;
const BATCH_SIZE = 1;
const MAX_ATTEMPTS = 6;
const BASE_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const MAX_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const PROCESSING_STALE_AFTER_MS = 10 * 60 * 1000;

@Injectable()
export class AuthorEnrichmentOrchestratorService implements OnApplicationBootstrap, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthorEnrichmentOrchestratorService.name);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private paused = false;

  private readonly handleMetadataAuthorsReplaced = (event: MetadataAuthorsReplacedEvent) => {
    void this.scheduleMany(event.authorIds, AUTHOR_ENRICHMENT_REASONS.METADATA_REPLACE);
  };

  constructor(
    private readonly queueRepo: AuthorEnrichmentRepository,
    private readonly executor: AuthorEnrichmentExecutorService,
    private readonly appSettings: AppSettingsService,
    private readonly enrichmentConfig: AuthorEnrichmentConfigService,
    private readonly metadataEvents: MetadataEventsService,
    private readonly session: AuthorEnrichmentSessionService,
    private readonly notificationService: NotificationService,
    @Optional() private readonly gateway?: AuthorEnrichmentGateway,
  ) {}

  onModuleInit() {
    this.metadataEvents.on(METADATA_AUTHORS_REPLACED, this.handleMetadataAuthorsReplaced);
  }

  async onApplicationBootstrap() {
    await this.queueRepo.resetAllProcessingOnBoot();
    this.paused = await this.enrichmentConfig.isPaused();
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, POLL_INTERVAL_MS);
    void this.pollOnce();
  }

  onModuleDestroy() {
    this.metadataEvents.off(METADATA_AUTHORS_REPLACED, this.handleMetadataAuthorsReplaced);
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async schedule(authorId: number, reason: AuthorEnrichmentReason, options?: { ignoreEnabled?: boolean }): Promise<number> {
    return this.scheduleMany([authorId], reason, options);
  }

  async scheduleMany(authorIds: number[], reason: AuthorEnrichmentReason, options?: { ignoreEnabled?: boolean }): Promise<number> {
    if (!options?.ignoreEnabled) {
      const config = await this.enrichmentConfig.getConfig();
      if (!config.enabled) return 0;
      if (reason === AUTHOR_ENRICHMENT_REASONS.METADATA_REPLACE && !config.triggerOnImport) return 0;
      authorIds = await this.queueRepo.filterEligibleAuthorIds(authorIds, config.conditions);
      if (authorIds.length === 0) return 0;
    }
    // When paused, suppress event-driven scheduling entirely. The user paused/cancelled
    // intentionally; re-queuing from background events defeats the purpose.
    // Manual triggers (backfill, retry) use ignoreEnabled and bypass this check.
    if (this.paused && !options?.ignoreEnabled) return 0;
    if (reason !== AUTHOR_ENRICHMENT_REASONS.METADATA_REPLACE) await this.finalizeCompletedSession();
    const queued = await this.queueRepo.upsertSchedule(authorIds, reason);
    if (queued > 0) {
      this.logger.debug(`[author.enrichment.queue] [end] reason=${reason} queued=${queued} - queued author enrichment jobs`);
      // metadata_replace is a background side-effect of book metadata fetch. Don't update
      // the session or emit status — these authors are enriched silently so the widget
      // doesn't flash for every book the metadata fetcher processes.
      if (reason !== AUTHOR_ENRICHMENT_REASONS.METADATA_REPLACE) {
        this.session.addToTotal(queued);
        await this.emitStatusSnapshot();
      }
    }
    return queued;
  }

  async backfillLinkedAuthors(): Promise<number> {
    const config = await this.enrichmentConfig.getConfig();
    await this.finalizeCompletedSession();
    const queued = await this.queueRepo.enqueueEligibleLinkedAuthors(AUTHOR_ENRICHMENT_REASONS.MANUAL_BACKFILL, config.conditions);
    if (queued > 0) {
      this.session.addToTotal(queued);
      await this.unpauseIfNeeded();
      await this.emitStatusSnapshot();
      void this.pollOnce();
    }
    return queued;
  }

  async backfillAllLinkedAuthors(): Promise<number> {
    await this.finalizeCompletedSession();
    const queued = await this.queueRepo.enqueueAllLinkedAuthors(AUTHOR_ENRICHMENT_REASONS.MANUAL_BACKFILL_ALL);
    if (queued > 0) {
      this.session.addToTotal(queued);
      await this.unpauseIfNeeded();
      await this.emitStatusSnapshot();
      void this.pollOnce();
    }
    return queued;
  }

  async pause(): Promise<void> {
    this.paused = true;
    await this.enrichmentConfig.setPaused(true);
    await this.emitStatusSnapshot();
  }

  async resume(): Promise<void> {
    this.paused = false;
    await this.enrichmentConfig.setPaused(false);
    await this.emitStatusSnapshot();
    void this.pollOnce();
  }

  async cancelPending(): Promise<void> {
    this.paused = true;
    await this.enrichmentConfig.setPaused(true);
    await this.queueRepo.cancelPending();
    this.session.reset();
    await this.emitStatusSnapshot();
  }

  async requeueFailed(): Promise<number> {
    await this.finalizeCompletedSession();
    const requeued = await this.queueRepo.requeueFailed();
    if (requeued > 0) {
      this.session.addToTotal(requeued);
      await this.emitStatusSnapshot();
    }
    return requeued;
  }

  async getFailedItems(page: number, limit: number): Promise<AuthorEnrichmentFailedPage> {
    const { items, total } = await this.queueRepo.getFailedItems(page, limit);
    return { items, total, page, limit };
  }

  private async pollOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.recoverStuckProcessingRows();
      await this.checkAndResetSession();

      if (this.paused) return;

      const dueRows = await this.queueRepo.fetchDue(BATCH_SIZE);
      for (const row of dueRows) {
        await this.processOne(row.authorId, row.attemptCount, row.authorName, row.reason as AuthorEnrichmentReason);
        await this.randomDelay();
      }
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(`[author.enrichment.poll] [fail] errorClass=${errorClass} error="${message}" - author enrichment poll failed`);
    } finally {
      this.running = false;
    }
  }

  private async unpauseIfNeeded(): Promise<void> {
    if (!this.paused) return;
    this.paused = false;
    await this.enrichmentConfig.setPaused(false);
  }

  private async checkAndResetSession(): Promise<void> {
    const revision = this.session.getRevision();
    const summary = await this.queueRepo.getStatusSummary();
    if (summary.queued > 0 || summary.processing > 0 || summary.rateLimited > 0) return;
    if (this.session.getRevision() !== revision) return;

    const snapshot = this.session.getSnapshot();
    if (snapshot.sessionTotal <= 0) return;
    if (!this.session.resetIfRevision(revision)) return;
    this.notifySessionCompletion(snapshot);
    await this.emitStatusSnapshot();
  }

  private async finalizeCompletedSession(): Promise<void> {
    const snapshot = this.session.getSnapshot();
    if (snapshot.sessionTotal <= 0 || snapshot.sessionDone < snapshot.sessionTotal) return;
    this.session.reset();
    this.notifySessionCompletion(snapshot);
    await this.emitStatusSnapshot();
  }

  private notifySessionCompletion(snapshot: ReturnType<AuthorEnrichmentSessionService['getSnapshot']>): void {
    const hasFailed = snapshot.sessionFailed > 0;
    this.notificationService
      .notify({
        type: hasFailed ? NotificationType.AuthorEnrichmentFailed : NotificationType.AuthorEnrichmentCompleted,
        title: hasFailed ? 'Author enrichment completed with errors' : 'Author enrichment completed',
        message: `Processed ${snapshot.sessionDone} of ${snapshot.sessionTotal} authors` + (hasFailed ? `, ${snapshot.sessionFailed} failed` : ''),
        scope: { kind: 'all' },
        meta: { sessionTotal: snapshot.sessionTotal, sessionDone: snapshot.sessionDone, failed: snapshot.sessionFailed },
      })
      .catch(() => {});
  }

  private async processOne(
    authorId: number,
    previousAttemptCount: number,
    authorName: string | null = null,
    reason: AuthorEnrichmentReason = AUTHOR_ENRICHMENT_REASONS.UNKNOWN,
  ): Promise<void> {
    const claimed = await this.queueRepo.markProcessing(authorId);
    if (!claimed) return;
    const trackSession = reason !== AUTHOR_ENRICHMENT_REASONS.METADATA_REPLACE;
    if (trackSession) {
      this.session.setCurrentItemName(authorName);
      await this.emitStatusSnapshot();
    }

    const [{ writeMode }, audnexusEnabled] = await Promise.all([
      this.enrichmentConfig.getConfig(),
      this.appSettings.isAuthorsProviderAudnexusEnabled(),
    ]);

    const result = await this.executor.execute({
      authorId,
      writeMode,
      audnexusEnabled,
    });

    if (result.kind === 'done') {
      this.logger.debug(
        `[author.enrichment.process] [end] authorId=${authorId} outcome=done provider=${result.provider ?? 'none'} descriptionUpdated=${result.descriptionUpdated} imageUpdated=${result.imageUpdated} - author enrichment processed`,
      );
      await this.queueRepo.markDone(authorId, result.imageUpdated);
      if (trackSession) {
        this.session.incrementDone();
        this.session.setCurrentItemName(null);
        await this.emitStatusSnapshot();
      }
      return;
    }

    if (result.kind === 'skipped') {
      this.logger.debug(
        `[author.enrichment.process] [end] authorId=${authorId} outcome=skipped reason=${result.reason} - author enrichment processed`,
      );
      await this.queueRepo.markDone(authorId, false);
      if (trackSession) {
        this.session.incrementDone();
        this.session.setCurrentItemName(null);
        await this.emitStatusSnapshot();
      }
      return;
    }

    const attemptNumber = previousAttemptCount + 1;
    const finalFailure = attemptNumber >= MAX_ATTEMPTS || !result.transient;
    const nextAttemptAt = finalFailure ? null : this.computeNextAttemptAt(attemptNumber, result.retryAfterMs);

    if (nextAttemptAt) {
      this.logger.debug(
        `[author.enrichment.process] [fail] authorId=${authorId} attempts=${attemptNumber}/${MAX_ATTEMPTS} status=${result.httpStatus ?? 'none'} nextAttemptAt=${nextAttemptAt.toISOString()} errorClass=AuthorEnrichmentError error="${sanitizeLogValue(truncateError(result.message))}" - author enrichment failed and will retry`,
      );
    } else {
      this.logger.warn(
        `[author.enrichment.process] [fail] authorId=${authorId} attempts=${attemptNumber} status=${result.httpStatus ?? 'none'} errorClass=AuthorEnrichmentError error="${sanitizeLogValue(truncateError(result.message))}" - author enrichment failed`,
      );
    }

    await this.queueRepo.markFailed({
      authorId,
      error: truncateError(result.message),
      httpStatus: result.httpStatus,
      nextAttemptAt,
      rateLimited: result.httpStatus === 429,
    });
    if (trackSession) {
      if (!nextAttemptAt) this.session.incrementDone(true);
      this.session.setCurrentItemName(null);
      await this.emitStatusSnapshot();
    }
  }

  private computeNextAttemptAt(attemptNumber: number, retryAfterMs: number | null): Date {
    if (retryAfterMs && retryAfterMs > 0) {
      return new Date(Date.now() + Math.min(retryAfterMs, MAX_RETRY_AFTER_MS));
    }

    const exponential = Math.min(BASE_RETRY_DELAY_MS * 2 ** (attemptNumber - 1), MAX_RETRY_DELAY_MS);
    const jitterRatio = 0.15 + Math.random() * 0.2;
    const delayMs = Math.floor(exponential * (1 + jitterRatio));
    return new Date(Date.now() + delayMs);
  }

  private randomDelay(): Promise<void> {
    const ms = 1_000 + Math.random() * 2_000;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async emitStatusSnapshot(): Promise<void> {
    if (!this.gateway) return;
    const summary = await this.queueRepo.getStatusSummary();
    this.gateway.emitStatus({ ...summary, paused: this.paused, ...this.session.getSnapshot() });
  }

  private async recoverStuckProcessingRows(): Promise<void> {
    const staleBefore = new Date(Date.now() - PROCESSING_STALE_AFTER_MS);
    const recovered = await this.queueRepo.recoverStuckProcessing(staleBefore);
    if (recovered > 0) {
      this.logger.warn(
        `[author.enrichment.recovery] [end] recoveredCount=${recovered} staleAfterMs=${PROCESSING_STALE_AFTER_MS} - recovered stuck processing rows`,
      );
      await this.emitStatusSnapshot();
    }
  }
}

function truncateError(message: string): string {
  if (message.length <= 1_000) return message;
  return `${message.slice(0, 997)}...`;
}
