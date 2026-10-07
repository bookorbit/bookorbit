import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { mkdir, open, opendir, realpath, unlink } from 'fs/promises';
import type { Dir } from 'fs';
import { join } from 'path';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { storageConfig } from '../../../config/config';
import { KoboDownloadRepository } from '../kobo-download.repository';

const EVENT = 'kobo.download_hash_registration';
const ENTRY = /^([1-9]\d*)-([0-9a-f]{32})$/;
const REPLAY_BATCH = 1000;

@Injectable()
export class KoboDownloadHashRegistrationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(KoboDownloadHashRegistrationService.name);
  private replaying: Promise<void> | null = null;
  private entries: Dir | null = null;
  private stopped = false;

  constructor(
    private readonly repository: KoboDownloadRepository,
    @Inject(storageConfig.KEY) private readonly storage: ConfigType<typeof storageConfig>,
  ) {}

  onApplicationBootstrap(): void {
    void this.replay();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.replaying;
    await this.closeEntries();
  }

  async record(fileId: number, hash: string): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.repository.registerDeliveredHash(fileId, hash);
      return;
    } catch (error) {
      this.logFailure(error, startedAt, fileId, 'database registration failed; queuing retry');
    }
    try {
      if (!Number.isSafeInteger(fileId) || fileId <= 0 || fileId > 2_147_483_647 || !/^[0-9a-f]{32}$/.test(hash)) {
        throw new Error('Invalid delivered identity');
      }
      const directory = await this.pendingDirectory(true);
      // The immutable filename carries the identity, so recovery never needs the temporary book.
      const entry = await open(join(directory, `${fileId}-${hash}`), 'wx', 0o600).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST') return null;
        throw error;
      });
      if (entry) {
        try {
          await entry.sync();
        } finally {
          await entry.close();
        }
      }
      const handle = await open(directory, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      this.logFailure(error, startedAt, fileId, 'identity retry could not be persisted');
    }
  }

  @Interval(30_000)
  replay(): Promise<void> {
    if (this.replaying) return this.replaying;
    if (this.stopped) return Promise.resolve();
    this.replaying = this.replayPending().finally(() => {
      this.replaying = null;
    });
    return this.replaying;
  }

  private async pendingDirectory(create: boolean): Promise<string> {
    const root = await realpath(this.storage.appDataPath);
    const directory = join(root, '.kobo-download-hashes');
    if (create)
      await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
    if ((await realpath(directory)) !== directory) throw new Error('Hash retry directory must not be a symbolic link');
    return directory;
  }

  private async replayPending(): Promise<void> {
    const startedAt = Date.now();
    let removedEntries = 0;
    let skippedEntries = 0;
    try {
      const directory = await this.pendingDirectory(false);
      // Retain the cursor between bounded batches so even directories and failed entries
      // cannot permanently hide later identities. Failed identities remain for the next pass.
      this.entries ??= await opendir(directory);
      for (let scanned = 0; scanned < REPLAY_BATCH && !this.stopped; scanned++) {
        const entry = await this.entries.read();
        if (!entry) {
          await this.closeEntries();
          break;
        }
        const match = ENTRY.exec(entry.name);
        const fileId = Number(match?.[1]);
        if (!entry.isFile() || !match || !Number.isSafeInteger(fileId) || fileId > 2_147_483_647) {
          if (entry.isFile() || entry.isSymbolicLink()) {
            await this.removeEntry(directory, entry.name);
            removedEntries++;
          } else {
            skippedEntries++;
          }
          continue;
        }
        await this.repository.registerDeliveredHash(fileId, match[2]!);
        await this.removeEntry(directory, entry.name);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.logFailure(error, startedAt, undefined, 'queued identity replay failed');
    } finally {
      if (removedEntries || skippedEntries) {
        this.logger.warn(
          `[${EVENT}] [end] durationMs=${Date.now() - startedAt} removedEntries=${removedEntries} skippedEntries=${skippedEntries} - invalid retry entries encountered`,
        );
      }
    }
  }

  private async removeEntry(directory: string, name: string): Promise<void> {
    await unlink(join(directory, name)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  private async closeEntries(): Promise<void> {
    const entries = this.entries;
    this.entries = null;
    await entries?.close();
  }

  private logFailure(error: unknown, startedAt: number, fileId: number | undefined, message: string): void {
    this.logger.warn(
      `[${EVENT}] [fail] fileId=${fileId ?? 'none'} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'UnknownError'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - ${message}`,
    );
  }
}
