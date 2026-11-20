import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { watch, type FSWatcher } from 'chokidar';
import { Dirent } from 'fs';
import { mkdir, readdir, realpath, stat, unlink } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';

import { waitForStability } from '../../common/utils/fs-stability.utils';
import { normalizeWatchEvent, waitForWatcherReady, type WatchEventType as EventType } from '../../common/utils/fs-watch.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { isPrimaryFormat } from '../scanner/lib/classify';
import { BookDockIngestService, type BookDockArrival } from './book-dock-ingest.service';
import { isIgnoredDockEntryName, isIgnoredDockPath } from './book-dock-ignored-entries';
import { BookDockRepository } from './book-dock.repository';
import { BookDockGateway } from './book-dock.gateway';
import { BookDockProcessingStateService } from './book-dock-processing-state.service';
import { LibraryDockRegistry } from './library-dock-registry.service';
import { BookDockKeptFilesService } from './book-dock-kept-files.service';
import { classifyDockPath, LEGACY_COVERS_DIR, unitDirectoryOf, type DockPathInfo } from './library-dock-paths';

const DEBOUNCE_MS = 500;

/** Where a path's files go: Unsorted, or a library dock that is turned on. */
interface DockTarget {
  dockRoot: string;
  /** Path segments below `dockRoot`. */
  relParts: string[];
  arrival?: BookDockArrival;
}

@Injectable()
export class BookDockWatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BookDockWatcherService.name);
  private bookDockPath: string;
  private subscription: FSWatcher | null = null;
  private scanPromise: Promise<void> | null = null;
  private stopping = false;
  private readonly pendingScans = new Set<string>();
  private readonly pendingTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; type: EventType }>();
  /** Paths the dock is moving itself. Events under them are dropped until the move is recorded. */
  private readonly heldPaths = new Set<string>();
  /** Whether a `_libraries` folder is really an old dropped book. Cleared at the start of every scan pass. */
  private readonly legacyLibrariesBook = new Map<string, boolean>();
  private legacyLibrariesWarned = false;

  constructor(
    private readonly config: ConfigService,
    private readonly ingestService: BookDockIngestService,
    private readonly repo: BookDockRepository,
    private readonly gateway: BookDockGateway,
    private readonly processingState: BookDockProcessingStateService,
    private readonly dockRegistry: LibraryDockRegistry,
    private readonly keptFiles: BookDockKeptFilesService,
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

  /** Discovers what sits in one folder of the dock, the way a rescan would. */
  async scanFolder(path: string): Promise<void> {
    if (await this.processingState.isPaused()) return;
    await this.scan(path);
    this.emitChange();
  }

  /**
   * Ignores events under these paths until the returned release is called. Used while the dock
   * moves files itself and updates their rows, so the old paths do not read as deleted files and
   * the new ones as fresh arrivals. Callers scan the new location once they release.
   */
  holdPaths(paths: string[]): () => void {
    const held = paths.map((path) => resolve(path)).filter((path) => !this.heldPaths.has(path));
    for (const path of held) this.heldPaths.add(path);
    for (const [key, entry] of this.pendingTimers) {
      if (!this.isHeld(key)) continue;
      clearTimeout(entry.timer);
      this.pendingTimers.delete(key);
    }
    return () => {
      for (const path of held) this.heldPaths.delete(path);
    };
  }

  async rescan(): Promise<void> {
    if (await this.processingState.isPaused()) {
      this.emitChange();
      return;
    }
    await this.scan(this.bookDockPath);
    // Kept files whose deletion the watcher missed, while the server was down or not watching.
    await this.keptFiles.prune();
    this.emitChange();
  }

  private async startWatcher(): Promise<void> {
    try {
      await mkdir(this.bookDockPath, { recursive: true });
      this.bookDockPath = await realpath(this.bookDockPath);

      const root = this.bookDockPath;
      this.subscription = watch(root, { ignoreInitial: true, followSymlinks: false, ignored: (path) => isIgnoredDockPath(root, path) });
      this.subscription.on('all', (eventName, eventPath) => {
        const type = normalizeWatchEvent(eventName);
        if (!type || classifyDockPath(root, eventPath).area === 'reserved') return;
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

  /**
   * Debounced on the **unit directory** rather than on the file, because a dropped folder fires one
   * `add` per file inside it. Keyed per file, a 31-track folder produced 31 timers and the first
   * one interpreted the directory 500 ms after the first track landed; the claim check then
   * silently dropped the other thirty events. One key means the timer resets on every arrival and
   * fires once, after the last one.
   */
  private schedule(type: EventType, path: string): void {
    if (this.stopping || this.isHeld(path)) return;
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
      if (isIgnoredDockPath(this.bookDockPath, path)) return;
      if (await this.processingState.isPaused()) return;

      const info = await this.classify(path);
      if (info.area === 'libraries') {
        await this.scan(path);
        return;
      }
      const target = await this.resolveTarget(info);
      if (!target) {
        // A folder no dock owns, a dock that is off, or a loose file in `_libraries`: no rows, but
        // what managers are shown about `_libraries` may have changed.
        if (info.area === 'dock') this.emitChange();
        return;
      }
      if (target.relParts.length === 0) {
        // A dock folder appeared whole: turned on, renamed into place or restored.
        await this.scan(target.dockRoot);
        return;
      }

      const unitDirectory = unitDirectoryOf(info) ?? (target.relParts.length === 1 && (await isDirectory(path)) ? path : null);
      if (unitDirectory !== null) {
        await this.scan(unitDirectory);
        return;
      }

      if (!(await this.isSafePath(path))) return;
      if (!isPrimaryFormat(path)) return;
      await waitForStability(path);
      if (await this.processingState.isPaused()) return;
      const id = await this.ingestService.ingestFromWatchedFolder(path, target.arrival);
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
      await this.keptFiles.forget(path);
      this.emitChange();
    }
  }

  private isHeld(path: string): boolean {
    for (const held of this.heldPaths) {
      if (path === held || path.startsWith(held + sep)) return true;
    }
    return false;
  }

  /** Coalesce events from a dropped tree, including all tracks of a multipart book. */
  private unitDirectoryFor(path: string): string | null {
    return unitDirectoryOf(classifyDockPath(this.bookDockPath, path));
  }

  /**
   * Where a path sits, except that a `_libraries` folder some earlier version took in as a dropped
   * book stays that book: it is never adopted as the home of library docks.
   */
  private async classify(path: string): Promise<DockPathInfo> {
    const info = classifyDockPath(this.bookDockPath, path);
    if (info.area !== 'libraries' && info.area !== 'dock') return info;
    const librariesPath = info.area === 'libraries' ? info.path : dirname(info.dockRoot);
    if (!(await this.isLegacyLibrariesBook(librariesPath))) return info;
    return { area: 'unsorted', dockRoot: this.bookDockPath, relParts: path.substring(this.bookDockPath.length + 1).split(sep) };
  }

  private async isLegacyLibrariesBook(librariesPath: string): Promise<boolean> {
    const known = this.legacyLibrariesBook.get(librariesPath);
    if (known !== undefined) return known;
    const legacy = (await this.repo.findByUnitDirectory(librariesPath)) !== undefined;
    this.legacyLibrariesBook.set(librariesPath, legacy);
    if (legacy && !this.legacyLibrariesWarned) {
      this.legacyLibrariesWarned = true;
      this.logger.warn(
        `[book_dock.dock_scan] [fail] path="${sanitizeLogValue(librariesPath)}" errorClass=LegacyLibrariesFolder error="folder is a dropped book" - library docks are off until it is filed or moved`,
      );
    }
    return legacy;
  }

  /**
   * The dock a path is processed for. Null for reserved folders, folders no dock owns, docks that
   * are off and loose files in `_libraries`, none of which create rows.
   */
  private async resolveTarget(info: DockPathInfo): Promise<DockTarget | null> {
    if (info.area === 'unsorted') return { dockRoot: info.dockRoot, relParts: info.relParts };
    if (info.area !== 'dock') return null;
    const dock = await this.dockRegistry.findEnabledByFolderName(info.folderName);
    if (!dock) return null;
    return {
      dockRoot: info.dockRoot,
      relParts: info.relParts,
      arrival: { dockId: dock.id, libraryId: dock.libraryId, folderId: dock.targetFolderId },
    };
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
    this.legacyLibrariesBook.clear();
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

  /** Walks a folder and ingests what it finds. Returns how many rows it created. */
  private async walkAndIngest(dir: string, skipIngest = false): Promise<number> {
    if (this.stopping || (await this.processingState.isPaused())) return 0;
    if (!(await this.isSafePath(dir))) return 0;

    let target: DockTarget | null = { dockRoot: this.bookDockPath, relParts: [] };
    if (dir !== this.bookDockPath) {
      const info = await this.classify(dir);
      if (info.area === 'libraries') return this.walkLibraries(dir);
      target = await this.resolveTarget(info);
    }
    if (!target) return 0;

    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return 0;
    }

    let created = 0;
    let consumedDirectories = new Set<string>();
    if (dir !== target.dockRoot) {
      // Request imports claim their destination before copying files. Watched book rows only
      // own their recorded files and must not hide later siblings or nested books.
      if ((await this.repo.findByUnitDirectory(dir))?.autoFinalizeSuppressed) return 0;
      if (!skipIngest) {
        const result = await this.ingestService.ingestUnitDirectory(dir, target.arrival);
        consumedDirectories = result.consumedDirectories;
        created += result.created;
        if (result.created > 0) this.emitChange();
      }
      if ((await this.repo.findByUnitDirectory(dir))?.autoFinalizeSuppressed) return created;
    }

    for (const entry of entries) {
      if (this.stopping || (await this.processingState.isPaused())) return created;
      if (isIgnoredDockEntryName(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === LEGACY_COVERS_DIR && dir === this.bookDockPath) continue;
        created += await this.walkAndIngest(full, consumedDirectories.has(full));
      } else if (dir === target.dockRoot && entry.isFile() && isPrimaryFormat(full)) {
        if ((await this.ingestService.ingestFromWatchedFolder(full, target.arrival)) !== null) created++;
      }
    }
    return created;
  }

  /**
   * Scans each folder in `_libraries` that belongs to a dock that is turned on. Folders no dock owns
   * and loose files are left alone: managers see them on the settings page.
   */
  private async walkLibraries(dir: string): Promise<number> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    let created = 0;
    for (const entry of entries) {
      if (this.stopping || (await this.processingState.isPaused())) return created;
      if (!entry.isDirectory() || isIgnoredDockEntryName(entry.name)) continue;
      const dock = await this.dockRegistry.findEnabledByFolderName(entry.name);
      if (!dock) continue;
      const startedAt = Date.now();
      const folder = sanitizeLogValue(entry.name);
      this.logger.log(`[book_dock.dock_scan] [start] dockId=${dock.id} libraryId=${dock.libraryId} folder="${folder}" - scanning library dock`);
      try {
        const found = await this.walkAndIngest(join(dir, entry.name));
        created += found;
        this.logger.log(
          `[book_dock.dock_scan] [end] dockId=${dock.id} libraryId=${dock.libraryId} folder="${folder}" created=${found} durationMs=${Date.now() - startedAt} - library dock scanned`,
        );
      } catch (err) {
        this.logger.warn(
          `[book_dock.dock_scan] [fail] dockId=${dock.id} libraryId=${dock.libraryId} folder="${folder}" durationMs=${Date.now() - startedAt} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - library dock scan failed`,
        );
      }
    }
    return created;
  }

  private emitChange(): void {
    this.gateway.emitChanged();
  }
}

function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // file may already be deleted
  }
}
