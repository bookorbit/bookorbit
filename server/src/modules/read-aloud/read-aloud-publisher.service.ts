import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { ReadAloudNarrationCoverage, ReadAloudReportSummary, ReadAloudWarningCode } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { readAloudConfig } from '../../config/config';
import type { ReadAloudJobRow } from '../../db/schema';
import { buildEpubMediaOverlayPlaylistFromFile } from '../reader/epub/epub-media-overlay';
import { GENERATED_FILENAME_MAX_BYTES, GeneratedBookFileService, truncateUtf8 } from '../upload/generated-book-file.service';
import { ReadAloudActivityService } from './read-aloud-activity.service';
import { ReadAloudJobError } from './read-aloud-errors';
import { ReadAloudJobRepository, type ReadAloudJobPayload } from './read-aloud-job.repository';
import { canReplaceReadAlong } from './read-aloud-presenter.service';
import { assessCoverage, parseAlignmentReport, reportWarnings } from './read-aloud-report';
import { ReadAloudWorkspace } from './read-aloud-workspace.service';
import { READ_ALOUD_HEARTBEAT_MS } from './read-aloud.constants';

const READ_ALONG_SUFFIX = '.readaloud.epub';

export type ReadAloudValidation = {
  report: ReadAloudReportSummary;
  coverage: ReadAloudNarrationCoverage | null;
  warnings: ReadAloudWarningCode[];
  requiresReview: boolean;
  outputBytes: number;
};

@Injectable()
export class ReadAloudPublisher {
  constructor(
    @Inject(readAloudConfig.KEY) private readonly config: ConfigType<typeof readAloudConfig>,
    private readonly jobs: ReadAloudJobRepository,
    private readonly workspace: ReadAloudWorkspace,
    private readonly files: GeneratedBookFileService,
    private readonly activity: ReadAloudActivityService,
  ) {}

  /** Checks the worker's output on the server side before anything reaches the library. */
  async validate(row: ReadAloudJobRow): Promise<ReadAloudValidation> {
    const outputPath = this.workspace.outputPath(row.id);
    const output = await this.workspace.inspect(row.id, outputPath);
    if (!output?.isFile() || output.size <= 0 || output.size > this.config.maxOutputBytes) {
      throw new ReadAloudJobError('invalid_output', 'The generated EPUB is missing, empty, or exceeds the configured size limit');
    }
    const playlist = await buildEpubMediaOverlayPlaylistFromFile(outputPath, row.bookId, null).catch((error: unknown) => {
      throw new ReadAloudJobError('invalid_output', 'The generated EPUB could not be read', { cause: error });
    });
    if (playlist.items.length === 0 || playlist.resources.length === 0) {
      throw new ReadAloudJobError('invalid_output', 'The generated EPUB does not contain a playable media overlay');
    }
    const raw = await this.workspace.readReport(row.id);
    if (raw == null) throw new ReadAloudJobError('invalid_output', 'The alignment report is missing');
    const parsed = parseAlignmentReport(raw);
    const { coverage, chapters } = assessCoverage(parsed.totals, parsed.chapters);
    const { warnings, requiresReview } = reportWarnings(parsed.totals, coverage);
    await this.jobs.saveReportChapters(row.id, chapters);
    return { report: parsed.totals, coverage, warnings, requiresReview, outputBytes: output.size };
  }

  /** Keeps the job's lease alive while `fn` runs; validating and copying a large audiobook takes minutes. */
  async withHeartbeat<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
    const heartbeat = setInterval(() => void this.jobs.heartbeat(jobId).catch(() => undefined), READ_ALOUD_HEARTBEAT_MS);
    try {
      return await fn();
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** Adds the output to the book, or overwrites the read-along the user chose to replace. */
  async publish(row: ReadAloudJobRow, user: RequestUser): Promise<number> {
    const source = {
      bookId: row.bookId,
      sourcePath: this.workspace.outputPath(row.id),
      partialKey: row.id.slice(0, 8),
      maxBytes: this.config.maxOutputBytes,
      user,
    };
    const replaceTarget = await this.replaceTarget(row);
    // Permissions can change while a job waits in the queue or for review, and a superuser may be
    // the one publishing, so the check is on whoever publishes, as of now.
    if (replaceTarget != null && canReplaceReadAlong(user)) {
      const { fileId } = await this.files.replaceFile({ ...source, fileId: replaceTarget });
      await this.activity.record(row.id, 'info', 'publishing', 'file_replaced', 'Replaced the existing read-along', { fileId });
      return fileId;
    }
    if (replaceTarget != null) {
      await this.activity.record(
        row.id,
        'warn',
        'publishing',
        'replace_not_permitted',
        'Replacing the read-along needs permission to delete books; adding a new file instead',
      );
    } else if (row.replaceFileId != null) {
      await this.activity.record(
        row.id,
        'warn',
        'publishing',
        'replace_target_missing',
        'The read-along chosen for replacement is gone; adding a new file instead',
      );
    }
    const { fileId, reused } = await this.files.addFile({ ...source, filename: await this.outputFilename(row) });
    await this.activity.record(row.id, 'info', 'publishing', reused ? 'file_already_attached' : 'file_added', 'Added the read-along to the book', {
      fileId,
    });
    return fileId;
  }

  private async replaceTarget(row: ReadAloudJobRow): Promise<number | null> {
    if (row.replaceFileId == null) return null;
    const readAlongs = await this.jobs.findReadAlongFiles(row.bookId);
    return readAlongs.some((file) => file.fileId === row.replaceFileId) ? row.replaceFileId : null;
  }

  private async outputFilename(row: ReadAloudJobRow): Promise<string> {
    const input = row.input as ReadAloudJobPayload;
    const [source] = await this.jobs.findSourceFiles(row.bookId, [input.epubFileId]);
    const stem = (source?.filename ?? 'book.epub').replace(/\.epub$/i, '').replace(/\.readaloud(?:-[a-z0-9]+)?$/i, '');
    // Shorten the book's part, not the suffix, so a long name still ends in `.readaloud.epub`.
    const fitted = truncateUtf8(stem, GENERATED_FILENAME_MAX_BYTES - Buffer.byteLength(READ_ALONG_SUFFIX)).trimEnd() || 'book';
    return `${fitted}${READ_ALONG_SUFFIX}`;
  }
}
