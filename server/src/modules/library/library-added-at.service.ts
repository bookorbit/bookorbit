import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { realpath, stat } from 'fs/promises';
import { isAbsolute, relative, sep } from 'path';
import type { AddedAtRecomputeFailureCode, AddedAtRecomputeJob } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { usableFileTime } from '../../common/utils/file-time.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { PathPolicyService } from '../path/path-policy.service';
import { LibraryRepository } from './library.repository';

const BOOK_BATCH_SIZE = 100;
const FILE_BATCH_SIZE = 200;
const STAT_CONCURRENCY = 10;
const MAX_RUNNING_JOBS = 2;
const MAX_RETAINED_JOBS = 64;
const RESULT_TTL_MS = 60 * 60 * 1000;
const MAX_FAILURE_SAMPLES = 10;

type JobEntry = { job: AddedAtRecomputeJob; userId: number; startedAt: number; finishedAt?: number };
type FileRow = Awaited<ReturnType<LibraryRepository['findAddedAtFileBatch']>>[number];

@Injectable()
export class LibraryAddedAtService implements OnModuleDestroy {
  private readonly logger = new Logger(LibraryAddedAtService.name);
  private readonly jobs = new Map<number, JobEntry>();
  private readonly runs = new Set<Promise<void>>();
  private stopping = false;

  constructor(
    private readonly libraryRepo: LibraryRepository,
    private readonly pathPolicy: PathPolicyService,
  ) {}

  async start(libraryId: number, user: RequestUser): Promise<AddedAtRecomputeJob> {
    await this.assertAccess(libraryId, user);
    const [library] = await this.libraryRepo.findById(libraryId);
    if (!library) throw new NotFoundException('Library not found');
    if (library.addedAtSource !== 'file_created' && library.addedAtSource !== 'file_modified') {
      throw new BadRequestException({ errorCode: 'ADDED_AT_SOURCE_IMPORTED', message: 'Select a file timestamp source before recomputing.' });
    }
    this.prune();
    if (this.jobs.get(libraryId)?.job.status === 'running') {
      throw new ConflictException({ errorCode: 'ADDED_AT_ALREADY_RUNNING', message: 'A recompute is already running for this library.' });
    }
    if (this.stopping || [...this.jobs.values()].filter(({ job }) => job.status === 'running').length >= MAX_RUNNING_JOBS) {
      throw new ServiceUnavailableException({ errorCode: 'ADDED_AT_BUSY', message: 'Recompute capacity is busy. Try again later.' });
    }
    if (!this.jobs.has(libraryId) && this.jobs.size >= MAX_RETAINED_JOBS) {
      const oldest = [...this.jobs.entries()]
        .filter(([, entry]) => entry.finishedAt !== undefined)
        .sort((a, b) => a[1].finishedAt! - b[1].finishedAt!)[0];
      if (oldest) this.jobs.delete(oldest[0]);
    }
    const job: AddedAtRecomputeJob = {
      id: randomUUID(),
      libraryId,
      source: library.addedAtSource,
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
    this.jobs.set(libraryId, entry);
    const run = new Promise<void>((resolve) => setImmediate(resolve)).then(() => this.run(entry));
    this.runs.add(run);
    void run.finally(() => this.runs.delete(run));
    return this.snapshot(job);
  }

  async get(libraryId: number, user: RequestUser): Promise<AddedAtRecomputeJob | null> {
    await this.assertAccess(libraryId, user);
    this.prune();
    const entry = this.jobs.get(libraryId);
    if (!entry || (entry.userId !== user.id && !user.isSuperuser)) return null;
    return this.snapshot(entry.job);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled(this.runs);
  }

  private async assertAccess(libraryId: number, user: RequestUser): Promise<void> {
    if (!user.isSuperuser && !(await this.libraryRepo.hasUserAccess(user.id, libraryId))) {
      throw new ForbiddenException('No access to this library');
    }
  }

  private snapshot(job: AddedAtRecomputeJob): AddedAtRecomputeJob {
    return { ...job, failureSamples: job.failureSamples.map((failure) => ({ ...failure })) };
  }

  private prune(): void {
    for (const [libraryId, entry] of this.jobs) {
      if (entry.finishedAt !== undefined && Date.now() - entry.finishedAt >= RESULT_TTL_MS) this.jobs.delete(libraryId);
    }
  }

  private async run(entry: JobEntry): Promise<void> {
    const { job } = entry;
    this.logger.log(
      `[library.recompute_added_at] [start] libraryId=${job.libraryId} userId=${entry.userId} jobId=${job.id} source=${job.source} - recompute started`,
    );
    try {
      const { total, maxId } = await this.libraryRepo.getAddedAtRecomputeBounds(job.libraryId);
      job.total = total;
      let afterId = 0;
      while (afterId < maxId) {
        if (this.stopping) {
          job.status = 'failed';
          break;
        }
        const books = await this.libraryRepo.findAddedAtBookBatch(job.libraryId, afterId, maxId, BOOK_BATCH_SIZE);
        if (books.length === 0) break;
        await this.processBatch(entry, books);
        afterId = books[books.length - 1].id;
      }
      if (job.status === 'running') {
        // Books deleted or moved after the initial count no longer belong to this operation.
        job.skipped += Math.max(0, job.total - job.processed);
        job.processed = job.total;
        job.status = 'completed';
      }
    } catch (error) {
      job.status = 'failed';
      this.logFailure(entry, error);
    } finally {
      entry.finishedAt = Date.now();
      this.logger.log(
        `[library.recompute_added_at] [end] libraryId=${job.libraryId} userId=${entry.userId} jobId=${job.id} source=${job.source} durationMs=${entry.finishedAt - entry.startedAt} status=${job.status} total=${job.total} processed=${job.processed} updated=${job.updated} unchanged=${job.unchanged} skipped=${job.skipped} failed=${job.failed} - recompute finished`,
      );
    }
  }

  private async processBatch(entry: JobEntry, books: Awaited<ReturnType<LibraryRepository['findAddedAtBookBatch']>>): Promise<void> {
    const { job } = entry;
    const earliest = new Map<number, Date>();
    const failures = new Map<number, AddedAtRecomputeFailureCode>();
    let afterFileId = 0;
    if (job.source === 'file_modified') {
      const times = await this.libraryRepo.findAddedAtMtimes(
        job.libraryId,
        books.map(({ id }) => id),
      );
      for (const { bookId, mtime } of times) {
        const time = usableFileTime(mtime);
        if (time) earliest.set(bookId, time);
      }
    }
    while (job.source === 'file_created') {
      if (this.stopping) throw new ServiceUnavailableException('Recompute interrupted by shutdown');
      const files = await this.libraryRepo.findAddedAtFileBatch(
        job.libraryId,
        books.map(({ id }) => id),
        afterFileId,
        FILE_BATCH_SIZE,
      );
      if (files.length === 0) break;
      for (let offset = 0; offset < files.length; offset += STAT_CONCURRENCY) {
        await Promise.all(
          files.slice(offset, offset + STAT_CONCURRENCY).map(async (file) => {
            if (failures.has(file.bookId)) return;
            try {
              const time = await this.creationTime(file);
              const previous = earliest.get(file.bookId);
              if (time && (!previous || time < previous)) earliest.set(file.bookId, time);
            } catch (error) {
              failures.set(file.bookId, error instanceof ForbiddenException ? 'unsafe_path' : 'file_unavailable');
            }
          }),
        );
      }
      afterFileId = files[files.length - 1].id;
    }
    const changes: { id: number; addedAt: Date; previousAddedAt: string }[] = [];
    for (const book of books) {
      const failure = failures.get(book.id);
      const addedAt = earliest.get(book.id);
      if (failure) this.recordFailure(job, book.id, failure);
      else if (!addedAt) job.skipped++;
      else if (addedAt.getTime() === book.addedAt.getTime()) job.unchanged++;
      else changes.push({ id: book.id, addedAt, previousAddedAt: book.previousAddedAt });
    }
    if (changes.length > 0) {
      try {
        const updated = await this.libraryRepo.updateAddedAtBatch(job.libraryId, changes);
        job.updated += updated.length;
        job.skipped += changes.length - updated.length;
      } catch (error) {
        for (const { id } of changes) this.recordFailure(job, id, 'database_error');
        this.logFailure(entry, error);
      }
    }
    job.processed += books.length;
  }

  private async creationTime(file: FileRow): Promise<Date | undefined> {
    await this.pathPolicy.assertWithinBrowseRoot(file.absolutePath);
    const [root, path] = await Promise.all([realpath(file.rootPath), realpath(file.absolutePath)]);
    const relativePath = relative(root, path);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new ForbiddenException('File is outside its library root');
    }
    const info = await stat(path);
    if (!info.isFile()) throw new BadRequestException('Content path is not a file');
    return usableFileTime(info.birthtime) ?? usableFileTime(info.mtime);
  }

  private recordFailure(job: AddedAtRecomputeJob, bookId: number, code: AddedAtRecomputeFailureCode): void {
    job.failed++;
    if (job.failureSamples.length < MAX_FAILURE_SAMPLES) job.failureSamples.push({ bookId, code });
  }

  private logFailure(entry: JobEntry, error: unknown): void {
    const errorClass = error instanceof Error ? error.name : 'Error';
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `[library.recompute_added_at] [fail] libraryId=${entry.job.libraryId} userId=${entry.userId} jobId=${entry.job.id} source=${entry.job.source} durationMs=${Date.now() - entry.startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - recompute could not complete all writes`,
    );
  }
}
