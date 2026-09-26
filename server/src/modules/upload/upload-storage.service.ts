import { Injectable, Logger } from '@nestjs/common';
import { mkdir, open, rename, stat, unlink } from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

import { AppSettingsService } from '../app-settings/app-settings.service';
import { HARD_MAX_UPLOAD_BYTES } from '../../common/constants/upload.constants';
import { uploadError } from './upload-errors';

// Hard ceiling applied at the multipart level. The service enforces a lower configurable limit.
export const MAX_UPLOAD_BYTES = HARD_MAX_UPLOAD_BYTES;

export class UploadDestinationExistsError extends Error {}

@Injectable()
export class UploadStorageService {
  private readonly logger = new Logger(UploadStorageService.name);

  constructor(private readonly appSettings: AppSettingsService) {}

  /**
   * Streams the multipart file to a temp path on disk.
   */
  async streamToTemp(source: Readable, requestedLimitBytes?: number): Promise<{ tempPath: string; sizeBytes: number }> {
    const tempPath = join(tmpdir(), `bookorbit-upload-${randomUUID()}`);
    const writeStream = createWriteStream(tempPath);
    const configuredMb = await this.appSettings.getMaxUploadSizeMb();
    const configuredBytes = Math.min(HARD_MAX_UPLOAD_BYTES, configuredMb * 1_024 * 1_024);
    const limitBytes = Math.min(configuredBytes, requestedLimitBytes ?? configuredBytes);
    let totalBytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        totalBytes += chunk.length;
        if (totalBytes > limitBytes) {
          callback(uploadError.tooLarge(`File exceeds the ${Math.floor(limitBytes / 1_024 / 1_024)} MB upload limit`));
          return;
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(source, limiter, writeStream);
    } catch (err) {
      await this.cleanup(tempPath);
      if ((err as NodeJS.ErrnoException).code === 'ENOSPC') {
        throw uploadError.storageFull('The server does not have enough storage for this upload');
      }
      throw err;
    }

    if ((source as Readable & { truncated?: boolean }).truncated) {
      await this.cleanup(tempPath);
      throw uploadError.tooLarge(`File exceeds the ${Math.floor(limitBytes / 1_024 / 1_024)} MB upload limit`);
    }

    const { size } = await stat(tempPath);
    return { tempPath, sizeBytes: size };
  }

  /**
   * Moves the temp file to an already-resolved absolute destination path.
   * Creates parent directories as needed.
   * Uses rename() and stages cross-device copies on the destination filesystem.
   */
  async moveToPath(tempPath: string, absolutePath: string): Promise<void> {
    await mkdir(dirname(absolutePath), { recursive: true });

    try {
      await rename(tempPath, absolutePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EXDEV') {
        await this.copyAcrossDevices(tempPath, absolutePath);
      } else if (code === 'EEXIST') {
        throw new UploadDestinationExistsError('Upload destination already exists');
      } else if (code === 'ENOSPC') {
        throw uploadError.storageFull('The server does not have enough storage for this upload');
      } else {
        throw err;
      }
    }
  }

  private async copyAcrossDevices(sourcePath: string, destinationPath: string): Promise<void> {
    const stagingPath = join(dirname(destinationPath), `.bookorbit-upload-${randomUUID()}.tmp`);
    const stagingFile = await open(stagingPath, 'wx');

    try {
      // copyFile also copies permissions, which ACL-backed shares may forbid despite allowing writes.
      // Stage without a book extension so scanners cannot ingest a partially written file.
      await pipeline(createReadStream(sourcePath), stagingFile.createWriteStream());
      await rename(stagingPath, destinationPath);
    } catch (err) {
      await stagingFile.close().catch(() => {});
      await this.cleanup(stagingPath);
      throw err;
    }

    await this.cleanup(sourcePath);
  }

  async cleanup(tempPath: string): Promise<void> {
    await unlink(tempPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') {
        const errorClass = err.name ?? 'Error';
        const errorMessage = sanitizeLogValue(err.message);
        this.logger.warn(`[upload.storage_cleanup] [fail] path="${tempPath}" errorClass=${errorClass} error="${errorMessage}" - file cleanup failed`);
      }
    });
  }
}
