import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Dirent } from 'fs';
import { readdir, unlink } from 'fs/promises';
import { join } from 'path';
import type { AsyncSubscription } from '@parcel/watcher';

import { isPrimaryFormat } from '../scanner/lib/classify';
import { waitForStability } from '../scanner/lib/stability';
import { BookDockIngestService } from './book-dock-ingest.service';
import { BookDockRepository } from './book-dock.repository';
import { BookDockGateway } from './book-dock.gateway';

type EventType = 'delete' | 'create';

const DEBOUNCE_MS = 500;
const COVERS_DIR = 'covers';

@Injectable()
export class BookDockWatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BookDockWatcherService.name);
  private readonly bookDockPath: string;
  private subscription: AsyncSubscription | null = null;
  private readonly pendingTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; type: EventType }>();

  constructor(
    private readonly config: ConfigService,
    private readonly ingestService: BookDockIngestService,
    private readonly repo: BookDockRepository,
    private readonly gateway: BookDockGateway,
  ) {
    const appDataPath = this.config.get<string>('storage.appDataPath')!;
    this.bookDockPath = join(appDataPath, 'book-dock');
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.startWatcher();
    this.rescan().catch((err) => this.logger.warn(`Initial Book Dock rescan failed: ${(err as Error).message}`));
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
    await this.walkAndIngest(this.bookDockPath);
    await this.emitSummary();
  }

  private async startWatcher(): Promise<void> {
    try {
      const { mkdir } = await import('fs/promises');
      await mkdir(this.bookDockPath, { recursive: true });

      const { subscribe } = await import('@parcel/watcher');
      this.subscription = await subscribe(this.bookDockPath, (err, events) => {
        if (err) {
          this.logger.warn(`Book Dock watcher error: ${err.message}`);
          return;
        }
        for (const event of events) {
          if (event.type === 'delete' || event.type === 'create') {
            if (this.isInCoversDir(event.path)) continue;
            this.schedule(event.type, event.path);
          }
        }
      });
      this.logger.log(`Watching Book Dock folder: ${this.bookDockPath}`);
    } catch (err) {
      this.logger.warn(`Failed to start Book Dock watcher: ${(err as Error).message}`);
    }
  }

  private isInCoversDir(path: string): boolean {
    const rel = path.substring(this.bookDockPath.length + 1);
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
        if (entry.name === COVERS_DIR && dir === this.bookDockPath) continue;
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
