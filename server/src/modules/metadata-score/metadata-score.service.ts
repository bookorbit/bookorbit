import { Injectable, Logger } from '@nestjs/common';

import type { MetadataScoreWeights } from '@projectx/types';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { MetadataScoreRepository } from './metadata-score.repository';
import { MetadataScoreScorer, type ScoreData } from './metadata-score.scorer';

const RECALCULATION_PAGE_SIZE = 200;
const RECALCULATION_WRITE_CONCURRENCY = 25;
const RECALCULATION_EVENT = 'metadata_score.recalculate_all';
const RECALCULATION_BOOK_EVENT = 'metadata_score.recalculate_book';

export enum MetadataRecalculationTrigger {
  MANUAL = 'manual',
  WEIGHTS_UPDATE = 'weights_update',
}

export type MetadataRecalculationState = 'idle' | 'running' | 'completed' | 'failed';

export type MetadataRecalculationStatus = {
  state: MetadataRecalculationState;
  trigger: MetadataRecalculationTrigger | null;
  startedAt: Date | null;
  endedAt: Date | null;
  processed: number;
  succeeded: number;
  failed: number;
  error: string | null;
};

@Injectable()
export class MetadataScoreService {
  private readonly logger = new Logger(MetadataScoreService.name);
  private runningPromise: Promise<void> | null = null;
  private status: MetadataRecalculationStatus = this.makeInitialStatus();

  constructor(
    private readonly repo: MetadataScoreRepository,
    private readonly scorer: MetadataScoreScorer,
    private readonly appSettings: AppSettingsService,
  ) {}

  async getWeights(): Promise<MetadataScoreWeights> {
    return this.appSettings.getMetadataScoreWeights();
  }

  getRecalculationStatus(): MetadataRecalculationStatus {
    return { ...this.status };
  }

  async updateWeights(weights: MetadataScoreWeights): Promise<MetadataScoreWeights> {
    await this.appSettings.setMetadataScoreWeights(weights);
    this.requestRecalculation(MetadataRecalculationTrigger.WEIGHTS_UPDATE);
    return weights;
  }

  requestRecalculation(trigger: MetadataRecalculationTrigger): { started: boolean; status: MetadataRecalculationStatus } {
    if (this.runningPromise) {
      return { started: false, status: this.getRecalculationStatus() };
    }

    this.runningPromise = this.runRecalculation(trigger).finally(() => {
      this.runningPromise = null;
    });

    return { started: true, status: this.getRecalculationStatus() };
  }

  async calculateAndSave(bookId: number): Promise<void> {
    const [data, weights] = await Promise.all([this.repo.loadScoreData(bookId), this.appSettings.getMetadataScoreWeights()]);
    if (!data) return;
    const score = this.scorer.compute(data, weights);
    await this.repo.updateMetadataScore(bookId, score);
  }

  private async runRecalculation(trigger: MetadataRecalculationTrigger): Promise<void> {
    const startedAt = Date.now();
    this.status = {
      state: 'running',
      trigger,
      startedAt: new Date(startedAt),
      endedAt: null,
      processed: 0,
      succeeded: 0,
      failed: 0,
      error: null,
    };
    this.logger.log(`[${RECALCULATION_EVENT}] [start] trigger=${trigger} - metadata score recalculation started`);

    try {
      const weights = await this.appSettings.getMetadataScoreWeights();
      let cursor: number | null = null;
      while (true) {
        const page = await this.repo.loadScoreDataPage(cursor, RECALCULATION_PAGE_SIZE);
        if (page.rows.length === 0) break;

        for (let i = 0; i < page.rows.length; i += RECALCULATION_WRITE_CONCURRENCY) {
          const chunk = page.rows.slice(i, i + RECALCULATION_WRITE_CONCURRENCY);
          const outcomes = await Promise.all(chunk.map((row) => this.recalculateBook(row.bookId, row.data, weights)));
          this.status.processed += outcomes.length;
          this.status.succeeded += outcomes.filter((ok) => ok).length;
          this.status.failed += outcomes.filter((ok) => !ok).length;
        }

        cursor = page.nextCursor;
      }

      this.status = {
        ...this.status,
        state: 'completed',
        endedAt: new Date(),
      };
      this.logger.log(
        `[${RECALCULATION_EVENT}] [end] trigger=${trigger} durationMs=${Date.now() - startedAt} processed=${this.status.processed} succeeded=${this.status.succeeded} failed=${this.status.failed} - metadata score recalculation completed`,
      );
    } catch (err) {
      const { errorClass, errorMessage } = this.parseError(err);
      this.status = {
        ...this.status,
        state: 'failed',
        endedAt: new Date(),
        error: errorMessage,
      };
      this.logger.warn(
        `[${RECALCULATION_EVENT}] [fail] trigger=${trigger} durationMs=${Date.now() - startedAt} processed=${this.status.processed} succeeded=${this.status.succeeded} failed=${this.status.failed} errorClass=${errorClass} error="${errorMessage}" - metadata score recalculation failed`,
      );
    }
  }

  private async recalculateBook(bookId: number, data: ScoreData, weights: MetadataScoreWeights): Promise<boolean> {
    const startedAt = Date.now();
    try {
      const score = this.scorer.compute(data, weights);
      await this.repo.updateMetadataScore(bookId, score);
      return true;
    } catch (err) {
      const { errorClass, errorMessage } = this.parseError(err);
      this.logger.warn(
        `[${RECALCULATION_BOOK_EVENT}] [fail] bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - metadata score update failed`,
      );
      return false;
    }
  }

  private parseError(err: unknown): { errorClass: string; errorMessage: string } {
    if (err instanceof Error) {
      return {
        errorClass: err.constructor.name,
        errorMessage: this.sanitizeErrorMessage(err.message),
      };
    }

    return {
      errorClass: 'UnknownError',
      errorMessage: this.sanitizeErrorMessage(String(err)),
    };
  }

  private sanitizeErrorMessage(message: string): string {
    return message.replace(/[\r\n"]/g, ' ').slice(0, 200);
  }

  private makeInitialStatus(): MetadataRecalculationStatus {
    return {
      state: 'idle',
      trigger: null,
      startedAt: null,
      endedAt: null,
      processed: 0,
      succeeded: 0,
      failed: 0,
      error: null,
    };
  }
}
