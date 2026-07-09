import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { watch, type FSWatcher } from 'chokidar';
import { Dirent } from 'fs';
import { mkdir, readdir, realpath, unlink } from 'fs/promises';
import { join } from 'path';

import { isPrimaryFormat } from '../scanner/lib/classify';
import { waitForStability } from '../scanner/lib/stability';
import { BookDockIngestService } from './book-dock-ingest.service';
import { BookDockRepository } from './book-dock.repository';
import { BookDockGateway } from './book-dock.gateway';
import { BookDockProcessingStateService } from './book-dock-processing-state.service';

type EventType = 'delete' | 'create';

const DEBOUNCE_MS = 500;
const COVERS_DIR = 'covers';

@Injectable()
export class BookDockWatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BookDockWatcherService.name);
  private bookDockPath: string;
  private subscription: FSWatcher | null = null;
  private readonly pendingTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; type: EventType }>();

  constructor(
    private readonly config: ConfigService,
    private readonly ingestService: BookDockIngestService,
    private readonly repo: BookDockRepository,
    private readonly gateway: BookDockGateway,
    private readonly processingState: BookDockProcessingStateService,
  ) {
    const appDataPath = this.config.get<string>('storage.appDataPath') ?? '/data';
    this.bookDockPath = this.config.get<string>('storage.bookDockPath') ?? join(appDataPath, 'book-dock');
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.startWatcher();
    this.rescan().catch((err) => this.logger.warn(`Initial Book Dock rescan failed: ${(err as Error).message}`));
  }

  async onModuleDestroy(): Promise<void> {
    for (const entry of this.pendingTimers.values()) clearTimeout(entry.timer);
    this.pendingTimers.clear();
    if (this.subscription) {
      await this.subscription.close();
      this.subscription = null;
    }
  }

  async rescan(): Promise<void> {
    if (await this.processingState.isPaused()) {
      await this.emitSummary();
      return;
    }
    await this.walkAndIngest(this.bookDockPath);
    await this.emitSummary();
  }

  private async startWatcher(): Promise<void> {
    try {
      await mkdir(this.bookDockPath, { recursive: true });
      this.bookDockPath = await realpath(this.bookDockPath);

      this.subscription = watch(this.bookDockPath, { ignoreInitial: true });
      this.subscription.on('all', (eventName, eventPath) => {
        const type = normalizeWatchEvent(eventName);
        if (!type || this.isInCoversDir(eventPath)) return;
        this.schedule(type, eventPath);
      });
      this.subscription.on('error', (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(`Book Dock watcher error: ${error.message}`);
      });
      await waitForWatcherReady(this.subscription);
      this.logger.log(`Watching Book Dock folder: ${this.bookDockPath}`);
    } catch (err) {
      if (this.subscription) {
        try {
          await this.subscription.close();
        } catch {
          // best-effort cleanup after a failed watcher startup
        }
        this.subscription = null;
      }
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
      if (await this.processingState.isPaused()) return;
      if (!isPrimaryFormat(path)) return;
      await waitForStability(path);
      if (await this.processingState.isPaused()) return;
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
    if (await this.processingState.isPaused()) return;

    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (await this.processingState.isPaused()) return;
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
    const paused = await this.processingState.isPaused();
    this.gateway.emitSummary({ ...summary, paused });
  }
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // file may already be deleted
  }
}

function normalizeWatchEvent(eventName: string): EventType | null {
  if (eventName === 'unlink' || eventName === 'unlinkDir') return 'delete';
  if (eventName === 'add' || eventName === 'addDir' || eventName === 'change') return 'create';
  return null;
}

function waitForWatcherReady(watcher: FSWatcher): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleReady = () => {
      watcher.off('error', handleError);
      resolve();
    };
    const handleError = (error: unknown) => {
      watcher.off('ready', handleReady);
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    watcher.once('ready', handleReady);
    watcher.once('error', handleError);
  });
}
