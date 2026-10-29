import { Injectable } from '@nestjs/common';
import type { ReadAloudErrorCode, ReadAloudJob, ReadAloudStageUnit } from '@bookorbit/types';
import { isReadAloudErrorCode, Permission, READ_ALOUD_ACTIVE_JOB_STATUSES } from '@bookorbit/types';

import type { ReadAloudJobRow } from '../../db/schema';
import { ReadAloudJobRepository, type ReadAloudJobPayload } from './read-aloud-job.repository';

export type ReadAloudViewer = { id: number; isSuperuser: boolean };

const ACTIVE_STATUSES = new Set<string>(READ_ALOUD_ACTIVE_JOB_STATUSES);

export function canManageReadAloudJob(row: Pick<ReadAloudJobRow, 'requestedByUserId'>, viewer: ReadAloudViewer): boolean {
  return viewer.isSuperuser || (row.requestedByUserId != null && row.requestedByUserId === viewer.id);
}

/** Replacing overwrites a file's content for good, which `DELETE /books/files/:fileId` gates the same way. */
export function canReplaceReadAlong(user: { isSuperuser: boolean; permissions: readonly string[] }): boolean {
  return user.isSuperuser || user.permissions.includes(Permission.LibraryDeleteBooks);
}

@Injectable()
export class ReadAloudPresenter {
  constructor(private readonly jobs: ReadAloudJobRepository) {}

  async present(row: ReadAloudJobRow, viewer: ReadAloudViewer): Promise<ReadAloudJob> {
    const input = row.input as ReadAloudJobPayload;
    const [queuePosition, requesterName] = await Promise.all([
      row.status === 'queued' && !row.cancelRequested ? this.jobs.countQueuedAhead(row) : Promise.resolve(null),
      this.jobs.findRequesterName(row.requestedByUserId),
    ]);
    const stageDetail =
      row.stageCurrent != null && row.stageTotal != null && row.stageUnit != null
        ? { current: row.stageCurrent, total: row.stageTotal, unit: row.stageUnit as ReadAloudStageUnit }
        : null;
    return {
      id: row.id,
      bookId: row.bookId,
      status: row.status as ReadAloudJob['status'],
      stage: row.stage as ReadAloudJob['stage'],
      progress: row.progress,
      stageDetail,
      queuePosition,
      input: {
        epubFileId: input.epubFileId,
        audioFileIds: input.audioFileIds,
        language: input.language,
        granularity: input.granularity,
        sourceBytes: input.sourceBytes,
        replaceFileId: row.replaceFileId,
      },
      decisions: row.decisions,
      outputFileId: row.outputFileId,
      report: row.report,
      warnings: row.warnings,
      coverage: row.coverage ?? null,
      errorCode: this.errorCode(row.errorCode),
      cancelRequested: row.cancelRequested && row.status === 'processing',
      cancellable: ACTIVE_STATUSES.has(row.status) && !row.cancelRequested && row.stage !== 'publishing' && !row.publishApproved,
      device: row.device,
      canManage: canManageReadAloudJob(row, viewer),
      requestedBy: { id: row.requestedByUserId, name: requesterName },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      startedAt: row.status === 'processing' ? (row.startedAt?.toISOString() ?? null) : null,
      completedAt: row.completedAt?.toISOString() ?? null,
      dismissedAt: row.dismissedAt?.toISOString() ?? null,
      expiresAt: row.status === 'awaiting_review' ? (row.expiresAt?.toISOString() ?? null) : null,
      retryableUntil: row.status === 'failed' ? (row.workExpiresAt?.toISOString() ?? null) : null,
    };
  }

  private errorCode(value: string | null): ReadAloudErrorCode | null {
    if (value == null) return null;
    return isReadAloudErrorCode(value) ? value : 'unknown';
  }
}
