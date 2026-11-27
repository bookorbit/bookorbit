import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES,
  GRABBABLE_BOOK_REQUEST_STATUSES,
  UNSETTLED_BOOK_REQUEST_DOWNLOAD_STATUSES,
  isGrabbableBookRequestStatus,
} from '@bookorbit/types';
import type {
  BookRequestDownloadStatus,
  BookRequestStatus,
  BookRequestUploadFile,
  BookRequestUploadFileInput,
  BookRequestUploadManifest,
  BookRequestUploadPlan,
  BookRequestUploadPlanStatus,
} from '@bookorbit/types';
import { randomUUID } from 'crypto';
import { copyFile, mkdir, rename, unlink } from 'fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'path';

import { HARD_MAX_UPLOAD_BYTES } from '../../../common/constants/upload.constants';
import type { RequestUser } from '../../../common/types/request-user';
import { isUniqueViolation } from '../../../common/utils/db-error.utils';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { BookRequestDownloadRow, BookRequestRow, BookRequestUploadFileRow } from '../../../db/schema';
import { AppSettingsService } from '../../app-settings/app-settings.service';
import { RequestUploadReceiver } from '../../upload/request-upload-receiver';
import { uploadError } from '../../upload/upload-errors';
import { UploadValidatorService } from '../../upload/upload-validator.service';
import { BOOK_REQUEST_DOWNLOAD_FAILED, BOOK_REQUEST_UPLOAD_ARRIVED, BookRequestEventsService } from '../book-request-events.service';
import { BookRequestGateway } from '../book-request.gateway';
import { BookRequestRepository } from '../book-request.repository';
import type { ReleaseMediaKind } from '../../scanner/lib/release-plan';
import { BookRequestDownloadRepository } from './book-request-download.repository';
import { RequestAlreadyClaimedException } from './request-fulfillment.service';
import { RequestUploadFileRepository } from './request-upload-file.repository';
import { planRequestUpload, uploadSet, type PlannedUpload } from './request-upload-plan';
import { RequestUploadStorageService } from './request-upload-storage.service';

/** What a release title or staging folder may run to; both are named after something a person picked. */
const MAX_RELEASE_NAME_LENGTH = 200;

/**
 * A book request closed by uploading its files, which makes the upload the release.
 *
 * The attempt is an ordinary `book_request_downloads` row with source `upload` and no client: the
 * poll loop never asks anything about it, and once its last file lands it is `completed` like any
 * download and goes through the same import, verification and filing. Each file arrives as its
 * own upload session targeting one manifest entry, so a phone can send them in the background, in
 * any order, with nothing to call when it is done.
 */
@Injectable()
export class RequestUploadService extends RequestUploadReceiver implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RequestUploadService.name);
  private readonly onDownloadFailed = (downloadId: number) => void this.discardFailed(downloadId);

  constructor(
    private readonly requests: BookRequestRepository,
    private readonly downloads: BookRequestDownloadRepository,
    private readonly files: RequestUploadFileRepository,
    private readonly storage: RequestUploadStorageService,
    private readonly appSettings: AppSettingsService,
    private readonly validator: UploadValidatorService,
    private readonly gateway: BookRequestGateway,
    private readonly events: BookRequestEventsService,
  ) {
    super();
  }

  onModuleInit(): void {
    this.events.on(BOOK_REQUEST_DOWNLOAD_FAILED, this.onDownloadFailed);
  }

  onModuleDestroy(): void {
    this.events.off(BOOK_REQUEST_DOWNLOAD_FAILED, this.onDownloadFailed);
  }

  /** What the picked files become, before any of them is sent. */
  async plan(requestId: number, files: BookRequestUploadFileInput[]): Promise<BookRequestUploadPlan> {
    const request = await this.requireUploadable(requestId);
    return (await this.planFor(request, files)).plan;
  }

  /**
   * Starts the attempt and declares every file it waits for. The files sent must be exactly the
   * ones the plan sends, so what arrives can never be a different release from the one the drawer
   * described.
   */
  async start(requestId: number, input: BookRequestUploadFileInput[], holdForReview: boolean, user: RequestUser): Promise<BookRequestUploadManifest> {
    const started = Date.now();
    const request = await this.requireUploadable(requestId);
    const planned = await this.planFor(request, input);
    const sending = this.assertSendable(planned);

    // The same claim a grab takes, for the same reason: two people cannot start two releases.
    const previousStatus = request.status as BookRequestStatus;
    const claim = await this.requests.claimForGrab(requestId, GRABBABLE_BOOK_REQUEST_STATUSES);
    if (claim !== 'claimed') {
      throw new RequestAlreadyClaimedException(
        claim === 'duplicate'
          ? 'Somebody has already requested this book again, and that request now holds the claim on it. Work from that one instead.'
          : 'Another release is already being sent for this request',
      );
    }

    let download: BookRequestDownloadRow | undefined;
    try {
      const releaseName = this.releaseName(planned, request);
      const totalBytes = sending.reduce((sum, file) => sum + file.sizeBytes, 0);
      download = await this.downloads.create({
        requestId,
        downloadClientId: null,
        indexerId: null,
        source: 'upload',
        automated: false,
        uploadedByUserId: user.id,
        releaseTitle: this.releaseTitle(planned, sending, request),
        holdForReview,
        releaseSizeBytes: totalBytes,
        releaseFormat: primaryFormat(planned) ?? null,
        clientKey: `upload-${randomUUID()}`,
        status: 'downloading',
        totalBytes,
        grabbedAt: new Date(),
        lastProgressAt: new Date(),
      });
      const contentPath = join(this.storage.directoryFor(download.id), releaseName);
      await mkdir(contentPath, { recursive: true });
      download = (await this.downloads.update(download.id, { contentPath })) ?? download;
      const rows = await this.files.createMany(
        sending.map((file) => ({ downloadId: download!.id, path: file.releasePath, sizeBytes: file.sizeBytes })),
      );

      await this.requests.updateIf(requestId, ['grabbed'], { status: 'downloading', statusReason: null });
      await this.requests.clearDismissals(requestId);
      this.logger.log(
        `[book_request.upload] [start] requestId=${requestId} downloadId=${download.id} userId=${user.id} files=${rows.length} sizeBytes=${totalBytes} plan=${planned.plan.status} holdForReview=${holdForReview} - upload started`,
      );
      this.gateway.emitChanged();
      return { downloadId: download.id, uploadedByUserId: user.id, files: rows.map(toManifestFile) };
    } catch (error) {
      this.logger.warn(
        `[book_request.upload] [fail] requestId=${requestId} downloadId=${download?.id ?? '-'} durationMs=${Date.now() - started} errorClass=${error instanceof Error ? error.constructor.name : 'unknown'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - upload could not be started`,
      );
      if (download) {
        await this.downloads.updateIf(download.id, UNSETTLED_BOOK_REQUEST_DOWNLOAD_STATUSES, {
          status: 'failed',
          errorMessage: 'The upload could not be started',
        });
        await this.storage.discard(download);
      }
      await this.requests.updateIf(requestId, ['grabbed', 'downloading'], { status: previousStatus });
      if (isUniqueViolation(error)) throw new BadRequestException('The same file was declared twice');
      throw error;
    }
  }

  /** The upload a request is waiting on, or null once it is over or the request has none. */
  async manifest(requestId: number): Promise<BookRequestUploadManifest | null> {
    const latest = (await this.downloads.findLatestForRequests([requestId])).get(requestId)?.download;
    if (!latest || latest.source !== 'upload' || !(ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES as readonly string[]).includes(latest.status)) return null;
    const rows = await this.files.findForDownload(latest.id);
    return { downloadId: latest.id, uploadedByUserId: latest.uploadedByUserId, files: rows.map(toManifestFile) };
  }

  async admit(requestFileId: number, filename: string, sizeBytes: number, user: RequestUser): Promise<void> {
    const { file } = await this.expected(requestFileId, user);
    if (file.status === 'received') throw uploadError.invalidSessionState('This file has already arrived');
    if (basename(file.path) !== filename) throw uploadError.invalidTarget(`This upload expects "${basename(file.path)}", not "${filename}"`);
    if (file.sizeBytes !== sizeBytes) throw uploadError.invalidTarget(`"${filename}" is not the size the upload declared`);
  }

  async progress(requestFileId: number, receivedBytes: number): Promise<void> {
    const row = await this.files.findWithAttempt(requestFileId);
    if (!row || !isActive(row.download)) return;
    if (!(await this.files.recordProgress(requestFileId, receivedBytes))) return;
    await this.reportProgress(row.download, false);
  }

  async receive(requestFileId: number, stagingPath: string, user: RequestUser): Promise<void> {
    const { file, download } = await this.expected(requestFileId, user);
    if (file.status === 'received') return;
    if (!download.contentPath) throw uploadError.invalidTarget('This upload has nowhere to put its files');

    const destination = resolve(download.contentPath, ...file.path.split('/'));
    const within = relative(resolve(download.contentPath), destination);
    if (within === '' || within.startsWith('..') || within.split(sep).includes('..')) {
      throw uploadError.invalidTarget('This file would land outside its upload');
    }
    await mkdir(dirname(destination), { recursive: true });
    await moveFile(stagingPath, destination);

    if (!(await this.files.markReceived(file.id))) return;
    const totals = await this.reportProgress(download, true);
    if (totals.receivedCount < totals.fileCount) return;

    // Conditional on the attempt still running: a cancellation that landed while the last file
    // was being moved has already settled it, and must not be imported over.
    const completed = await this.downloads.updateIf(download.id, ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES, {
      status: 'completed',
      progressPercent: 100,
      downloadedBytes: totals.totalBytes,
      completedAt: new Date(),
      lastProgressAt: new Date(),
    });
    if (!completed) return;

    this.logger.log(
      `[book_request.upload] [end] requestId=${download.requestId} downloadId=${download.id} files=${totals.fileCount} sizeBytes=${totals.totalBytes} durationMs=${Date.now() - (download.grabbedAt ?? download.createdAt).getTime()} - every file arrived, importing`,
    );
    await this.emitProgress(completed, true);
    this.gateway.emitChanged();
    this.events.emit(BOOK_REQUEST_UPLOAD_ARRIVED, completed.id);
  }

  private async expected(requestFileId: number, user: RequestUser): Promise<{ file: BookRequestUploadFileRow; download: BookRequestDownloadRow }> {
    const row = await this.files.findWithAttempt(requestFileId);
    if (!row) throw uploadError.invalidTarget('This upload is no longer expected');
    if (row.download.uploadedByUserId !== user.id) throw uploadError.invalidTarget('Only the person who started this upload can send its files');
    if (!isActive(row.download)) throw uploadError.invalidTarget('This upload has ended');
    return row;
  }

  private async reportProgress(download: BookRequestDownloadRow, statusChanged: boolean) {
    const totals = await this.files.totals(download.id);
    // Short of 100 until the import takes over, so a bar that fills never reads as finished.
    const percent = totals.totalBytes > 0 ? Math.min(99, Math.floor((totals.receivedBytes / totals.totalBytes) * 100)) : 0;
    const updated = await this.downloads.updateIf(download.id, ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES, {
      downloadedBytes: totals.receivedBytes,
      progressPercent: percent,
      lastProgressAt: new Date(),
    });
    if (updated) await this.emitProgress(updated, statusChanged);
    return totals;
  }

  private async emitProgress(download: BookRequestDownloadRow, statusChanged: boolean): Promise<void> {
    const viewers = (await this.requests.findRequestViewerIds([download.requestId])).get(download.requestId) ?? [];
    this.gateway.emitProgress(
      {
        requestId: download.requestId,
        downloadId: download.id,
        status: download.status as BookRequestDownloadStatus,
        progressPercent: download.progressPercent,
        downloadedBytes: download.downloadedBytes,
        totalBytes: download.totalBytes,
      },
      viewers,
      statusChanged,
    );
  }

  private async discardFailed(downloadId: number): Promise<void> {
    const download = await this.downloads.findById(downloadId);
    if (download?.source === 'upload') await this.storage.discard(download);
  }

  private async requireUploadable(requestId: number): Promise<BookRequestRow> {
    const joined = await this.requests.findById(requestId);
    if (!joined) throw new NotFoundException('Book request not found');
    const request = joined.request;
    if (!isGrabbableBookRequestStatus(request.status as BookRequestStatus)) {
      throw new BadRequestException(`A request that is ${request.status} cannot take an upload`);
    }
    if (request.targetLibraryId === null) {
      throw new BadRequestException('Set a destination library on this request before uploading its files');
    }
    return request;
  }

  private async planFor(request: BookRequestRow, files: BookRequestUploadFileInput[]): Promise<PlannedUpload> {
    const maxMb = await this.appSettings.getMaxUploadSizeMb();
    return planRequestUpload(files, {
      mediaKind: request.mediaKind as ReleaseMediaKind,
      title: request.title,
      maxFileSizeBytes: Math.min(HARD_MAX_UPLOAD_BYTES, maxMb * 1_024 * 1_024),
      sanitizeName: (name) => this.validator.sanitizeFilename(name),
    });
  }

  /** The files to declare, refused unless they are exactly what the plan would send. */
  private assertSendable(planned: PlannedUpload) {
    const { status, selectedUnitIndex } = planned.plan;
    if (status === 'choose') throw new BadRequestException('These files hold several books. Send only the one this request is for.');
    if (status !== 'ready' && status !== 'archive') throw new BadRequestException(refusal(status));
    const sending = uploadSet(planned.files, status, selectedUnitIndex);
    const extra = planned.files.filter((file) => !sending.includes(file));
    if (extra.length > 0) {
      throw new BadRequestException(
        `Leave out the files the upload does not use: ${extra
          .slice(0, 3)
          .map((file) => `"${file.path}"`)
          .join(', ')}`,
      );
    }
    return sending;
  }

  /** The staging folder the release is read from, which also titles a book that sits at its root. */
  private releaseName(planned: PlannedUpload, request: BookRequestRow): string {
    return this.validator.sanitizeFilename((planned.plan.rootName ?? request.title).slice(0, MAX_RELEASE_NAME_LENGTH));
  }

  private releaseTitle(planned: PlannedUpload, sending: PlannedUpload['files'], request: BookRequestRow): string {
    const name = planned.plan.rootName ?? (sending.length === 1 ? basename(sending[0]!.path) : request.title);
    return name.slice(0, MAX_RELEASE_NAME_LENGTH);
  }
}

function isActive(download: BookRequestDownloadRow): boolean {
  return download.source === 'upload' && (ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES as readonly string[]).includes(download.status);
}

function toManifestFile(row: BookRequestUploadFileRow): BookRequestUploadFile {
  return {
    id: row.id,
    path: row.path,
    sizeBytes: row.sizeBytes,
    receivedBytes: row.receivedBytes,
    status: row.status === 'received' ? 'received' : 'pending',
  };
}

function primaryFormat(planned: PlannedUpload): string | undefined {
  const { units, selectedUnitIndex } = planned.plan;
  if (selectedUnitIndex !== null) return units[selectedUnitIndex]?.formats[0];
  return planned.files.find((file) => file.role === 'archive')?.format ?? undefined;
}

function refusal(status: BookRequestUploadPlanStatus): string {
  switch (status) {
    case 'wrong_medium':
      return 'None of these files is the kind of book this request asks for';
    case 'several_archives':
      return 'These files are several separate archives. Upload one archive, or the book files themselves.';
    case 'file_too_large':
      return 'A file is larger than this server accepts';
    default:
      return 'None of these files is a book';
  }
}

/** Same filesystem as the session's staging in every layout BookOrbit ships, but a copy covers the rest. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await copyFile(from, to);
    await unlink(from).catch(() => undefined);
  }
}
