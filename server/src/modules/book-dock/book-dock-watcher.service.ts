import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { watch, type FSWatcher } from 'chokidar';
import { Dirent } from 'fs';
import { mkdir, readdir, realpath, stat, unlink } from 'fs/promises';
import { join, sep } from 'path';

import { isPrimaryFormat } from '../scanner/lib/classify';
import { waitForDirectoryStability, waitForStability } from '../scanner/lib/stability';
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
      this.emitChange();
      return;
    }
    await this.walkAndIngest(this.bookDockPath);
    this.emitChange();
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

  /**
   * Debounced on the **unit directory** rather than on the file, because a dropped folder fires one
   * `add` per file inside it. Keyed per file, a 31-track folder produced 31 timers and the first
   * one interpreted the directory 500 ms after the first track landed; the claim check then
   * silently dropped the other thirty events. One key means the timer resets on every arrival and
   * fires once, after the last one.
   */
  private schedule(type: EventType, path: string): void {
    const key = (type === 'create' ? this.unitDirectoryFor(path) : null) ?? path;
    const existing = this.pendingTimers.get(key);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pendingTimers.delete(key);
      this.process(type, key).catch((err) => this.logger.error(`Failed to process ${type} for ${key}: ${(err as Error).message}`));
    }, DEBOUNCE_MS);
    this.pendingTimers.set(key, { timer, type });
  }

  private async process(type: EventType, path: string): Promise<void> {
    if (type === 'create') {
      if (await this.processingState.isPaused()) return;

      // A directory below the dock root is a unit, and a unit is ingested whole rather than as a
      // stream of loose files. `schedule` has already collapsed a file event onto its unit
      // directory, so what arrives here for a dropped folder is the folder itself.
      const unitDirectory = this.unitDirectoryFor(path) ?? ((await this.isUnitDirectory(path)) ? path : null);
      if (unitDirectory !== null) {
        await this.ingestUnitDirectory(unitDirectory);
        return;
      }

      if (!isPrimaryFormat(path)) return;
      await waitForStability(path);
      if (await this.processingState.isPaused()) return;
      const id = await this.ingestService.ingestFromWatchedFolder(path);
      if (id !== null) this.emitChange();
    } else {
      const row = await this.repo.findByAbsolutePath(path);
      if (row) {
        if (row.coverPath) {
          await safeUnlink(row.coverPath);
          await safeUnlink(row.coverPath.replace(/\.\w+$/, '_thumb.jpg'));
        }
        await this.repo.deleteById(row.id);
      }
      this.emitChange();
    }
  }

  /**
   * The directory one level below the dock root that owns this path, or null when the path is a
   * loose file sitting at the root.
   *
   * Units are always exactly one level down, which is what keeps this an equality lookup on a
   * unique column rather than an ancestor walk over an unbounded path.
   */
  private unitDirectoryFor(path: string): string | null {
    if (!path.startsWith(this.bookDockPath + sep)) return null;
    const [first, ...rest] = path.substring(this.bookDockPath.length + 1).split(sep);
    if (!first || rest.length === 0) return null;
    if (first === COVERS_DIR) return null;
    return join(this.bookDockPath, first);
  }

  /**
   * Ingests a dropped folder as one or more units. Before this, `walkAndIngest` created an
   * independent row per file, so a 31-track audiobook became 31 books whose destinations were each
   * resolved from their own chapter-named ID3 tags. No error, just quietly wrong.
   */
  private async ingestUnitDirectory(unitDirectory: string): Promise<void> {
    // Claimed means the importer created the row before the directory existed, precisely so this
    // check cannot lose the race to chokidar's first event.
    if (await this.repo.findByUnitDirectory(unitDirectory)) return;
    if (await this.processingState.isPaused()) return;

    // A folder still being copied is a folder that is not yet a book. Interpreting it now reads a
    // partial snapshot, and the row it creates then claims the directory so the tracks that arrive
    // afterwards are never looked at again.
    await waitForDirectoryStability(unitDirectory);

    // Re-checked because the wait is long enough for the importer to have claimed the directory,
    // or for an operator to have paused processing, in the meantime.
    if (await this.repo.findByUnitDirectory(unitDirectory)) return;
    if (await this.processingState.isPaused()) return;

    const created = await this.ingestService.ingestUnitDirectory(unitDirectory);
    if (created > 0) this.emitChange();
  }

  /** A path one level below the dock root that is a directory, i.e. an `addDir` for a unit. */
  private async isUnitDirectory(path: string): Promise<boolean> {
    if (!path.startsWith(this.bookDockPath + sep)) return false;
    const rest = path.substring(this.bookDockPath.length + 1);
    if (rest.length === 0 || rest.includes(sep) || rest === COVERS_DIR) return false;
    return stat(path).then(
      (info) => info.isDirectory(),
      () => false,
    );
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
        await this.ingestUnitDirectory(full);
      } else if (entry.isFile() && isPrimaryFormat(full)) {
        await this.ingestService.ingestFromWatchedFolder(full);
      }
    }
  }

  private emitChange(): void {
    this.gateway.emitChanged();
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
