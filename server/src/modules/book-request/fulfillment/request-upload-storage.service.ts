import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { rm } from 'fs/promises';
import { join } from 'path';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { BookRequestDownloadRow } from '../../../db/schema';
import { UploadSessionService } from '../../upload/upload-session.service';
import { RequestUploadFileRepository } from './request-upload-file.repository';

/** Where the files of `upload` attempts wait for their import, one directory per attempt. */
export function requestUploadRoot(appDataPath: string): string {
  return join(appDataPath, 'request-uploads');
}

export function requestUploadDirectory(appDataPath: string, downloadId: number): string {
  return join(requestUploadRoot(appDataPath), String(downloadId));
}

/**
 * The bytes an `upload` attempt holds: the files that arrived, in its staging directory, and the
 * sessions still sending the rest. Kept apart from the upload flow so the removal service can drop
 * them without depending on the flow that depends on it.
 */
@Injectable()
export class RequestUploadStorageService {
  private readonly logger = new Logger(RequestUploadStorageService.name);
  private readonly appDataPath: string;

  constructor(
    config: ConfigService,
    private readonly files: RequestUploadFileRepository,
    private readonly sessions: UploadSessionService,
  ) {
    this.appDataPath = config.getOrThrow<string>('storage.appDataPath');
  }

  get root(): string {
    return requestUploadRoot(this.appDataPath);
  }

  directoryFor(downloadId: number): string {
    return requestUploadDirectory(this.appDataPath, downloadId);
  }

  /** Best effort: an abandoned session expires and an orphaned directory costs only disk. */
  async discard(download: BookRequestDownloadRow): Promise<void> {
    if (download.source !== 'upload') return;
    try {
      await this.sessions.cancelForRequestFiles(await this.files.idsForDownload(download.id));
      await rm(this.directoryFor(download.id), { recursive: true, force: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[book_request.upload_cleanup] [fail] requestId=${download.requestId} downloadId=${download.id} errorClass=${(error as Error)?.constructor?.name ?? 'Error'} error="${sanitizeLogValue(message)}" - uploaded files were left on disk`,
      );
    }
  }
}
