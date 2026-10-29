import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { appConfig } from '../../config/config';
import { ChapterEditorService } from '../chapter-editor/chapter-editor.service';
import { ChapterHealthRepository } from './chapter-health.repository';

const TICK_MS = 3_000;
/** Lookups run one at a time with this much air between them, so Audible sees a steady trickle. */
const GAP_MS = 1_500;
const BOOKS_PER_TICK = 10;
const MAX_ATTEMPTS = 3;
/** Wait before the second and third tries, so a brief outage on Audible's side does not end the book's chances. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000];

/**
 * Works through the bulk chapter lookup queue. The queue lives in the database, so a restart picks
 * up where it stopped: anything that was mid-lookup goes back to waiting and runs again.
 */
@Injectable()
export class ChapterLookupWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChapterLookupWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly repo: ChapterHealthRepository,
    private readonly editor: ChapterEditorService,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.repo.requeueProcessing();
    // Tests drive tick() themselves, so a suite never reaches Audible from a timer it did not start.
    if (this.app.nodeEnv === 'test') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      await this.repo.requeueProcessing(true);
      for (let done = 0; done < BOOKS_PER_TICK && !this.stopped; done += 1) {
        const job = await this.repo.claimNext();
        if (!job) break;
        await this.process(job);
        await new Promise((resolve) => setTimeout(resolve, GAP_MS));
      }
    } catch (error) {
      this.logger.warn(
        `[chapter_lookup.tick] [fail] error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - queue tick failed`,
      );
    } finally {
      this.running = false;
    }
  }

  private async process(job: { bookId: number; userId: number | null; attemptCount: number; claimToken: string }): Promise<void> {
    const event = 'chapter_lookup.book';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] bookId=${job.bookId} userId=${job.userId ?? 'null'} attempt=${job.attemptCount} - bulk chapter lookup started`,
    );
    try {
      const outcome = await this.editor.bulkLookup(job.bookId, job.userId);
      await this.repo.finish(job.bookId, outcome, job.claimToken);
      this.logger.log(
        `[${event}] [end] bookId=${job.bookId} durationMs=${Date.now() - startedAt} status=${outcome.status} reason=${outcome.reason ?? 'none'} - bulk chapter lookup finished`,
      );
    } catch (error) {
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error)).slice(0, 500);
      const errorClass = error instanceof Error ? error.name : 'Error';
      if (job.attemptCount < MAX_ATTEMPTS) {
        await this.repo.retryLater(job.bookId, message, RETRY_DELAYS_MS[Math.min(job.attemptCount, RETRY_DELAYS_MS.length) - 1]!, job.claimToken);
      } else {
        await this.repo.finish(job.bookId, { status: 'failed', reason: null, result: null, lastError: message }, job.claimToken);
      }
      this.logger.warn(
        `[${event}] [fail] bookId=${job.bookId} durationMs=${Date.now() - startedAt} attempt=${job.attemptCount} errorClass=${errorClass} error="${message}" - bulk chapter lookup failed`,
      );
    }
  }
}
