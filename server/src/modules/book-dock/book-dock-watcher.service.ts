import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { watch, type FSWatcher } from 'chokidar';
import { Dirent } from 'fs';
import { mkdir, readdir, realpath, stat, unlink } from 'fs/promises';
import { join, resolve, sep } from 'path';

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
  private scanPromise: Promise<void> | null = null;
  private stopping = false;
  private readonly pendingScans = new Set<string>();
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
    this.stopping = true;
    for (const entry of this.pendingTimers.values()) clearTimeout(entry.timer);
    this.pendingTimers.clear();
    this.pendingScans.clear();
    if (this.subscription) {
      await this.subscription.close();
      this.subscription = null;
    }
    try {
      await this.scanPromise;
    } finally {
      this.stopping = false;
    }
  }

  async rescan(): Promise<void> {
    if (await this.processingState.isPaused()) {
      this.emitChange();
      return;
    }
    await this.scan(this.bookDockPath);
    this.emitChange();
  }

  private async startWatcher(): Promise<void> {
    try {
      await mkdir(this.bookDockPath, { recursive: true });
      this.bookDockPath = await realpath(this.bookDockPath);

      this.subscription = watch(this.bookDockPath, { ignoreInitial: true, followSymlinks: false });
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
    if (this.stopping) return;
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

      const unitDirectory = this.unitDirectoryFor(path) ?? ((await this.isUnitDirectory(path)) ? path : null);
      if (unitDirectory !== null) {
        await this.scan(unitDirectory);
        return;
      }

      if (!(await this.isSafePath(path))) return;
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

  /** Coalesce events from a dropped tree, including all tracks of a multipart book. */
  private unitDirectoryFor(path: string): string | null {
    if (!path.startsWith(this.bookDockPath + sep)) return null;
    const [first, ...rest] = path.substring(this.bookDockPath.length + 1).split(sep);
    if (!first || rest.length === 0) return null;
    if (first === COVERS_DIR) return null;
    return join(this.bookDockPath, first);
  }

  private scan(dir: string): Promise<void> {
    if (this.stopping) return Promise.resolve();
    // A rescan and a watcher event may discover the same files. Serialize discovery and retain
    // arrivals during an active scan for one more pass, rather than racing their inserts.
    if (![...this.pendingScans].some((pending) => dir === pending || dir.startsWith(pending + sep))) {
      for (const pending of this.pendingScans) {
        if (pending.startsWith(dir + sep)) this.pendingScans.delete(pending);
      }
      this.pendingScans.add(dir);
    }
    if (!this.scanPromise) {
      this.scanPromise = this.drainScans().finally(() => {
        this.scanPromise = null;
      });
    }
    return this.scanPromise;
  }

  private async drainScans(): Promise<void> {
    while (!this.stopping && this.pendingScans.size > 0) {
      const dir = this.pendingScans.values().next().value!;
      this.pendingScans.delete(dir);
      await this.walkAndIngest(dir);
    }
  }

  private async isSafePath(path: string): Promise<boolean> {
    const normalized = resolve(path);
    if (normalized !== this.bookDockPath && !normalized.startsWith(this.bookDockPath + sep)) return false;
    // The root is canonicalized at startup. Reject symlinks in any descendant component.
    return realpath(path).then(
      (canonical) => canonical === normalized,
      () => false,
    );
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

  private async walkAndIngest(dir: string, skipIngest = false): Promise<void> {
    if (this.stopping || (await this.processingState.isPaused())) return;
    if (!(await this.isSafePath(dir))) return;

    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    let consumedDirectories = new Set<string>();
    if (dir !== this.bookDockPath) {
      // Request imports claim their destination before copying files. Watched book rows only
      // own their recorded files and must not hide later siblings or nested books.
      if ((await this.repo.findByUnitDirectory(dir))?.autoFinalizeSuppressed) return;
      if (!skipIngest) {
        const result = await this.ingestService.ingestUnitDirectory(dir);
        consumedDirectories = result.consumedDirectories;
        if (result.created > 0) this.emitChange();
      }
      if ((await this.repo.findByUnitDirectory(dir))?.autoFinalizeSuppressed) return;
    }

    for (const entry of entries) {
      if (this.stopping || (await this.processingState.isPaused())) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === COVERS_DIR && dir === this.bookDockPath) continue;
        await this.walkAndIngest(full, consumedDirectories.has(full));
      } else if (dir === this.bookDockPath && entry.isFile() && isPrimaryFormat(full)) {
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
