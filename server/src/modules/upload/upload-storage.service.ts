import { Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import { copyFile, mkdir, rename, stat, unlink } from 'fs/promises';
import { createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';

// Hard ceiling applied at the multipart level. The service enforces a lower configurable limit.
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

@Injectable()
export class UploadStorageService {
  private readonly logger = new Logger(UploadStorageService.name);

  /**
   * Streams the multipart file to a temp path on disk.
   */
  async streamToTemp(source: Readable): Promise<{ tempPath: string; sizeBytes: number }> {
    const tempPath = join(tmpdir(), `projectx-upload-${randomUUID()}`);
    const writeStream = createWriteStream(tempPath);

    try {
      await pipeline(source, writeStream);
    } catch (err) {
      await this.cleanup(tempPath);
      throw err;
    }

    if ((source as Readable & { truncated?: boolean }).truncated) {
      await this.cleanup(tempPath);
      throw new PayloadTooLargeException(`File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB upload limit`);
    }

    const { size } = await stat(tempPath);
    return { tempPath, sizeBytes: size };
  }

  /**
   * Moves the temp file to an already-resolved absolute destination path.
   * Creates parent directories as needed.
   * Uses rename() and falls back to copy+unlink for cross-device moves.
   */
  async moveToPath(tempPath: string, absolutePath: string): Promise<void> {
    await mkdir(dirname(absolutePath), { recursive: true });

    try {
      await rename(tempPath, absolutePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        await copyFile(tempPath, absolutePath);
        await this.cleanup(tempPath);
      } else {
        throw err;
      }
    }
  }

  async cleanup(tempPath: string): Promise<void> {
    await unlink(tempPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') {
        const errorClass = err.name ?? 'Error';
        const errorMessage = err.message.replace(/"/g, '\\"');
        this.logger.warn(`[upload.storage_cleanup] [fail] path="${tempPath}" errorClass=${errorClass} error="${errorMessage}" - file cleanup failed`);
      }
    });
  }
}
