import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { opendir, realpath } from 'fs/promises';
import { join } from 'path';

import { computeFileHash } from '../../../common/utils/file-hash.utils';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { storageConfig } from '../../../config/config';
import { AppSettingsService } from '../../app-settings/app-settings.service';
import { KoboDownloadRepository } from '../kobo-download.repository';

const SETTING_KEY = 'kobo_download_hash_backfill';
const VERSION = 1;
const EVENT = 'kobo.download_hash_backfill';
const CACHE_FILE = /^([0-9a-f]{32})(?:-noaudio-v[1-9]\d*)?(?:-hyph)?\.kepub\.epub$/;

@Injectable()
export class KoboDownloadHashBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KoboDownloadHashBackfillService.name);
  private running: Promise<{ registered: number; skipped: number; failed: number }> | null = null;

  constructor(
    private readonly repository: KoboDownloadRepository,
    private readonly appSettings: AppSettingsService,
    @Inject(storageConfig.KEY) private readonly storage: ConfigType<typeof storageConfig>,
  ) {}

  onApplicationBootstrap(): void {
    const startedAt = Date.now();
    void this.run().catch((error: unknown) => this.logFailure(error, startedAt));
  }

  run(): Promise<{ registered: number; skipped: number; failed: number }> {
    if (this.running) return this.running;
    this.running = this.recover().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async recover(): Promise<{ registered: number; skipped: number; failed: number }> {
    const totals = { registered: 0, skipped: 0, failed: 0 };
    const marker = await this.appSettings.getValue(SETTING_KEY);
    if (marker === String(VERSION)) return totals;
    const startedAt = Date.now();
    this.logger.log(`[${EVENT}] [start] version=${VERSION} - cached download identity recovery started`);
    try {
      const appDataPath = await realpath(this.storage.appDataPath);
      const cachePath = join(appDataPath, '.kepub-cache');
      if ((await realpath(cachePath)) !== cachePath) throw new Error('KEPUB cache must not be a symbolic link');
      const directories = await opendir(cachePath);
      // Streaming directory iterators and sequential work keep memory and database load bounded.
      for await (const directory of directories) {
        const bookId = Number(directory.name);
        if (!directory.isDirectory() || !/^[1-9]\d*$/.test(directory.name) || !Number.isSafeInteger(bookId) || bookId > 2_147_483_647) {
          totals.skipped++;
          continue;
        }
        try {
          const bookPath = join(cachePath, directory.name);
          if ((await realpath(bookPath)) !== bookPath) {
            totals.skipped++;
            continue;
          }
          const files = await opendir(bookPath);
          for await (const file of files) {
            const match = CACHE_FILE.exec(file.name);
            if (!file.isFile() || !match) {
              totals.skipped++;
              continue;
            }
            try {
              const filePath = join(bookPath, file.name);
              if ((await realpath(filePath)) !== filePath) {
                totals.skipped++;
                continue;
              }
              const fileId = await this.repository.findCachedSourceFileId(bookId, match[1]!);
              if (fileId === null) {
                totals.skipped++;
                continue;
              }
              await this.repository.registerDeliveredHash(fileId, await computeFileHash(filePath));
              totals.registered++;
            } catch (error) {
              totals.failed++;
              this.logFailure(error, startedAt, bookId);
            }
          }
        } catch (error) {
          totals.failed++;
          this.logFailure(error, startedAt, bookId);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (totals.failed === 0) await this.appSettings.setValue(SETTING_KEY, String(VERSION));
    this.logger.log(
      `[${EVENT}] [end] version=${VERSION} durationMs=${Date.now() - startedAt} registered=${totals.registered} skipped=${totals.skipped} failed=${totals.failed} - cached download identity recovery completed`,
    );
    return totals;
  }

  private logFailure(error: unknown, startedAt: number, bookId?: number): void {
    this.logger.warn(
      `[${EVENT}] [fail] version=${VERSION} bookId=${bookId ?? 'none'} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'UnknownError'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - cached download identity recovery failed`,
    );
  }
}
