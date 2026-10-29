import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Permission, READ_ALOUD_MAX_AUDIO_FILES } from '@bookorbit/types';

import { FORBIDDEN_PERMISSION_KEY } from '../../common/decorators/forbid-permission.decorator';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { GeneratedFileError } from '../upload/generated-book-file.service';
import { CreateReadAloudJobDto } from './dto/create-read-aloud-job.dto';
import { ResyncReadAloudJobDto } from './dto/resync-read-aloud-job.dto';
import { ReadAloudController } from './read-aloud.controller';
import { classifyReadAloudError, ReadAloudJobError } from './read-aloud-errors';
import { ReadAloudPresenter } from './read-aloud-presenter.service';
import { ReadAloudService } from './read-aloud.service';
import { ADMIN, bookDetail, COVERAGE, DELETER, JOB_ID, jobRow, okHealth, OTHER, OWNER, REPORT_TOTALS, sourceFiles } from './test-helpers';

function makeService(
  options: { book?: ReturnType<typeof bookDetail>; health?: unknown; organizationMode?: string; allowedFormats?: string[]; folderPath?: string } = {},
) {
  const jobs = {
    findActiveForBook: vi.fn().mockResolvedValue(null),
    findLatestFinishedForViewer: vi.fn().mockResolvedValue(null),
    findReadAlongFiles: vi.fn().mockResolvedValue([]),
    findBookPlacement: vi
      .fn()
      .mockResolvedValue({ folderPath: options.folderPath ?? '/library/novel', allowedFormats: options.allowedFormats ?? ['epub', 'mp3'] }),
    findSourceFiles: vi.fn().mockResolvedValue(sourceFiles()),
    findById: vi.fn().mockResolvedValue(jobRow()),
    findRequesterName: vi.fn().mockResolvedValue('Owner'),
    findReportChapters: vi.fn().mockResolvedValue(null),
    countQueuedAhead: vi.fn().mockResolvedValue(0),
    create: vi
      .fn()
      .mockImplementation((values: { input: unknown; replaceFileId: number | null }) =>
        Promise.resolve(jobRow({ input: values.input as never, replaceFileId: values.replaceFileId })),
      ),
    requestCancellation: vi.fn(),
    claimForPublishing: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    retry: vi.fn(),
    resync: vi.fn(),
    dismiss: vi.fn(),
  };
  const worker = { healthState: vi.fn().mockResolvedValue(options.health ?? okHealth()), cancel: vi.fn().mockResolvedValue(undefined) };
  const books = { getDetail: vi.fn().mockResolvedValue(options.book ?? bookDetail()), verifyBookAccess: vi.fn().mockResolvedValue(undefined) };
  const users = { findByIdWithPermissions: vi.fn().mockResolvedValue(OWNER) };
  const libraries = { findOne: vi.fn().mockResolvedValue({ organizationMode: options.organizationMode ?? 'book_per_folder' }) };
  const activity = { record: vi.fn().mockResolvedValue(undefined), list: vi.fn().mockResolvedValue([]) };
  const notifier = { pushUpdate: vi.fn().mockResolvedValue(undefined), notify: vi.fn().mockResolvedValue(undefined) };
  const publisher = {
    withHeartbeat: vi.fn().mockImplementation((_id: string, fn: () => Promise<unknown>) => fn()),
    validate: vi.fn().mockResolvedValue({ report: REPORT_TOTALS, coverage: COVERAGE, warnings: [], requiresReview: false, outputBytes: 10 }),
    publish: vi.fn().mockResolvedValue(555),
  };
  const workspace = {
    dir: vi.fn((id: string) => `/data/read-aloud/jobs/${id}`),
    remove: vi.fn().mockResolvedValue(undefined),
    readReport: vi.fn().mockResolvedValue(null),
  };
  const presenter = new ReadAloudPresenter(jobs as never);
  const service = new ReadAloudService(
    jobs as never,
    worker as never,
    books as never,
    users as never,
    libraries as never,
    presenter,
    activity as never,
    notifier as never,
    publisher as never,
    workspace as never,
  );
  return { service, jobs, worker, books, activity, notifier, publisher, workspace };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** A book split into more audio files than one job takes. */
function oversplitBook() {
  const epub = bookDetail().files[0]!;
  const tracks = Array.from({ length: READ_ALOUD_MAX_AUDIO_FILES + 1 }, (_, index) => ({
    id: 1_000 + index,
    role: 'content',
    format: 'mp3',
    filename: `${index}.mp3`,
    absolutePath: `/library/novel/${index}.mp3`,
    sizeBytes: 10,
    durationSeconds: 1,
  }));
  return bookDetail({ files: [epub, ...tracks] });
}

describe('read-aloud HTTP contract', () => {
  it('requires the dedicated permission and the demo restriction on every endpoint', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, ReadAloudController)).toBe(Permission.LibraryGenerateReadAloud);
    expect(Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, ReadAloudController)).toEqual({
      permission: Permission.DemoRestricted,
      message: 'Demo-restricted account cannot generate read-aloud books',
    });
  });

  it('validates the create body', async () => {
    const empty = await validate(plainToInstance(CreateReadAloudJobDto, { epubFileId: 101, audioFileIds: [] }));
    expect(empty.some((error) => error.property === 'audioFileIds')).toBe(true);
    const bad = await validate(
      plainToInstance(CreateReadAloudJobDto, {
        audioFileIds: Array.from({ length: READ_ALOUD_MAX_AUDIO_FILES + 1 }, (_, index) => index + 1),
        language: '../en',
        replaceFileId: -1,
      }),
    );
    expect(bad.map((error) => error.property)).toEqual(expect.arrayContaining(['audioFileIds', 'language', 'replaceFileId']));
  });

  it('accepts only known chapter decisions for a re-sync', async () => {
    const ok = await validate(plainToInstance(ResyncReadAloudJobDto, { decisions: { chapters: { 'OEBPS/c1.xhtml': 'excluded' }, audio: [] } }));
    expect(ok).toEqual([]);
    const bad = await validate(plainToInstance(ResyncReadAloudJobDto, { decisions: { chapters: { 'OEBPS/c1.xhtml': 'maybe' } } }));
    expect(bad).not.toEqual([]);
  });
});

describe('ReadAloudService.capability', () => {
  it('is eligible for a plain EPUB with audio in a mounted library', async () => {
    const { service } = makeService();
    const capability = await service.capability(12, OWNER);
    expect(capability).toMatchObject({
      workerConfigured: true,
      workerAvailable: true,
      workerDevice: 'cpu',
      workerFreeBytes: 1e12,
      eligible: true,
      reason: null,
    });
    expect(capability.epubFiles.map((file) => file.id)).toEqual([101]);
    expect(capability.audioFiles.map((file) => file.id)).toEqual([102]);
  });

  it.each([
    [{ health: { state: 'not_configured' } }, 'worker_not_configured'],
    [{ health: { state: 'unreachable' } }, 'worker_unavailable'],
    [{ health: { state: 'incompatible', health: okHealth().health } }, 'worker_incompatible'],
    [{ organizationMode: 'book_per_file' }, 'single_file_library'],
    [{ allowedFormats: ['mp3'] }, 'epub_not_allowed'],
    [{ folderPath: '/elsewhere/novel' }, 'library_not_mounted'],
    [{ book: bookDetail({ status: 'missing' }) }, 'book_missing'],
  ])('reports %j as %s', async (options, reason) => {
    const { service } = makeService(options as never);
    const capability = await service.capability(12, OWNER);
    expect(capability.reason).toBe(reason);
    expect(capability.eligible).toBe(false);
  });

  it('says up front when the audiobook has more files than a job takes', async () => {
    const { service } = makeService({ book: oversplitBook() });
    await expect(service.capability(12, OWNER)).resolves.toMatchObject({ eligible: false, reason: 'too_many_audio_files' });
  });

  it('treats an empty format list as allowing EPUB', async () => {
    const { service } = makeService({ allowedFormats: [] });
    await expect(service.capability(12, OWNER)).resolves.toMatchObject({ eligible: true });
  });

  it('marks existing read-alongs and shows the active job to anyone with access', async () => {
    const { service, jobs } = makeService();
    jobs.findReadAlongFiles.mockResolvedValue([{ fileId: 300, filename: 'novel.readaloud.epub', sizeBytes: 9, generatedByJobId: JOB_ID }]);
    jobs.findActiveForBook.mockResolvedValue(jobRow({ status: 'processing', stage: 'aligning' }));
    const capability = await service.capability(12, OTHER);
    expect(capability.reason).toBe('job_active');
    expect(capability.existingReadAlongs).toEqual([{ fileId: 300, filename: 'novel.readaloud.epub', sizeBytes: 9, generatedByJobId: JOB_ID }]);
    expect(capability.latestJob).toMatchObject({ status: 'processing', canManage: false, requestedBy: { id: OWNER.id, name: 'Owner' } });
    expect(jobs.findLatestFinishedForViewer).not.toHaveBeenCalled();
  });
});

describe('ReadAloudService.create', () => {
  it('stores the listening order, source hashes, and replace target', async () => {
    const { service, jobs } = makeService();
    jobs.findReadAlongFiles.mockResolvedValue([{ fileId: 300, filename: 'x', sizeBytes: 1, generatedByJobId: null }]);
    const job = await service.create(
      12,
      Object.assign(new CreateReadAloudJobDto(), { epubFileId: 101, audioFileIds: [102], language: 'en-US', replaceFileId: 300 }),
      DELETER,
    );

    expect(job).toMatchObject({ status: 'queued', canManage: true, input: { replaceFileId: 300 } });
    expect(jobs.create).toHaveBeenCalledWith({
      bookId: 12,
      requestedByUserId: OWNER.id,
      replaceFileId: 300,
      input: {
        epubFileId: 101,
        audioFileIds: [102],
        language: 'en-US',
        granularity: 'sentence',
        sourceBytes: 7_000,
        replaceFileId: 300,
        sourceHashes: { '101': 'epub-hash', '102': 'audio-hash' },
      },
    });
  });

  it('refuses a default selection with more audio files than a job takes', async () => {
    const { service, jobs } = makeService({ book: oversplitBook() });
    await expect(service.create(12, Object.assign(new CreateReadAloudJobDto(), { epubFileId: 101, language: 'en' }), OWNER)).rejects.toThrow(
      BadRequestException,
    );
    expect(jobs.create).not.toHaveBeenCalled();
  });

  it('refuses to replace a read-along without permission to delete books', async () => {
    const { service, jobs } = makeService();
    jobs.findReadAlongFiles.mockResolvedValue([{ fileId: 300, filename: 'x', sizeBytes: 1, generatedByJobId: null }]);
    await expect(
      service.create(12, Object.assign(new CreateReadAloudJobDto(), { epubFileId: 101, audioFileIds: [102], replaceFileId: 300 }), OWNER),
    ).rejects.toThrow(ForbiddenException);
    expect(jobs.create).not.toHaveBeenCalled();
  });

  it('rejects a replace target that is not a read-along on the book', async () => {
    const { service, jobs } = makeService();
    await expect(service.create(12, Object.assign(new CreateReadAloudJobDto(), { replaceFileId: 999 }), DELETER)).rejects.toThrow(
      BadRequestException,
    );
    expect(jobs.create).not.toHaveBeenCalled();
  });

  it('reads a book language stated as a name when the request names none', async () => {
    const { service, jobs } = makeService({ book: bookDetail({ language: 'English' }) });
    await service.create(12, Object.assign(new CreateReadAloudJobDto(), { epubFileId: 101, audioFileIds: [102] }), OWNER);

    expect(jobs.create).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ language: 'en' }) }));
  });

  it('refuses unsupported languages, unmounted libraries, and an unavailable worker', async () => {
    await expect(makeService({ book: bookDetail({ language: 'nl-NL' }) }).service.create(12, new CreateReadAloudJobDto(), OWNER)).rejects.toThrow(
      BadRequestException,
    );
    await expect(makeService({ folderPath: '/other' }).service.create(12, new CreateReadAloudJobDto(), OWNER)).rejects.toThrow(BadRequestException);
    await expect(makeService({ health: { state: 'unreachable' } }).service.create(12, new CreateReadAloudJobDto(), OWNER)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('reports a conflict when another job is already active', async () => {
    const { service, jobs } = makeService();
    jobs.create.mockResolvedValue(null);
    await expect(service.create(12, new CreateReadAloudJobDto(), OWNER)).rejects.toThrow(ConflictException);
  });
});

describe('ReadAloudService job actions', () => {
  it.each(['cancel', 'publish', 'retry', 'dismiss'] as const)('lets only the requester or a superuser %s', async (action) => {
    const { service } = makeService();
    await expect(service[action](JOB_ID, OTHER)).rejects.toThrow(ForbiddenException);
  });

  it('lets a superuser act on anyone’s job', async () => {
    const { service, jobs } = makeService();
    jobs.dismiss.mockResolvedValue(jobRow({ status: 'failed', dismissedAt: new Date() }));
    await expect(service.dismiss(JOB_ID, ADMIN)).resolves.toMatchObject({ canManage: true });
  });

  it('removes the work at once when a queued or review job is cancelled', async () => {
    const { service, jobs, workspace, worker } = makeService();
    jobs.findById.mockResolvedValue(jobRow({ status: 'awaiting_review' }));
    jobs.requestCancellation.mockResolvedValue(jobRow({ status: 'cancelled', cancelRequested: true, errorCode: 'discarded' }));
    await service.cancel(JOB_ID, OWNER);
    expect(workspace.remove).toHaveBeenCalledWith(JOB_ID);
    expect(worker.cancel).not.toHaveBeenCalled();
  });

  it('asks the worker to stop a processing job and reports it as stopping', async () => {
    const { service, jobs, workspace, worker } = makeService();
    jobs.findById.mockResolvedValue(jobRow({ status: 'processing', stage: 'generating_emissions' }));
    jobs.requestCancellation.mockResolvedValue(
      jobRow({ status: 'processing', stage: 'generating_emissions', cancelRequested: true, errorCode: 'cancelled' }),
    );
    const job = await service.cancel(JOB_ID, OWNER);
    expect(worker.cancel).toHaveBeenCalledWith(JOB_ID);
    expect(workspace.remove).not.toHaveBeenCalled();
    expect(job).toMatchObject({ status: 'processing', cancelRequested: true });
  });

  it('refuses to cancel a job whose file is already being added to the book', async () => {
    const { service, jobs, worker, activity, notifier, workspace } = makeService();
    jobs.findById.mockResolvedValue(jobRow({ status: 'processing', stage: 'publishing' }));
    jobs.requestCancellation.mockResolvedValue(null);

    await expect(service.cancel(JOB_ID, OWNER)).rejects.toThrow(ConflictException);
    expect(worker.cancel).not.toHaveBeenCalled();
    expect(workspace.remove).not.toHaveBeenCalled();
    expect(activity.record).not.toHaveBeenCalled();
    expect(notifier.pushUpdate).not.toHaveBeenCalled();
  });

  it('refuses to cancel an approved job that a restart put back in the queue, since its file may be in the library', async () => {
    const { service, jobs, worker } = makeService();
    jobs.findById.mockResolvedValue(jobRow({ status: 'queued', stage: 'queued', publishApproved: true }));
    jobs.requestCancellation.mockResolvedValue(null);

    await expect(service.cancel(JOB_ID, OWNER)).rejects.toThrow(ConflictException);
    expect(worker.cancel).not.toHaveBeenCalled();
  });

  it('answers with the job as it now is when it finished before the cancel landed', async () => {
    const { service, jobs, worker, activity } = makeService();
    jobs.findById
      .mockResolvedValueOnce(jobRow({ status: 'processing', stage: 'aligning' }))
      .mockResolvedValueOnce(jobRow({ status: 'completed', stage: 'completed', outputFileId: 555 }));
    jobs.requestCancellation.mockResolvedValue(null);

    await expect(service.cancel(JOB_ID, OWNER)).resolves.toMatchObject({ status: 'completed', outputFileId: 555, cancelRequested: false });
    expect(worker.cancel).not.toHaveBeenCalled();
    expect(activity.record).not.toHaveBeenCalled();
  });

  it('logs, rather than leaks, a publish failure it cannot record', async () => {
    const { service, jobs, publisher } = makeService();
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      jobs.claimForPublishing.mockResolvedValue(jobRow({ status: 'processing', stage: 'publishing' }));
      publisher.publish.mockRejectedValue(new Error('disk on fire'));
      jobs.fail.mockRejectedValue(new Error('database is down'));
      await expect(service.publish(JOB_ID, OWNER)).resolves.toMatchObject({ stage: 'publishing' });
      await flush();
      await flush();

      expect(errors).toHaveBeenCalledWith(expect.stringMatching(/^\[read_aloud\.publish\] \[fail\] jobId=.* error="database is down"/));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      errors.mockRestore();
    }
  });

  it('publishes in the background and completes the job', async () => {
    const { service, jobs, publisher, notifier, workspace } = makeService();
    jobs.claimForPublishing.mockResolvedValue(jobRow({ status: 'processing', stage: 'publishing' }));
    jobs.complete.mockResolvedValue(jobRow({ status: 'completed', stage: 'completed', outputFileId: 555 }));
    const job = await service.publish(JOB_ID, OWNER);
    expect(job.stage).toBe('publishing');
    await flush();
    expect(publisher.publish).toHaveBeenCalled();
    expect(jobs.complete).toHaveBeenCalledWith(JOB_ID, 555, REPORT_TOTALS, [], COVERAGE);
    expect(workspace.remove).toHaveBeenCalledWith(JOB_ID);
    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }), 'ready');
  });

  it('keeps the work and a retry window when publishing fails', async () => {
    const { service, jobs, publisher, workspace, notifier } = makeService();
    jobs.claimForPublishing.mockResolvedValue(jobRow({ status: 'processing', stage: 'publishing' }));
    publisher.publish.mockRejectedValue(new Error('disk on fire'));
    jobs.fail.mockResolvedValue(jobRow({ status: 'failed', errorCode: 'publication_failed' }));
    await service.publish(JOB_ID, OWNER);
    await flush();
    expect(jobs.fail).toHaveBeenCalledWith(JOB_ID, 'publication_failed', 'disk on fire', expect.any(Date));
    expect(workspace.remove).not.toHaveBeenCalled();
    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }), 'failed');
  });

  it('records why publishing from review failed with the same codes as automatic publishing', async () => {
    const { service, jobs, publisher, activity } = makeService();
    jobs.claimForPublishing.mockResolvedValue(jobRow({ status: 'processing', stage: 'publishing' }));
    publisher.publish.mockRejectedValue(new GeneratedFileError('insufficient_storage', 'Not enough free space in the library folder'));
    jobs.fail.mockResolvedValue(jobRow({ status: 'failed', errorCode: 'insufficient_storage' }));
    await service.publish(JOB_ID, OWNER);
    await flush();
    expect(jobs.fail).toHaveBeenCalledWith(JOB_ID, 'insufficient_storage', expect.any(String), expect.any(Date));
    // The raw message can carry SQL or server paths, and anyone who can see the book reads the log.
    expect(activity.record).toHaveBeenCalledWith(JOB_ID, 'error', 'publishing', 'insufficient_storage');

    jobs.fail.mockClear();
    publisher.validate.mockRejectedValue(new ReadAloudJobError('invalid_output', 'The generated EPUB could not be read'));
    jobs.claimForPublishing.mockResolvedValue(jobRow({ status: 'processing', stage: 'publishing' }));
    await service.publish(JOB_ID, OWNER);
    await flush();
    expect(jobs.fail).toHaveBeenCalledWith(JOB_ID, 'invalid_output', expect.any(String), expect.any(Date));
  });

  it('refuses to publish a job that is no longer awaiting review', async () => {
    const { service, jobs } = makeService();
    jobs.claimForPublishing.mockResolvedValue(null);
    await expect(service.publish(JOB_ID, OWNER)).rejects.toThrow(ConflictException);
  });

  it('re-syncs with the full decisions and resumes from alignment', async () => {
    const { service, jobs } = makeService();
    jobs.resync.mockResolvedValue(jobRow({ status: 'queued', resumeFrom: 'aligning' }));
    const dto = plainToInstance(ResyncReadAloudJobDto, { decisions: { chapters: { 'OEBPS/c1.xhtml': 'excluded' } } });
    await service.resync(JOB_ID, dto, OWNER);
    expect(jobs.resync).toHaveBeenCalledWith(JOB_ID, { chapters: { 'OEBPS/c1.xhtml': 'excluded' }, audio: [] }, 'aligning');
  });

  it('serves the stored chapter report after the work folder is gone', async () => {
    const { service, jobs, workspace } = makeService();
    const stored = [
      {
        index: 0,
        href: 'c1.xhtml',
        title: 'Chapter 1',
        zone: 'body' as const,
        status: 'aligned' as const,
        decision: null,
        sentenceCount: 100,
        matchedSentenceCount: 99,
        interpolatedSentenceCount: 0,
        droppedSentenceCount: 0,
        matchedSeconds: 590,
        score: null,
        preview: null,
        firstMatch: null,
        lastMatch: null,
        outsideNarration: false,
      },
    ];
    jobs.findById.mockResolvedValue(jobRow({ status: 'completed', report: REPORT_TOTALS, coverage: COVERAGE }));
    jobs.findReportChapters.mockResolvedValue(stored);
    await expect(service.report(JOB_ID, OWNER)).resolves.toEqual({ jobId: JOB_ID, totals: REPORT_TOTALS, coverage: COVERAGE, chapters: stored });
    expect(workspace.readReport).not.toHaveBeenCalled();
  });

  it('falls back to the work folder for a job validated before reports were stored', async () => {
    const { service, jobs, workspace } = makeService();
    jobs.findById.mockResolvedValue(jobRow({ status: 'awaiting_review', report: REPORT_TOTALS }));
    workspace.readReport.mockResolvedValue(JSON.stringify({ totals: REPORT_TOTALS, spine: [{ href: 'c1.xhtml', status: 'not-found' }] }));
    const report = await service.report(JOB_ID, OWNER);
    expect(report.chapters).toHaveLength(1);

    jobs.findById.mockResolvedValue(jobRow({ status: 'completed', report: REPORT_TOTALS }));
    await expect(service.report(JOB_ID, OWNER)).resolves.toMatchObject({ totals: REPORT_TOTALS, coverage: null, chapters: [] });
  });
});

describe('ReadAloudService.resolveProcessingContext', () => {
  it('builds the worker request from the stored selection', async () => {
    const { service } = makeService();
    const context = await service.resolveProcessingContext(jobRow({ resumeFrom: 'aligning', decisions: { chapters: { a: 'excluded' }, audio: [] } }));
    expect(context.request).toEqual({
      jobId: JOB_ID,
      epubPath: '/library/novel/novel.epub',
      audioPaths: ['/library/novel/01.mp3'],
      workDir: `/data/read-aloud/jobs/${JOB_ID}`,
      language: 'en-US',
      granularity: 'sentence',
      model: 'quartznet15x5',
      sourceBytes: 7_000,
      audioDurationSeconds: 300,
      decisions: { chapters: { a: 'excluded' }, audio: [] },
      resumeFrom: 'aligning',
    });
  });

  it('refuses sources that changed since the job was created', async () => {
    const { service, jobs } = makeService();
    jobs.findSourceFiles.mockResolvedValue(sourceFiles().map((file) => (file.id === 102 ? { ...file, fileHash: 'new' } : file)));
    await expect(service.resolveProcessingContext(jobRow())).rejects.toMatchObject({ code: 'source_changed' });
  });

  it.each([new NotFoundException('Book 12 not found'), new ForbiddenException('No access')])(
    'turns a requester who can no longer reach the book (%s) into a permanent, coded failure',
    async (denial) => {
      const { service, books, jobs } = makeService();
      books.verifyBookAccess.mockRejectedValue(denial);

      const failure = await service.resolveProcessingContext(jobRow()).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ReadAloudJobError);
      expect(failure).toMatchObject({ code: 'source_missing' });
      expect(classifyReadAloudError(failure)).toBe('source_missing');
      expect(jobs.findSourceFiles).not.toHaveBeenCalled();
    },
  );

  it('lets an unexpected access-check failure through unchanged', async () => {
    const { service, books } = makeService();
    const outage = new Error('connection terminated');
    books.verifyBookAccess.mockRejectedValue(outage);
    await expect(service.resolveProcessingContext(jobRow())).rejects.toBe(outage);
  });
});
