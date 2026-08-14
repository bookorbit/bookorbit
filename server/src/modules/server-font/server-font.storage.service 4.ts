import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { constants as fsConstants } from 'fs';
import { access, mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import type { FontFormat } from '@bookorbit/types';
import { FONT_FORMAT_EXTENSIONS } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

/**
 * Stores administrator-curated fonts in `<appData>/fonts`, alongside the per-user
 * `<appData>/users/<id>/fonts` trees rather than inside any one of them.
 */
@Injectable()
export class ServerFontStorageService {
  private readonly logger = new Logger(ServerFontStorageService.name);
  private readonly appDataPath: string;

  constructor(private readonly config: ConfigService) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
  }

  async save(format: FontFormat, buffer: Buffer): Promise<string> {
    await mkdir(this.fontDir(), { recursive: true });
    const storedFileName = `${randomUUID()}${FONT_FORMAT_EXTENSIONS[format]}`;
    await writeFile(join(this.fontDir(), storedFileName), buffer);
    return storedFileName;
  }

  async delete(storedFileName: string): Promise<void> {
    const filePath = join(this.fontDir(), storedFileName);
    await unlink(filePath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') {
        this.logger.warn(
          `[server_font.file_delete] [fail] file="${sanitizeLogValue(storedFileName)}" errorClass=${err.name} error="${sanitizeLogValue(err.message)}" - server font file cleanup failed`,
        );
      }
    });
  }

  async getPathIfExists(storedFileName: string): Promise<string | null> {
    const filePath = join(this.fontDir(), storedFileName);
    try {
      await access(filePath, fsConstants.R_OK);
      return filePath;
    } catch {
      return null;
    }
  }

  private fontDir(): string {
    return join(this.appDataPath, 'fonts');
  }
}
