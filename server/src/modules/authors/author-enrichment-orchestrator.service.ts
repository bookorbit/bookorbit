import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';

import { AppSettingsService } from '../app-settings/app-settings.service';
import { METADATA_AUTHORS_REPLACED, MetadataAuthorsReplacedEvent, MetadataEventsService } from '../metadata/metadata-events.service';
import { AuthorEnrichmentExecutorService } from './author-enrichment-executor.service';
import { AuthorEnrichmentGateway } from './author-enrichment.gateway';
import { AuthorEnrichmentRepository } from './author-enrichment.repository';

const POLL_INTERVAL_MS = 4_000;
const BATCH_SIZE = 2;
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

  private readonly handleMetadataAuthorsReplaced = (event: MetadataAuthorsReplacedEvent) => {
    void this.scheduleMany(event.authorIds, 'metadata_replace');
  };

  constructor(
    private readonly queueRepo: AuthorEnrichmentRepository,
    private readonly executor: AuthorEnrichmentExecutorService,
    private readonly appSettings: AppSettingsService,
    private readonly metadataEvents: MetadataEventsService,
    @Optional() private readonly gateway?: AuthorEnrichmentGateway,
  ) {}

  onModuleInit() {
    this.metadataEvents.on(METADATA_AUTHORS_REPLACED, this.handleMetadataAuthorsReplaced);
  }

  async onApplicationBootstrap() {
    await this.recoverStuckProcessingRows();
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

  async schedule(authorId: number, reason: string, options?: { ignoreEnabled?: boolean }): Promise<number> {
    return this.scheduleMany([authorId], reason, options);
  }

  async scheduleMany(authorIds: number[], reason: string, options?: { ignoreEnabled?: boolean }): Promise<number> {
    if (!options?.ignoreEnabled) {
      const enabled = await this.appSettings.isAuthorsAutoEnrichmentEnabled();
      if (!enabled) return 0;
    }
    const queued = await this.queueRepo.upsertSchedule(authorIds, reason);
    if (queued > 0) {
      this.logger.debug(`author.enrichment.auto.queued reason=${reason} count=${queued}`);
      await this.emitStatusSnapshot();
    }
    return queued;
  }

  async backfillLinkedAuthors(): Promise<number> {
    const queued = await this.queueRepo.enqueueAllLinkedAuthors('manual_backfill');
    await this.emitStatusSnapshot();
    return queued;
  }

  private async pollOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const enabled = await this.appSettings.isAuthorsAutoEnrichmentEnabled();
      if (!enabled) return;

      await this.recoverStuckProcessingRows();
      const dueRows = await this.queueRepo.fetchDue(BATCH_SIZE);
      for (const row of dueRows) {
        await this.processOne(row.authorId, row.attemptCount);
      }
    } catch (error) {
      this.logger.warn(`Author enrichment poll failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async processOne(authorId: number, previousAttemptCount: number): Promise<void> {
    const claimed = await this.queueRepo.markProcessing(authorId);
    if (!claimed) return;
    await this.emitStatusSnapshot();

    const [writeMode, audnexusEnabled] = await Promise.all([
      this.appSettings.getAuthorsAutoEnrichmentWriteMode(),
      this.appSettings.isAuthorsProviderAudnexusEnabled(),
    ]);

    const result = await this.executor.execute({
      authorId,
      writeMode,
      audnexusEnabled,
    });

    if (result.kind === 'done') {
      this.logger.debug(
        `author.enrichment.auto.done authorId=${authorId} provider=${result.provider ?? 'none'} descriptionUpdated=${result.descriptionUpdated} imageUpdated=${result.imageUpdated}`,
      );
      await this.queueRepo.markDone(authorId);
      await this.emitStatusSnapshot();
      return;
    }

    if (result.kind === 'skipped') {
      this.logger.debug(`author.enrichment.auto.skipped authorId=${authorId} reason=${result.reason}`);
      await this.queueRepo.markDone(authorId);
      await this.emitStatusSnapshot();
      return;
    }

    const attemptNumber = previousAttemptCount + 1;
    const finalFailure = attemptNumber >= MAX_ATTEMPTS || !result.transient;
    const nextAttemptAt = finalFailure ? null : this.computeNextAttemptAt(attemptNumber, result.retryAfterMs);

    if (nextAttemptAt) {
      this.logger.debug(
        `author.enrichment.auto.retry authorId=${authorId} attempt=${attemptNumber}/${MAX_ATTEMPTS} status=${result.httpStatus ?? 'none'} nextAttemptAt=${nextAttemptAt.toISOString()} message=${truncateError(result.message)}`,
      );
    } else {
      this.logger.warn(
        `author.enrichment.auto.failed authorId=${authorId} attempts=${attemptNumber} status=${result.httpStatus ?? 'none'} message=${truncateError(result.message)}`,
      );
    }

    await this.queueRepo.markFailed({
      authorId,
      error: truncateError(result.message),
      httpStatus: result.httpStatus,
      nextAttemptAt,
      rateLimited: result.httpStatus === 429,
    });
    await this.emitStatusSnapshot();
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

  private async emitStatusSnapshot(): Promise<void> {
    if (!this.gateway) return;
    const status = await this.queueRepo.getStatusSummary();
    this.gateway.emitStatus(status);
  }

  private async recoverStuckProcessingRows(): Promise<void> {
    const staleBefore = new Date(Date.now() - PROCESSING_STALE_AFTER_MS);
    const recovered = await this.queueRepo.recoverStuckProcessing(staleBefore);
    if (recovered > 0) {
      this.logger.warn(`author.enrichment.auto.recovered_stuck_processing count=${recovered}`);
      await this.emitStatusSnapshot();
    }
  }
}

function truncateError(message: string): string {
  if (message.length <= 1_000) return message;
  return `${message.slice(0, 997)}...`;
}
