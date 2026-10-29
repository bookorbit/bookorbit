import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type {
  ReadAloudCapability,
  ReadAloudDecisions,
  ReadAloudEligibilityReason,
  ReadAloudJob,
  ReadAloudJobEvent,
  ReadAloudJobReport,
  ReadAloudWorkerRequest,
} from '@bookorbit/types';
import {
  isAudioFormat,
  isContentBookFile,
  languageSubtagOf,
  Permission,
  READ_ALOUD_ACTIVE_JOB_STATUSES,
  READ_ALOUD_MAX_AUDIO_FILES,
  READ_ALOUD_QUARTZNET_LANGUAGES,
} from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../common/types/request-user';
import type { ReadAloudJobRow } from '../../db/schema';
import { BookService } from '../book/book.service';
import { LibraryService } from '../library/library.service';
import { UserService } from '../user/user.service';
import { CreateReadAloudJobDto } from './dto/create-read-aloud-job.dto';
import { ResyncReadAloudJobDto } from './dto/resync-read-aloud-job.dto';
import { ReadAloudActivityService } from './read-aloud-activity.service';
import { errorMessage, publicationErrorCode, ReadAloudJobError } from './read-aloud-errors';
import { ReadAloudJobRepository, type ReadAloudJobPayload } from './read-aloud-job.repository';
import { ReadAloudNotifier } from './read-aloud-notifier.service';
import { canManageReadAloudJob, canReplaceReadAlong, ReadAloudPresenter, type ReadAloudViewer } from './read-aloud-presenter.service';
import { ReadAloudPublisher } from './read-aloud-publisher.service';
import { assessCoverage, parseAlignmentReport } from './read-aloud-report';
import { ReadAloudWorkerClientService, type WorkerHealthState } from './read-aloud-worker-client.service';
import { ReadAloudWorkspace } from './read-aloud-workspace.service';
import { READ_ALOUD_FAILED_WORK_TTL_MS } from './read-aloud.constants';

const QUARTZNET_LANGUAGES = new Set<string>(READ_ALOUD_QUARTZNET_LANGUAGES);
const ACTIVE_STATUSES = new Set<string>(READ_ALOUD_ACTIVE_JOB_STATUSES);
const OUTPUT_ESTIMATE_FACTOR = 1.08;

export type ReadAloudProcessingContext = {
  user: RequestUser;
  request: Omit<ReadAloudWorkerRequest, 'maxOutputBytes'>;
};

type BookDetail = Awaited<ReturnType<BookService['getDetail']>>;

/** An empty list means the library accepts every supported format, as uploads treat it. */
function libraryAllowsEpub(allowedFormats: string[]): boolean {
  const normalized = allowedFormats.map((format) => format.trim().toLowerCase()).filter(Boolean);
  return normalized.length === 0 || normalized.includes('epub');
}
type BookFile = BookDetail['files'][number];

@Injectable()
export class ReadAloudService {
  private readonly logger = new Logger(ReadAloudService.name);

  constructor(
    private readonly jobs: ReadAloudJobRepository,
    private readonly worker: ReadAloudWorkerClientService,
    private readonly books: BookService,
    private readonly users: UserService,
    private readonly libraries: LibraryService,
    private readonly presenter: ReadAloudPresenter,
    private readonly activity: ReadAloudActivityService,
    private readonly notifier: ReadAloudNotifier,
    private readonly publisher: ReadAloudPublisher,
    private readonly workspace: ReadAloudWorkspace,
  ) {}

  async capability(bookId: number, user: RequestUser): Promise<ReadAloudCapability> {
    const book = await this.books.getDetail(bookId, user);
    const [library, placement, readAlongs, health] = await Promise.all([
      this.libraries.findOne(book.libraryId),
      this.jobs.findBookPlacement(bookId),
      this.jobs.findReadAlongFiles(bookId),
      this.worker.healthState(),
    ]);
    const epubFiles = this.epubCandidates(book).map((file) => this.candidate(file, 'epub'));
    const audioFiles = this.audioCandidates(book).map((file) => this.candidate(file, file.format!.toLowerCase()));
    const active = await this.jobs.findActiveForBook(bookId);
    const latest = active ?? (await this.jobs.findLatestFinishedForViewer(bookId, user));
    const mounted = health.state === 'ok' && placement ? await this.isMounted(placement.folderPath, health.health.libraryRoots) : false;
    const reason = this.eligibility({
      health,
      mounted,
      bookMissing: book.status === 'missing',
      singleFileLibrary: library.organizationMode === 'book_per_file',
      hasAudio: audioFiles.length > 0,
      tooManyAudioFiles: audioFiles.length > READ_ALOUD_MAX_AUDIO_FILES,
      epubAllowed: libraryAllowsEpub(placement?.allowedFormats ?? []),
      hasEpub: epubFiles.length > 0,
      hasActiveJob: active != null,
    });
    const sourceBytes = [...epubFiles.slice(0, 1), ...audioFiles].reduce((total, file) => total + (file.sizeBytes ?? 0), 0);
    return {
      model: 'quartznet15x5',
      supportedLanguages: [...READ_ALOUD_QUARTZNET_LANGUAGES],
      workerConfigured: health.state !== 'not_configured',
      workerAvailable: health.state === 'ok',
      workerDevice: health.state === 'ok' ? health.health.device : null,
      workerFreeBytes: health.state === 'ok' ? health.health.freeBytes : null,
      eligible: reason === null,
      reason,
      epubFiles,
      audioFiles,
      existingReadAlongs: readAlongs.map((file) => ({
        fileId: file.fileId,
        filename: file.filename,
        sizeBytes: file.sizeBytes,
        generatedByJobId: file.generatedByJobId,
      })),
      estimatedOutputBytes: sourceBytes > 0 ? Math.ceil(sourceBytes * OUTPUT_ESTIMATE_FACTOR) : null,
      latestJob: latest ? await this.presenter.present(latest, user) : null,
    };
  }

  async create(bookId: number, dto: CreateReadAloudJobDto, user: RequestUser): Promise<ReadAloudJob> {
    const book = await this.books.getDetail(bookId, user);
    const [library, placement, health] = await Promise.all([
      this.libraries.findOne(book.libraryId),
      this.jobs.findBookPlacement(bookId),
      this.worker.healthState(true),
    ]);
    if (health.state !== 'ok') throw new ServiceUnavailableException('Read-aloud worker is unavailable');
    if (book.status === 'missing') throw new BadRequestException('Read-aloud generation requires files that are present');
    if (library.organizationMode === 'book_per_file')
      throw new BadRequestException('Read-aloud generation is not available in single-file libraries');
    if (!libraryAllowsEpub(placement?.allowedFormats ?? [])) {
      throw new BadRequestException('This library does not allow EPUB files');
    }
    if (!placement || !(await this.isMounted(placement.folderPath, health.health.libraryRoots))) {
      throw new BadRequestException('This library is not mounted in the read-aloud worker');
    }

    const epubCandidates = this.epubCandidates(book);
    const audioCandidates = this.audioCandidates(book);
    const epubFileId = dto.epubFileId ?? (epubCandidates.length === 1 ? epubCandidates[0]!.id : undefined);
    const audioFileIds = dto.audioFileIds ?? audioCandidates.map((file) => file.id);
    if (epubFileId === undefined) throw new BadRequestException('Select an EPUB source');
    if (audioFileIds.length === 0) throw new BadRequestException('Select at least one audiobook file');
    if (audioFileIds.length > READ_ALOUD_MAX_AUDIO_FILES) {
      throw new BadRequestException(`A read-along can be made from at most ${READ_ALOUD_MAX_AUDIO_FILES} audio files`);
    }
    if (new Set(audioFileIds).size !== audioFileIds.length) throw new BadRequestException('Audiobook file selection contains duplicates');
    if (!epubCandidates.some((file) => file.id === epubFileId)) throw new BadRequestException('Selected EPUB is not an eligible source');
    if (audioFileIds.some((id) => !audioCandidates.some((file) => file.id === id))) {
      throw new BadRequestException('Selected audiobook contains an ineligible file');
    }
    let replaceFileId: number | null = null;
    if (dto.replaceFileId !== undefined) {
      if (!canReplaceReadAlong(user)) throw new ForbiddenException('Replacing a read-along needs permission to delete books');
      const readAlongs = await this.jobs.findReadAlongFiles(bookId);
      if (!readAlongs.some((file) => file.fileId === dto.replaceFileId))
        throw new BadRequestException('The file to replace is not a read-along on this book');
      replaceFileId = dto.replaceFileId;
    }

    const locale = this.parseLocale(dto.language ?? languageSubtagOf(book.language, READ_ALOUD_QUARTZNET_LANGUAGES) ?? 'en');
    if (!QUARTZNET_LANGUAGES.has(locale.language)) {
      throw new BadRequestException(`QuartzNet15x5 does not support language "${locale.language}"`);
    }
    const selectedIds = [epubFileId, ...audioFileIds];
    const sourceRows = await this.jobs.findSourceFiles(bookId, selectedIds);
    if (sourceRows.length !== selectedIds.length) throw new BadRequestException('One or more selected files no longer exist');
    const byId = new Map(sourceRows.map((file) => [file.id, file]));
    const input: ReadAloudJobPayload = {
      epubFileId,
      audioFileIds,
      language: locale.toString(),
      granularity: dto.granularity ?? 'sentence',
      sourceBytes: selectedIds.reduce((total, id) => total + (byId.get(id)?.sizeBytes ?? 0), 0),
      replaceFileId,
      sourceHashes: Object.fromEntries(sourceRows.map((file) => [String(file.id), file.fileHash])),
    };
    const row = await this.jobs.create({ bookId, requestedByUserId: user.id, input, replaceFileId });
    if (!row) throw new ConflictException('A read-aloud job is already active for this book');
    await this.activity.record(row.id, 'info', 'queued', 'job_created', null, {
      tracks: audioFileIds.length,
      language: input.language,
      granularity: input.granularity,
      replace: replaceFileId != null,
    });
    this.logger.log(
      `[read_aloud.create] [end] jobId=${row.id} bookId=${bookId} userId=${user.id} tracks=${audioFileIds.length} - read-aloud job queued`,
    );
    return this.presenter.present(row, user);
  }

  async get(jobId: string, user: RequestUser): Promise<ReadAloudJob> {
    return this.presenter.present(await this.findAccessible(jobId, user), user);
  }

  async cancel(jobId: string, user: RequestUser): Promise<ReadAloudJob> {
    const row = await this.findManageable(jobId, user);
    if (!ACTIVE_STATUSES.has(row.status)) return this.presenter.present(row, user);
    const updated = await this.jobs.requestCancellation(jobId);
    if (!updated) {
      const current = (await this.jobs.findById(jobId)) ?? row;
      if (ACTIVE_STATUSES.has(current.status) && (current.stage === 'publishing' || current.publishApproved)) {
        throw new ConflictException('This read-along is already being added to the book');
      }
      return this.presenter.present(current, user);
    }
    if (updated.status === 'cancelled') {
      await this.workspace.remove(jobId);
      await this.activity.record(jobId, 'info', null, row.status === 'awaiting_review' ? 'discarded' : 'cancelled');
    } else {
      // The dispatch loop owns the worker conversation, but after a server restart nothing may be
      // polling this job yet, so tell the worker directly as well. Cancelling twice is harmless.
      await this.worker.cancel(jobId).catch(() => undefined);
      await this.activity.record(jobId, 'info', updated.stage as ReadAloudJob['stage'], 'cancel_requested');
    }
    await this.notifier.pushUpdate(updated);
    return this.presenter.present(updated, user);
  }

  /** Starts publishing in the background: copying a large audiobook can outlast an HTTP request. */
  async publish(jobId: string, user: RequestUser): Promise<ReadAloudJob> {
    await this.findManageable(jobId, user);
    const row = await this.jobs.claimForPublishing(jobId);
    if (!row) throw new ConflictException('This read-aloud job is not awaiting review');
    await this.activity.record(jobId, 'info', 'publishing', 'publish_requested');
    void this.publishClaimed(row, user).catch((error: unknown) => {
      // Recording the failure failed too; the job's lease lapses and recovery puts it back in line.
      this.logger.error(
        `[read_aloud.publish] [fail] jobId=${row.id} bookId=${row.bookId} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(errorMessage(error))}" - read-aloud publish outcome could not be recorded`,
      );
    });
    return this.presenter.present(row, user);
  }

  async retry(jobId: string, user: RequestUser): Promise<ReadAloudJob> {
    await this.findManageable(jobId, user);
    const row = await this.jobs.retry(jobId);
    if (!row) throw new ConflictException('This job cannot be retried; start a new one instead');
    await this.activity.record(jobId, 'info', 'queued', 'retry_requested');
    await this.notifier.pushUpdate(row);
    return this.presenter.present(row, user);
  }

  async resync(jobId: string, dto: ResyncReadAloudJobDto, user: RequestUser): Promise<ReadAloudJob> {
    await this.findManageable(jobId, user);
    const decisions: ReadAloudDecisions = { chapters: dto.decisions.chapters, audio: dto.decisions.audio ?? [] };
    const row = await this.jobs.resync(jobId, decisions, 'aligning');
    if (!row) throw new ConflictException('Only a job awaiting review can be re-synced');
    await this.activity.record(jobId, 'info', 'queued', 'resync_requested', null, {
      excluded: Object.values(decisions.chapters).filter((decision) => decision === 'excluded').length,
      included: Object.values(decisions.chapters).filter((decision) => decision === 'included').length,
    });
    await this.notifier.pushUpdate(row);
    return this.presenter.present(row, user);
  }

  async dismiss(jobId: string, user: RequestUser): Promise<ReadAloudJob> {
    await this.findManageable(jobId, user);
    const row = await this.jobs.dismiss(jobId);
    if (!row) throw new ConflictException('Only a finished job can be dismissed');
    return this.presenter.present(row, user);
  }

  async report(jobId: string, user: RequestUser): Promise<ReadAloudJobReport> {
    const row = await this.findAccessible(jobId, user);
    if (!row.report) throw new NotFoundException('This job has no alignment report yet');
    const stored = await this.jobs.findReportChapters(jobId);
    const chapters = stored ?? (await this.liveReportChapters(row));
    const assessed = assessCoverage(row.report, chapters);
    return { jobId, totals: row.report, coverage: row.coverage ?? assessed.coverage, chapters: assessed.chapters };
  }

  async events(jobId: string, afterId: number | null, user: RequestUser): Promise<{ events: ReadAloudJobEvent[] }> {
    await this.findAccessible(jobId, user);
    return { events: await this.activity.list(jobId, afterId) };
  }

  /**
   * Re-checks everything a long-queued job depends on, as of now: the requester still exists and
   * may generate, can still reach the book, and the sources are the files that were chosen.
   */
  async resolveProcessingContext(row: ReadAloudJobRow): Promise<ReadAloudProcessingContext> {
    const user = row.requestedByUserId == null ? null : await this.users.findByIdWithPermissions(row.requestedByUserId);
    if (!user || !user.active) throw new ReadAloudJobError('source_missing', 'The requesting account is no longer active');
    if (!user.isSuperuser && !user.permissions.includes(Permission.LibraryGenerateReadAloud)) {
      throw new ReadAloudJobError('source_missing', 'The requesting account no longer has read-aloud permission');
    }
    await this.books.verifyBookAccess(row.bookId, user).catch((error: unknown) => {
      // A denial is permanent for this job; an HTTP exception would otherwise read as a retryable unknown failure.
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw new ReadAloudJobError('source_missing', 'The requesting account can no longer reach this book');
      }
      throw error;
    });
    const input = row.input as ReadAloudJobPayload;
    const ids = [input.epubFileId, ...input.audioFileIds];
    const files = await this.jobs.findSourceFiles(row.bookId, ids);
    const byId = new Map(files.map((file) => [file.id, file]));
    for (const id of ids) {
      const file = byId.get(id);
      if (!file) throw new ReadAloudJobError('source_missing', 'A selected source file no longer exists');
      if ((input.sourceHashes[String(id)] ?? null) !== (file.fileHash ?? null)) {
        throw new ReadAloudJobError('source_changed', 'A selected source file changed after the job was created');
      }
    }
    const epub = byId.get(input.epubFileId)!;
    if (epub.format?.toLowerCase() !== 'epub' || epub.mediaOverlayAvailable) {
      throw new ReadAloudJobError('invalid_source', 'The selected EPUB is not an eligible source');
    }
    const audio = input.audioFileIds.map((id) => byId.get(id)!);
    if (audio.some((file) => !isAudioFormat(file.format ?? ''))) {
      throw new ReadAloudJobError('invalid_source', 'The selected audiobook contains an unsupported file');
    }
    const durations = audio.map((file) => file.durationSeconds);
    return {
      user,
      request: {
        jobId: row.id,
        epubPath: epub.absolutePath,
        audioPaths: audio.map((file) => file.absolutePath),
        workDir: this.workspace.dir(row.id),
        language: input.language,
        granularity: input.granularity,
        model: 'quartznet15x5',
        sourceBytes: input.sourceBytes,
        audioDurationSeconds: durations.every((value) => value != null) ? durations.reduce<number>((total, value) => total + value!, 0) : null,
        decisions: row.decisions,
        resumeFrom: (row.resumeFrom as ReadAloudWorkerRequest['resumeFrom']) ?? null,
      },
    };
  }

  /** Jobs validated before chapter reports were stored still have theirs in the work folder while it exists. */
  private async liveReportChapters(row: ReadAloudJobRow) {
    if (row.status !== 'awaiting_review' && row.status !== 'processing') return [];
    const raw = await this.workspace.readReport(row.id).catch(() => null);
    if (!raw) return [];
    try {
      return parseAlignmentReport(raw).chapters;
    } catch {
      return [];
    }
  }

  private async publishClaimed(row: ReadAloudJobRow, user: RequestUser): Promise<void> {
    const startedAt = Date.now();
    try {
      const { validation, fileId } = await this.publisher.withHeartbeat(row.id, async () => {
        const validation = await this.publisher.validate(row);
        return { validation, fileId: await this.publisher.publish(row, user) };
      });
      const completed = await this.jobs.complete(row.id, fileId, validation.report, validation.warnings, validation.coverage);
      await this.workspace.remove(row.id);
      await this.activity.record(row.id, 'info', 'completed', 'published', null, { fileId, durationMs: Date.now() - startedAt });
      if (completed) {
        await this.notifier.pushUpdate(completed);
        await this.notifier.notify(completed, 'ready');
      }
    } catch (error) {
      const code = publicationErrorCode(error);
      const failed = await this.jobs.fail(row.id, code, errorMessage(error), new Date(Date.now() + READ_ALOUD_FAILED_WORK_TTL_MS));
      await this.activity.record(row.id, 'error', 'publishing', code);
      this.logger.warn(
        `[read_aloud.publish] [fail] jobId=${row.id} bookId=${row.bookId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(errorMessage(error))}" - read-aloud publish failed`,
      );
      if (failed) {
        await this.notifier.pushUpdate(failed);
        await this.notifier.notify(failed, 'failed');
      }
    }
  }

  private eligibility(state: {
    health: WorkerHealthState;
    mounted: boolean;
    bookMissing: boolean;
    singleFileLibrary: boolean;
    hasAudio: boolean;
    tooManyAudioFiles: boolean;
    epubAllowed: boolean;
    hasEpub: boolean;
    hasActiveJob: boolean;
  }): ReadAloudEligibilityReason | null {
    if (state.health.state === 'not_configured') return 'worker_not_configured';
    if (state.singleFileLibrary) return 'single_file_library';
    if (!state.hasAudio) return 'no_audiobook';
    if (state.tooManyAudioFiles) return 'too_many_audio_files';
    if (state.bookMissing) return 'book_missing';
    if (!state.epubAllowed) return 'epub_not_allowed';
    if (!state.hasEpub) return 'no_epub';
    if (state.hasActiveJob) return 'job_active';
    if (state.health.state === 'unreachable') return 'worker_unavailable';
    if (state.health.state === 'incompatible') return 'worker_incompatible';
    if (!state.mounted) return 'library_not_mounted';
    return null;
  }

  /**
   * Whether the worker can read this folder. Paths are compared as written and with symlinks
   * resolved on this side, so a library added through a symlinked path still matches a worker
   * root given as the real path, and the other way round.
   */
  private async isMounted(folderPath: string, roots: string[]): Promise<boolean> {
    const variants = async (path: string) => [...new Set([resolve(path), await realpath(path).catch(() => resolve(path))])];
    const folders = await variants(folderPath);
    const rootVariants = (await Promise.all(roots.map(variants))).flat();
    return folders.some((folder) =>
      rootVariants.some((root) => {
        const rel = relative(root, folder);
        return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
      }),
    );
  }

  private epubCandidates(book: BookDetail): BookFile[] {
    return book.files.filter((file) => isContentBookFile(file) && file.format?.toLowerCase() === 'epub' && file.mediaOverlay?.available !== true);
  }

  private audioCandidates(book: BookDetail): BookFile[] {
    return book.files.filter((file) => isContentBookFile(file) && file.format != null && isAudioFormat(file.format));
  }

  private candidate(file: BookFile, format: string) {
    return {
      id: file.id,
      filename: file.filename ?? file.absolutePath.split('/').pop() ?? '',
      format,
      sizeBytes: file.sizeBytes,
      durationSeconds: file.durationSeconds,
    };
  }

  private async findAccessible(jobId: string, user: RequestUser): Promise<ReadAloudJobRow> {
    const row = await this.jobs.findById(jobId);
    if (!row) throw new NotFoundException('Read-aloud job not found');
    await this.books.verifyBookAccess(row.bookId, user);
    return row;
  }

  private async findManageable(jobId: string, user: RequestUser): Promise<ReadAloudJobRow> {
    const row = await this.findAccessible(jobId, user);
    if (!canManageReadAloudJob(row, user as ReadAloudViewer)) throw new ForbiddenException('Only the person who started this job can change it');
    return row;
  }

  private parseLocale(value: string): Intl.Locale {
    try {
      return new Intl.Locale(value);
    } catch {
      throw new BadRequestException('Language must be a valid BCP 47 language tag');
    }
  }
}
