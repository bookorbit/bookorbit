import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { access, mkdir, unlink, writeFile } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { FontFormat } from '@bookorbit/types';
import { FONT_FORMAT_EXTENSIONS } from '@bookorbit/types';

@Injectable()
export class FontStorageService {
  private readonly logger = new Logger(FontStorageService.name);
  private readonly appDataPath: string;

  constructor(private readonly config: ConfigService) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
  }

  async save(userId: number, format: FontFormat, buffer: Buffer): Promise<string> {
    const dir = this.fontDir(userId);
    await mkdir(dir, { recursive: true });
    const storedFileName = `${randomUUID()}${FONT_FORMAT_EXTENSIONS[format]}`;
    await writeFile(join(dir, storedFileName), buffer);
    return storedFileName;
  }

  async delete(userId: number, storedFileName: string): Promise<void> {
    const filePath = join(this.fontDir(userId), storedFileName);
    await unlink(filePath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') {
        this.logger.warn(`Failed to delete font file userId=${userId} file=${storedFileName}: ${err.message}`);
      }
    });
  }

  async getPathIfExists(userId: number, storedFileName: string): Promise<string | null> {
    const filePath = join(this.fontDir(userId), storedFileName);
    try {
      await access(filePath, fsConstants.R_OK);
      return filePath;
    } catch {
      return null;
    }
  }

  getPath(userId: number, storedFileName: string): string {
    return join(this.fontDir(userId), storedFileName);
  }

  private fontDir(userId: number): string {
    return join(this.appDataPath, 'users', String(userId), 'fonts');
  }
}
