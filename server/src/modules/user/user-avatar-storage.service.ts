import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { access, mkdir, unlink, writeFile } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { join } from 'path';

@Injectable()
export class UserAvatarStorageService {
  private readonly logger = new Logger(UserAvatarStorageService.name);
  private readonly appDataPath: string;

  constructor(private readonly config: ConfigService) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
  }

  async saveAvatar(userId: number, bytes: Buffer): Promise<void> {
    const path = this.avatarPath(userId);
    await mkdir(this.avatarDir(userId), { recursive: true });
    await writeFile(path, bytes);
  }

  async deleteAvatar(userId: number): Promise<void> {
    await unlink(this.avatarPath(userId)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') {
        this.logger.warn(`Failed to delete avatar for userId=${userId}: ${err.message}`);
      }
    });
  }

  async getAvatarPathIfExists(userId: number): Promise<string | null> {
    const path = this.avatarPath(userId);
    try {
      await access(path, fsConstants.R_OK);
      return path;
    } catch {
      return null;
    }
  }

  private avatarDir(userId: number): string {
    return join(this.appDataPath, 'users', String(userId));
  }

  private avatarPath(userId: number): string {
    return join(this.avatarDir(userId), 'avatar.jpg');
  }
}
