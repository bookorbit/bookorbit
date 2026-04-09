import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Dirent } from 'fs';
import { readdir, unlink } from 'fs/promises';
import { join } from 'path';
import type { AsyncSubscription } from '@parcel/watcher';

import { isPrimaryFormat } from '../scanner/lib/classify';
import { waitForStability } from '../scanner/lib/stability';
import { BookBucketIngestService } from './book-bucket-ingest.service';
import { BookBucketRepository } from './book-bucket.repository';
import { BookBucketGateway } from './book-bucket.gateway';

type EventType = 'delete' | 'create';

const DEBOUNCE_MS = 500;
const COVERS_DIR = 'covers';

@Injectable()
export class BookBucketWatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BookBucketWatcherService.name);
  private readonly bookBucketPath: string;
  private subscription: AsyncSubscription | null = null;
  private readonly pendingTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; type: EventType }>();

  constructor(
    private readonly config: ConfigService,
    private readonly ingestService: BookBucketIngestService,
    private readonly repo: BookBucketRepository,
    private readonly gateway: BookBucketGateway,
  ) {
    const appDataPath = this.config.get<string>('storage.appDataPath')!;
    this.bookBucketPath = join(appDataPath, 'book-bucket');
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.startWatcher();
    this.rescan().catch((err) => this.logger.warn(`Initial Book Bucket rescan failed: ${(err as Error).message}`));
  }

  async onModuleDestroy(): Promise<void> {
    for (const entry of this.pendingTimers.values()) clearTimeout(entry.timer);
    this.pendingTimers.clear();
    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  async rescan(): Promise<void> {
    await this.walkAndIngest(this.bookBucketPath);
    await this.emitSummary();
  }

  private async startWatcher(): Promise<void> {
    try {
      const { mkdir } = await import('fs/promises');
      await mkdir(this.bookBucketPath, { recursive: true });

      const { subscribe } = await import('@parcel/watcher');
      this.subscription = await subscribe(this.bookBucketPath, (err, events) => {
        if (err) {
          this.logger.warn(`Book Bucket watcher error: ${err.message}`);
          return;
        }
        for (const event of events) {
          if (event.type === 'delete' || event.type === 'create') {
            if (this.isInCoversDir(event.path)) continue;
            this.schedule(event.type, event.path);
          }
        }
      });
      this.logger.log(`Watching Book Bucket folder: ${this.bookBucketPath}`);
    } catch (err) {
      this.logger.warn(`Failed to start Book Bucket watcher: ${(err as Error).message}`);
    }
  }

  private isInCoversDir(path: string): boolean {
    const rel = path.substring(this.bookBucketPath.length + 1);
    return rel.startsWith(COVERS_DIR + '/') || rel === COVERS_DIR;
  }

  private schedule(type: EventType, path: string): void {
    const existing = this.pendingTimers.get(path);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pendingTimers.delete(path);
      this.process(type, path).catch((err) => this.logger.error(`Failed to process ${type} for ${path}: ${(err as Error).message}`));
    }, DEBOUNCE_MS);
    this.pendingTimers.set(path, { timer, type });
  }

  private async process(type: EventType, path: string): Promise<void> {
    if (type === 'create') {
      if (!isPrimaryFormat(path)) return;
      await waitForStability(path);
      const id = await this.ingestService.ingestFromWatchedFolder(path);
      if (id !== null) await this.emitSummary();
    } else {
      const row = await this.repo.findByAbsolutePath(path);
      if (row) {
        if (row.coverPath) {
          await safeUnlink(row.coverPath);
          await safeUnlink(row.coverPath.replace(/\.\w+$/, '_thumb.jpg'));
        }
        await this.repo.deleteById(row.id);
      }
      await this.emitSummary();
    }
  }

  private async walkAndIngest(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === COVERS_DIR && dir === this.bookBucketPath) continue;
        await this.walkAndIngest(full);
      } else if (entry.isFile() && isPrimaryFormat(full)) {
        await this.ingestService.ingestFromWatchedFolder(full);
      }
    }
  }

  private async emitSummary(): Promise<void> {
    const summary = await this.repo.countsByStatus();
    this.gateway.emitSummary(summary);
  }
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // file may already be deleted
  }
}
