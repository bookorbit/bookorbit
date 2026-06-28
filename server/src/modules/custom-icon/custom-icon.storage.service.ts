import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { constants as fsConstants } from 'fs';
import { access, mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

@Injectable()
export class CustomIconStorageService {
  private readonly logger = new Logger(CustomIconStorageService.name);
  private readonly appDataPath: string;

  constructor(private readonly config: ConfigService) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
  }

  async save(svg: string): Promise<string> {
    await mkdir(this.iconDir(), { recursive: true });
    const storedFileName = `${randomUUID()}.svg`;
    await writeFile(join(this.iconDir(), storedFileName), svg, 'utf8');
    return storedFileName;
  }

  async delete(storedFileName: string): Promise<void> {
    const filePath = join(this.iconDir(), storedFileName);
    await unlink(filePath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') {
        this.logger.warn(
          `[custom_icon.file_delete] [fail] file="${sanitizeLogValue(storedFileName)}" errorClass=${err.name} error="${sanitizeLogValue(err.message)}" - custom icon file cleanup failed`,
        );
      }
    });
  }

  async getPathIfExists(storedFileName: string): Promise<string | null> {
    const filePath = join(this.iconDir(), storedFileName);
    try {
      await access(filePath, fsConstants.R_OK);
      return filePath;
    } catch {
      return null;
    }
  }

  private iconDir(): string {
    return join(this.appDataPath, 'icons');
  }
}
