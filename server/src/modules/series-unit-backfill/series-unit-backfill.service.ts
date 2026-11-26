import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { resolveRegexMetadataConfig, seriesUnitClass, type RegexMetadataConfig, type RegexMetadataFields } from '@bookorbit/types';

import { APP_SETTING_KEYS } from '../../common/constants/app-settings.constants';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { seriesUnitsApplyToPath } from '../../common/utils/series-unit.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { RegexMetadataService, isTransientRegexFailure } from '../metadata/regex/regex-metadata.service';
import { SeriesUnitBackfillRepository, type SeriesUnitBackfillCandidate, type SeriesUnitBackfillWrite } from './series-unit-backfill.repository';

const EVENT = 'series.unit_backfill';
const BATCH_SIZE = 500;
const PROGRESS_EVERY_BATCHES = 20;
/** Matches the scanner: after this many pool failures a library's rules are left alone for the run. */
const LIBRARY_FAILURE_LIMIT = 3;
const SHUTDOWN_WAIT_MS = 5_000;

export type SeriesUnitBackfillCounts = {
  scanned: number;
  updated: number;
  locked: number;
  /** Books whose rules could not be read, or whose write the database refused. */
  failed: number;
  /** Books passed over because their library's rules were set aside for the run. */
  skipped: number;
  volume: number;
  chapter: number;
  issue: number;
};

type LibraryState = {
  rules: RegexMetadataConfig | null;
  failures: number;
  disabled: boolean;
  /** Set aside for pool failures rather than broken rules, so a later boot tries again. */
  retryLater: boolean;
};

type PassResult = { counts: SeriesUnitBackfillCounts; stopped: boolean; retryLater: boolean };

/**
 * Gives the comic books already in a library the unit their file name names (`v03`, `c012`, `#7`),
 * once per database, so upgrading does not wait for a rescan. It reads only the stored path through
 * the library's own path rules, sets a unit only where those rules read the number the book already
 * has, and never touches the number or any other field. Books with a locked series are skipped.
 *
 * One book's failure never ends the pass. Like the scanner, rules that cannot compile set their
 * library aside for the run, and a library whose rules keep timing out is set aside after three.
 * The flag is written after a full pass unless the server began stopping or a library was set aside
 * for timeouts; then the next boot runs again, and the writes already made are not repeated (they
 * need an empty unit).
 */
@Injectable()
export class SeriesUnitBackfillService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SeriesUnitBackfillService.name);
  private running: Promise<SeriesUnitBackfillCounts | null> | null = null;
  private stopRequested = false;

  constructor(
    private readonly repository: SeriesUnitBackfillRepository,
    private readonly regexMetadata: RegexMetadataService,
    private readonly appSettings: AppSettingsService,
  ) {}

  onApplicationBootstrap(): void {
    // Startup must not wait on a pass over the whole library.
    void this.runOnce();
  }

  /** Gives the pass until its next book to stop, so its last write is not cut off. */
  async onModuleDestroy(): Promise<void> {
    this.stopRequested = true;
    if (!this.running) return;
    await Promise.race([this.running, new Promise((resolve) => setTimeout(resolve, SHUTDOWN_WAIT_MS).unref())]);
  }

  /** Runs the pass unless an earlier boot finished it; a call during a pass joins that pass. */
  runOnce(): Promise<SeriesUnitBackfillCounts | null> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<SeriesUnitBackfillCounts | null> {
    const startedAt = Date.now();
    try {
      if (await this.appSettings.getValue(APP_SETTING_KEYS.SERIES_UNITS_BACKFILLED)) return null;
      this.logger.log(`[${EVENT}] [start] batchSize=${BATCH_SIZE} - classifying comic books by their file names`);
      const { counts, stopped, retryLater } = await this.pass(startedAt);
      const outcome = stopped ? 'stopped' : retryLater ? 'incomplete' : 'done';
      if (outcome === 'done') await this.appSettings.setValue(APP_SETTING_KEYS.SERIES_UNITS_BACKFILLED, new Date().toISOString());
      const message =
        outcome === 'done'
          ? 'comic book units set'
          : outcome === 'stopped'
            ? 'server stopping; the next boot carries on'
            : 'path rules kept timing out; the next boot tries again';
      this.logger.log(`[${EVENT}] [end] durationMs=${Date.now() - startedAt} outcome=${outcome} ${this.describe(counts)} - ${message}`);
      return outcome === 'done' ? counts : null;
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${EVENT}] [fail] durationMs=${Date.now() - startedAt} stopping=${this.isStopping()} errorClass=${errorClass} error="${errorMessage}" - comic book unit backfill failed; the next boot tries again`,
      );
      return null;
    }
  }

  private async pass(startedAt: number): Promise<PassResult> {
    const counts: SeriesUnitBackfillCounts = { scanned: 0, updated: 0, locked: 0, failed: 0, skipped: 0, volume: 0, chapter: 0, issue: 0 };
    const libraries = new Map<number, LibraryState>();
    const result = (stopped: boolean): PassResult => ({ counts, stopped, retryLater: [...libraries.values()].some((library) => library.retryLater) });
    let after = 0;
    for (let batches = 1; ; batches++) {
      if (this.isStopping()) return result(true);
      const batch = await this.repository.findCandidates(after, BATCH_SIZE);
      if (batch.length === 0) return result(false);
      after = batch[batch.length - 1]!.bookId;

      const writes: SeriesUnitBackfillWrite[] = [];
      for (const candidate of batch) {
        if (this.isStopping()) break;
        counts.scanned++;
        if (candidate.lockedFields.includes('seriesName') || candidate.lockedFields.includes('seriesIndex')) {
          counts.locked++;
          continue;
        }
        const library = this.libraryState(libraries, candidate);
        if (library.disabled) {
          counts.skipped++;
          continue;
        }
        const write = await this.classify(candidate, library, counts);
        if (write) writes.push(write);
      }
      // Books already classified are kept even when the server is stopping.
      await this.write(writes, counts);
      if (this.isStopping()) return result(true);
      if (batches % PROGRESS_EVERY_BATCHES === 0) {
        this.logger.log(
          `[${EVENT}_batch] [end] batches=${batches} lastBookId=${after} durationMs=${Date.now() - startedAt} ${this.describe(counts)} - still classifying`,
        );
      }
    }
  }

  private libraryState(libraries: Map<number, LibraryState>, candidate: SeriesUnitBackfillCandidate): LibraryState {
    let library = libraries.get(candidate.libraryId);
    if (library) return library;
    library = { rules: null, failures: 0, disabled: false, retryLater: false };
    libraries.set(candidate.libraryId, library);
    try {
      const rules = resolveRegexMetadataConfig(candidate.rules);
      library.rules = Array.isArray(rules?.rules) && rules.rules.length ? rules : null;
    } catch (err) {
      // Stored rules of the wrong shape can never run; the library is passed over, the pass goes on.
      library.disabled = true;
      this.logBookFailure(candidate, Date.now(), err, library);
    }
    return library;
  }

  private async classify(
    candidate: SeriesUnitBackfillCandidate,
    library: LibraryState,
    counts: SeriesUnitBackfillCounts,
  ): Promise<SeriesUnitBackfillWrite | null> {
    if (!library.rules || !seriesUnitsApplyToPath(candidate.relPath)) return null;
    const startedAt = Date.now();
    let error: unknown;
    try {
      const result = await this.regexMetadata.evaluate(library.rules, candidate.relPath);
      const failure = result.diagnostics.find((entry) => entry.code !== 'invalid_value');
      if (!failure) return this.toWrite(candidate, result.metadata, result.matched);
      // A pool that shut down answers every book this way; that is the server stopping, not the book.
      if (this.isStopping()) return null;
      error = failure.code;
      if (isTransientRegexFailure(failure.code)) {
        library.failures++;
        if (library.failures >= LIBRARY_FAILURE_LIMIT) library.retryLater = library.disabled = true;
      } else {
        library.disabled = true;
      }
    } catch (err) {
      // Rules the evaluator refuses outright fail every book in the library the same way.
      library.disabled = true;
      error = err;
    }
    counts.failed++;
    this.logBookFailure(candidate, startedAt, error, library);
    return null;
  }

  private logBookFailure(candidate: SeriesUnitBackfillCandidate, startedAt: number, error: unknown, library: LibraryState): void {
    const errorClass = error instanceof Error ? error.name : 'RegexEvaluationError';
    const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
    this.logger.warn(
      `[${EVENT}_book] [fail] libraryId=${candidate.libraryId} bookId=${candidate.bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" libraryDisabled=${library.disabled} - book left without a unit`,
    );
  }

  private toWrite(candidate: SeriesUnitBackfillCandidate, metadata: RegexMetadataFields, matched: boolean): SeriesUnitBackfillWrite | null {
    const { seriesIndex, seriesUnit, seriesVolumeIndex } = metadata;
    // The unit describes the number the rule read, so it only lands where the book keeps that number.
    if (!matched || !seriesUnit || seriesIndex === undefined || Number(seriesIndex) !== Number(candidate.seriesIndex)) return null;
    // A volume has no volume number of its own; only chapters and issues carry the one they sit in.
    const volumeIndex = seriesUnitClass(seriesUnit) === 'chapter' ? (seriesVolumeIndex ?? null) : null;
    return { bookId: candidate.bookId, seriesIndex: candidate.seriesIndex, unit: seriesUnit, volumeIndex };
  }

  private async write(writes: SeriesUnitBackfillWrite[], counts: SeriesUnitBackfillCounts): Promise<void> {
    if (writes.length === 0) return;
    try {
      this.record(writes, await this.repository.writeUnits(writes), counts);
      return;
    } catch (err) {
      let failed = writes.length;
      let lastError: unknown = err;
      if (writes.length > 1) {
        // One row the database refuses fails the whole batch; write the books one by one to find it.
        failed = 0;
        for (const write of writes) {
          try {
            this.record([write], await this.repository.writeUnits([write]), counts);
          } catch (error) {
            failed++;
            lastError = error;
          }
        }
        // Every book failing means the database itself is the problem; the pass ends and the next boot retries.
        if (failed === writes.length) throw lastError;
      }
      counts.failed += failed;
      const errorClass = lastError instanceof Error ? lastError.name : 'Error';
      const errorMessage = sanitizeLogValue(lastError instanceof Error ? lastError.message : String(lastError));
      this.logger.warn(
        `[${EVENT}_write] [fail] books=${writes.length} failed=${failed} errorClass=${errorClass} error="${errorMessage}" - books the database refused were left without a unit`,
      );
    }
  }

  private record(writes: SeriesUnitBackfillWrite[], writtenIds: number[], counts: SeriesUnitBackfillCounts): void {
    const written = new Set(writtenIds);
    for (const write of writes) {
      if (!written.has(write.bookId)) continue;
      counts.updated++;
      counts[write.unit]++;
    }
  }

  private isStopping(): boolean {
    return this.stopRequested || this.regexMetadata.stopping;
  }

  private describe(counts: SeriesUnitBackfillCounts): string {
    return `scanned=${counts.scanned} updated=${counts.updated} locked=${counts.locked} failed=${counts.failed} skipped=${counts.skipped} volume=${counts.volume} chapter=${counts.chapter} issue=${counts.issue}`;
  }
}
