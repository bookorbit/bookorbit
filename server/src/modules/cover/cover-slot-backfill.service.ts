import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { coverSlotsConfig } from '../../config/config';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { BookCoverEventsService } from '../book-cover-store/book-cover-events.service';
import { BookCoverStoreRepository } from '../book-cover-store/book-cover-store.repository';
import { BookCoverStore } from '../book-cover-store/book-cover-store.service';
import { CoverSlotReconciler } from '../metadata/cover-slot-reconciler.service';

const SETTING_KEY = 'cover_slots_backfill';
const VERSION = 3;
const BATCH_SIZE = 200;
const EVENT_BATCH_SIZE = 100;
const PROGRESS_EVERY = 500;
const STAGE_A_CONCURRENCY = 4;
// Stage B spawns ffmpeg for every audiobook whose audio slot is empty.
const STAGE_B_CONCURRENCY = 2;

type Stage = 'a' | 'b' | 'c';
type Marker = { version: number; stage: Stage | 'complete'; lastBookId: number };
type BackfillTotals = { processed: number; converted: number; filled: number; failed: number; repaired: number };
type BookOutcome = { libraryId: number | null; changed: boolean; converted: boolean; filled: number };

/**
 * The upgrade to per-medium cover slots. Stage A moves every legacy root cover into the slot that
 * matches its shape; stage B fills the other slot of every book that has both media; stage C
 * rewrites any `cover_source` summary that disagrees with the slots. A and B resume from an id
 * cursor, C is one idempotent statement, and none of them moves `books.updated_at`.
 */
@Injectable()
export class CoverSlotBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CoverSlotBackfillService.name);

  constructor(
    private readonly appSettings: AppSettingsService,
    private readonly repository: BookCoverStoreRepository,
    private readonly store: BookCoverStore,
    private readonly events: BookCoverEventsService,
    @Inject(coverSlotsConfig.KEY) private readonly config: ConfigType<typeof coverSlotsConfig>,
    private readonly reconciler: CoverSlotReconciler,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.backfillMode === 'skip') return;
    if (this.config.backfillMode === 'sync') {
      await this.run();
      return;
    }
    const startedAt = Date.now();
    void this.run().catch((error: unknown) => this.logFailure(error, startedAt));
  }

  async run(): Promise<BackfillTotals> {
    const totals: BackfillTotals = { processed: 0, converted: 0, filled: 0, failed: 0, repaired: 0 };
    const marker = this.parseMarker(await this.appSettings.getValue(SETTING_KEY));
    if (marker?.stage === 'complete') return totals;

    let stage: Stage = marker?.stage ?? 'a';
    let cursor = marker?.lastBookId ?? 0;
    if (stage === 'a') {
      this.add(totals, await this.runStage('a', cursor));
      stage = 'b';
      cursor = 0;
      await this.saveMarker({ version: VERSION, stage, lastBookId: cursor });
    }

    if (stage === 'b') {
      const stageB = await this.runStage('b', cursor);
      this.add(totals, stageB);
      if (stageB.failed > 0) return totals;
      await this.saveMarker({ version: VERSION, stage: 'c', lastBookId: 0 });
    }

    totals.repaired += await this.repairSummaries();
    await this.saveMarker({ version: VERSION, stage: 'complete', lastBookId: 0 });
    return totals;
  }

  private async repairSummaries(): Promise<number> {
    const startedAt = Date.now();
    this.logger.log(`[cover.slot_backfill] [start] stage=c processed=0 converted=0 filled=0 failed=0 repaired=0 - ${this.stageLabel('c')} started`);
    const repaired = await this.repository.repairCoverSummaries();
    const pendingEvents = new Map<number, number[]>();
    for (const { bookId, libraryId } of repaired) this.bufferEvent(pendingEvents, libraryId, bookId);
    this.flushEvents(pendingEvents);
    this.logger.log(
      `[cover.slot_backfill] [end] stage=c processed=0 converted=0 filled=0 failed=0 repaired=${repaired.length} durationMs=${Date.now() - startedAt} - ${this.stageLabel('c')} completed`,
    );
    return repaired.length;
  }

  private async runStage(stage: 'a' | 'b', startAfter: number): Promise<BackfillTotals> {
    const startedAt = Date.now();
    const totals: BackfillTotals = { processed: 0, converted: 0, filled: 0, failed: 0, repaired: 0 };
    const pendingEvents = new Map<number, number[]>();
    let cursor = startAfter;
    let nextProgressAt = PROGRESS_EVERY;
    const concurrency = stage === 'a' ? STAGE_A_CONCURRENCY : STAGE_B_CONCURRENCY;
    this.logger.log(
      `[cover.slot_backfill] [start] stage=${stage} processed=0 converted=0 filled=0 failed=0 lastBookId=${cursor} - ${this.stageLabel(stage)} started`,
    );

    while (true) {
      const ids =
        stage === 'a'
          ? await this.repository.listBookIdsAfter(cursor, BATCH_SIZE)
          : await this.repository.listBookIdsWithBothCoverMediaAfter(cursor, BATCH_SIZE);
      if (ids.length === 0) break;
      for (let offset = 0; offset < ids.length; offset += concurrency) {
        const batch = ids.slice(offset, offset + concurrency);
        const results = await Promise.allSettled(batch.map((bookId) => this.processBook(stage, bookId)));
        for (let index = 0; index < results.length; index++) {
          totals.processed++;
          const result = results[index]!;
          const bookId = batch[index]!;
          if (result.status === 'rejected') {
            totals.failed++;
            this.logBookFailure(stage, bookId, totals, startedAt, result.reason);
            continue;
          }
          if (result.value.converted) totals.converted++;
          totals.filled += result.value.filled;
          if (result.value.changed && result.value.libraryId !== null) this.bufferEvent(pendingEvents, result.value.libraryId, bookId);
        }
        if (totals.processed >= nextProgressAt) {
          this.logger.log(
            `[cover.slot_backfill] [end] stage=${stage} processed=${totals.processed} converted=${totals.converted} filled=${totals.filled} failed=${totals.failed} lastBookId=${batch.at(-1)!} durationMs=${Date.now() - startedAt} - progress`,
          );
          while (nextProgressAt <= totals.processed) nextProgressAt += PROGRESS_EVERY;
        }
      }
      this.flushEvents(pendingEvents);
      cursor = ids.at(-1)!;
      await this.saveMarker({ version: VERSION, stage, lastBookId: cursor });
    }

    this.flushEvents(pendingEvents);
    this.logger.log(
      `[cover.slot_backfill] [end] stage=${stage} processed=${totals.processed} converted=${totals.converted} filled=${totals.filled} failed=${totals.failed} durationMs=${Date.now() - startedAt} - ${this.stageLabel(stage)} completed`,
    );
    return totals;
  }

  private async processBook(stage: 'a' | 'b', bookId: number): Promise<BookOutcome> {
    if (stage === 'a') {
      const result = await this.store.convertLegacy(bookId, { emit: false });
      return { libraryId: result.libraryId, changed: result.converted, converted: result.converted, filled: 0 };
    }
    const result = await this.reconciler.reconcile(bookId, { backfill: true });
    return { libraryId: result.libraryId, changed: result.changed, converted: false, filled: result.filled.length };
  }

  private bufferEvent(pending: Map<number, number[]>, libraryId: number, bookId: number): void {
    const bookIds = pending.get(libraryId) ?? [];
    bookIds.push(bookId);
    pending.set(libraryId, bookIds);
    if (bookIds.length < EVENT_BATCH_SIZE) return;
    this.events.emitChanged({ bookIds, libraryId });
    pending.delete(libraryId);
  }

  private flushEvents(pending: Map<number, number[]>): void {
    for (const [libraryId, bookIds] of pending) this.events.emitChanged({ bookIds, libraryId });
    pending.clear();
  }

  private add(totals: BackfillTotals, stage: BackfillTotals): void {
    totals.processed += stage.processed;
    totals.converted += stage.converted;
    totals.filled += stage.filled;
    totals.failed += stage.failed;
    totals.repaired += stage.repaired;
  }

  private async saveMarker(marker: Marker): Promise<void> {
    await this.appSettings.setValue(SETTING_KEY, JSON.stringify(marker));
  }

  private stageLabel(stage: Stage): string {
    if (stage === 'a') return 'legacy cover conversion';
    return stage === 'b' ? 'second cover extraction' : 'cover summary repair';
  }

  /**
   * Markers older than version 3 predate stage C, and version 2's stage B chose its books with a
   * cover media query that answered the same for every book. A completed older marker therefore
   * resumes at stage B. Only unreleased builds ever wrote versions 1 and 2.
   */
  private parseMarker(raw: string | null): Omit<Marker, 'version'> | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<Marker>;
      if (!Number.isSafeInteger(parsed.lastBookId)) return null;
      if (parsed.version === 1 || parsed.version === 2) {
        if (parsed.stage === 'complete') return { stage: 'b', lastBookId: 0 };
        if (parsed.stage === 'a' || (parsed.version === 2 && parsed.stage === 'b')) return { stage: parsed.stage, lastBookId: parsed.lastBookId! };
        return null;
      }
      if (parsed.version !== VERSION || (parsed.stage !== 'a' && parsed.stage !== 'b' && parsed.stage !== 'c' && parsed.stage !== 'complete')) {
        return null;
      }
      return { stage: parsed.stage, lastBookId: parsed.lastBookId! };
    } catch {
      return null;
    }
  }

  private logBookFailure(stage: Stage, bookId: number, totals: BackfillTotals, startedAt: number, reason: unknown): void {
    const errorClass = reason instanceof Error ? reason.name : 'Error';
    const error = sanitizeLogValue(reason instanceof Error ? reason.message : String(reason));
    this.logger.warn(
      `[cover.slot_backfill] [fail] stage=${stage} bookId=${bookId} processed=${totals.processed} converted=${totals.converted} filled=${totals.filled} failed=${totals.failed} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - ${this.stageLabel(stage)} failed for one book`,
    );
  }

  private logFailure(error: unknown, startedAt: number): void {
    const errorClass = error instanceof Error ? error.name : 'Error';
    const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
    this.logger.error(
      `[cover.slot_backfill] [fail] processed=0 converted=0 filled=0 failed=0 durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - cover slot upgrade stopped`,
    );
  }
}
