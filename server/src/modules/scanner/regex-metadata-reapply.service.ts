import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  resolveRegexMetadataConfig,
  type RegexMetadataConfig,
  type RegexMetadataReapplyFailureCode,
  type RegexMetadataReapplyJob,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { mapWithConcurrency } from '../../common/utils/batch.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { LIBRARY_METADATA_PRECEDENCE_DEFAULT } from '../library/library.constants';
import { ScannerRepository } from './scanner.repository';
import { ScannerService, type LibraryRulesOutcome } from './scanner.service';

const BOOK_BATCH_SIZE = 100;
// Each book reads its primary file's embedded metadata, so this bounds open archives too.
const BOOK_CONCURRENCY = 4;
const MAX_RUNNING_JOBS = 2;
const MAX_RETAINED_JOBS = 64;
const RESULT_TTL_MS = 60 * 60 * 1000;
const MAX_FAILURE_SAMPLES = 10;

type JobEntry = { job: RegexMetadataReapplyJob; userId: number; startedAt: number; finishedAt?: number };
type Rules = { config: RegexMetadataConfig; precedence: string[] };

/**
 * Applies a library's saved path rules to the books already in it. A scan only re-reads books whose
 * files changed, so rules added or edited later would otherwise reach only new books.
 */
@Injectable()
export class RegexMetadataReapplyService implements OnModuleDestroy {
  private readonly logger = new Logger(RegexMetadataReapplyService.name);
  private readonly jobs = new Map<number, JobEntry>();
  private readonly runs = new Set<Promise<void>>();
  private stopping = false;

  constructor(
    private readonly scannerRepo: ScannerRepository,
    private readonly scanner: ScannerService,
  ) {}

  async start(libraryId: number, user: RequestUser): Promise<RegexMetadataReapplyJob> {
    const settings = await this.scannerRepo.findLibrarySettings(libraryId);
    if (!settings) throw new NotFoundException('Library not found');
    const config = resolveRegexMetadataConfig(settings.regexMetadata);
    if (!config?.rules.length) {
      throw new BadRequestException({ errorCode: 'REGEX_METADATA_NOT_CONFIGURED', message: 'Save path rules for this library first.' });
    }
    this.prune();
    if (this.jobs.get(libraryId)?.job.status === 'running') {
      throw new ConflictException({ errorCode: 'REGEX_REAPPLY_ALREADY_RUNNING', message: 'Path rules are already being applied to this library.' });
    }
    if (this.stopping || [...this.jobs.values()].filter(({ job }) => job.status === 'running').length >= MAX_RUNNING_JOBS) {
      throw new ServiceUnavailableException({ errorCode: 'REGEX_REAPPLY_BUSY', message: 'Rule application capacity is busy. Try again later.' });
    }
    if (!this.jobs.has(libraryId) && this.jobs.size >= MAX_RETAINED_JOBS) {
      const oldest = [...this.jobs.entries()]
        .filter(([, entry]) => entry.finishedAt !== undefined)
        .sort((a, b) => a[1].finishedAt! - b[1].finishedAt!)[0];
      if (oldest) this.jobs.delete(oldest[0]);
    }
    const job: RegexMetadataReapplyJob = {
      id: randomUUID(),
      libraryId,
      status: 'running',
      total: 0,
      processed: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      failureSamples: [],
    };
    const entry: JobEntry = { job, userId: user.id, startedAt: Date.now() };
    const rules: Rules = {
      config,
      precedence: settings.metadataPrecedence ?? [...LIBRARY_METADATA_PRECEDENCE_DEFAULT],
    };
    this.jobs.set(libraryId, entry);
    const run = new Promise<void>((resolve) => setImmediate(resolve)).then(() => this.run(entry, rules));
    this.runs.add(run);
    void run.finally(() => this.runs.delete(run));
    return this.snapshot(job);
  }

  get(libraryId: number, user: RequestUser): RegexMetadataReapplyJob | null {
    this.prune();
    const entry = this.jobs.get(libraryId);
    if (!entry || (entry.userId !== user.id && !user.isSuperuser)) return null;
    return this.snapshot(entry.job);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled(this.runs);
  }

  private snapshot(job: RegexMetadataReapplyJob): RegexMetadataReapplyJob {
    return { ...job, failureSamples: job.failureSamples.map((failure) => ({ ...failure })) };
  }

  private prune(): void {
    for (const [libraryId, entry] of this.jobs) {
      if (entry.finishedAt !== undefined && Date.now() - entry.finishedAt >= RESULT_TTL_MS) this.jobs.delete(libraryId);
    }
  }

  private async run(entry: JobEntry, rules: Rules): Promise<void> {
    const { job } = entry;
    this.logger.log(
      `[scanner.reapply_regex_metadata] [start] libraryId=${job.libraryId} userId=${entry.userId} jobId=${job.id} rules=${rules.config.rules.length} - applying path rules to existing books`,
    );
    try {
      const { total, maxId } = await this.scannerRepo.getRuleReapplyBounds(job.libraryId);
      job.total = total;
      let afterId = 0;
      while (afterId < maxId && job.status === 'running') {
        if (this.stopping) {
          job.status = 'failed';
          break;
        }
        const books = await this.scannerRepo.findRuleReapplyBookBatch(job.libraryId, afterId, maxId, BOOK_BATCH_SIZE);
        if (books.length === 0) break;
        await this.processBatch(entry, books, rules);
        afterId = books[books.length - 1].id;
      }
      if (job.status === 'running') {
        // Books deleted or moved after the count were never reached and count as skipped; books that
        // came back meanwhile were processed, so the total grows to include them.
        const unreached = job.total - job.processed;
        if (unreached > 0) job.skipped += unreached;
        job.total = job.processed = Math.max(job.total, job.processed);
        job.status = 'completed';
      }
    } catch (error) {
      job.status = 'failed';
      this.logFailure(entry, error);
    } finally {
      entry.finishedAt = Date.now();
      this.logger.log(
        `[scanner.reapply_regex_metadata] [end] libraryId=${job.libraryId} userId=${entry.userId} jobId=${job.id} durationMs=${entry.finishedAt - entry.startedAt} status=${job.status} total=${job.total} processed=${job.processed} updated=${job.updated} unchanged=${job.unchanged} skipped=${job.skipped} failed=${job.failed} - path rules applied`,
      );
    }
  }

  private async processBatch(entry: JobEntry, books: { id: number; primaryFileId: number | null }[], rules: Rules): Promise<void> {
    const { job } = entry;
    const files = await this.scannerRepo.findBookFilesByBookIds(books.map(({ id }) => id));
    const filesByBook = new Map<number, typeof files>();
    for (const file of files) {
      const list = filesByBook.get(file.bookId);
      if (list) list.push(file);
      else filesByBook.set(file.bookId, [file]);
    }
    const unavailable: typeof books = [];
    const apply = async (book: (typeof books)[number], retry: boolean) => {
      if (job.status !== 'running') return;
      let outcome: LibraryRulesOutcome;
      try {
        outcome = await this.scanner.applyLibraryRulesToBook(book, filesByBook.get(book.id) ?? [], rules);
      } catch (error) {
        this.recordFailure(job, book.id, 'metadata_failed');
        this.logFailure(entry, error, book.id);
        return;
      }
      if (outcome === 'rules_unavailable' && retry) unavailable.push(book);
      else if (outcome === 'updated' || outcome === 'unchanged' || outcome === 'skipped') {
        job[outcome]++;
        job.processed++;
      } else if (outcome === 'rules_invalid') {
        // Rules that cannot compile fail every book the same way, so the first one ends the job.
        if (job.status !== 'running') return;
        job.status = 'failed';
        this.recordFailure(job, book.id, 'rules_invalid');
        this.logFailure(entry, new Error('the saved path rules could not be compiled'), book.id);
      } else this.recordFailure(job, book.id, outcome);
    };
    await mapWithConcurrency(books, BOOK_CONCURRENCY, (book) => apply(book, true));
    // The rule worker's time limit runs on the main thread, which concurrent archive reads can stall;
    // one at a time, with nothing else from this job in flight, a book gets a fair second chance.
    for (const book of unavailable) await apply(book, false);
  }

  private recordFailure(job: RegexMetadataReapplyJob, bookId: number, code: RegexMetadataReapplyFailureCode): void {
    job.failed++;
    job.processed++;
    if (job.failureSamples.length < MAX_FAILURE_SAMPLES) job.failureSamples.push({ bookId, code });
  }

  private logFailure(entry: JobEntry, error: unknown, bookId?: number): void {
    const errorClass = error instanceof Error ? error.name : 'Error';
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `[scanner.reapply_regex_metadata] [fail] libraryId=${entry.job.libraryId} userId=${entry.userId} jobId=${entry.job.id}${bookId === undefined ? '' : ` bookId=${bookId}`} durationMs=${Date.now() - entry.startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - path rules could not be applied`,
    );
  }
}
