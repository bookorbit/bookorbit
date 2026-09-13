import { Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import { mkdir, open, rename, stat, unlink } from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

import { AppSettingsService } from '../app-settings/app-settings.service';

// Hard ceiling applied at the multipart level. The service enforces a lower configurable limit.
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

@Injectable()
export class UploadStorageService {
  private readonly logger = new Logger(UploadStorageService.name);

  constructor(private readonly appSettings: AppSettingsService) {}

  /**
   * Streams the multipart file to a temp path on disk.
   */
  async streamToTemp(source: Readable): Promise<{ tempPath: string; sizeBytes: number }> {
    const tempPath = join(tmpdir(), `bookorbit-upload-${randomUUID()}`);
    const writeStream = createWriteStream(tempPath);

    try {
      await pipeline(source, writeStream);
    } catch (err) {
      await this.cleanup(tempPath);
      throw err;
    }

    if ((source as Readable & { truncated?: boolean }).truncated) {
      await this.cleanup(tempPath);
      const limitMb = await this.appSettings.getMaxUploadSizeMb();
      throw new PayloadTooLargeException(`File exceeds the ${limitMb} MB upload limit`);
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
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      await this.copyAcrossDevices(tempPath, absolutePath);
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
