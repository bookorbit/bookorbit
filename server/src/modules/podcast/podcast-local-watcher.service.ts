import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { watch, type FSWatcher } from 'chokidar';
import { realpath } from 'fs/promises';
import { join, relative, sep } from 'path';

import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';
import { normalizeWatchEvent, waitForWatcherReady } from '../../common/utils/fs-watch.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { PodcastLocalShowImportService } from './podcast-local-show-import.service';
import { PodcastCatalogRepository } from './podcast-catalog.repository';

const SYNC_DEBOUNCE_MS = 2_000;
/** How long to wait before re-checking a folder whose show already had an import running. */
const DEFERRED_RETRY_MS = 30_000;
/** How long a library whose watcher failed to start rests before reconcile retries it. */
const FAILED_START_RETRY_MS = 15 * 60_000;
const WATCH_DEPTH = 2;

/** What a settled filesystem event makes the watcher do: adopt what appeared, or flag what left. */
type WatchAction = 'sync' | 'check';

/**
 * Watches the local roots of every enabled podcast library and keeps the shows under them in sync
 * with the folders on disk. Only those roots are watched: the downloads root belongs to BookOrbit,
 * where a file appearing is its own work landing rather than anything a watcher should act on.
 *
 * The service is driven entirely by the worker's `reconcile` sweep rather than by library
 * lifecycle hooks, so the podcast and library modules stay decoupled: a created, repointed, or
 * deleted library is picked up on the next sweep. Watching is best-effort infrastructure; the
 * periodic discovery pass covers a library this service cannot watch, and re-checks every library
 * anyway for changes filesystem events cannot see, such as writes to a network mount from another
 * machine.
 */
@Injectable()
export class PodcastLocalWatcherService implements OnModuleDestroy {
  private readonly logger = new Logger(PodcastLocalWatcherService.name);
  private readonly watchers = new Map<number, FSWatcher[]>();
  private readonly watchedRoots = new Map<number, string>();
  private readonly failedStarts = new Map<number, number>();
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly catalog: PodcastCatalogRepository,
    private readonly imports: PodcastLocalShowImportService,
    private readonly selfWrites: SelfWriteRegistry,
  ) {}

  async onModuleDestroy(): Promise<void> {
    for (const timer of this.pendingTimers.values()) clearTimeout(timer);
    this.pendingTimers.clear();
    for (const watchers of this.watchers.values()) {
      for (const watcher of watchers) await watcher.close().catch(() => undefined);
    }
    this.watchers.clear();
    this.watchedRoots.clear();
  }

  /**
   * Brings the running watchers in line with the current set of podcast libraries: stops watchers
   * whose library is gone, starts the missing ones, and restarts a library whose local roots
   * changed. A newly watched library also gets a one-off discovery pass so folders that existed
   * before the watcher did are not left waiting for the next scheduled sweep.
   */
  async reconcile(libraryIds: number[]): Promise<void> {
    const current = new Set(libraryIds);
    for (const libraryId of [...this.watchers.keys()]) {
      if (!current.has(libraryId)) await this.stopWatchers(libraryId);
    }
    for (const libraryId of libraryIds) {
      const localRoots = await this.catalog.findLocalLibraryFolders(libraryId);
      if (localRoots.length === 0) {
        await this.stopWatchers(libraryId);
        continue;
      }
      const signature = localRoots.join('\n');
      if (this.watchers.has(libraryId) && this.watchedRoots.get(libraryId) === signature) continue;
      const failedAt = this.failedStarts.get(libraryId);
      if (!this.watchers.has(libraryId) && failedAt && Date.now() - failedAt < FAILED_START_RETRY_MS) continue;
      if (await this.startWatchers(libraryId, localRoots, signature)) {
        this.imports.runLocalShowDiscovery(libraryId).catch((error: unknown) => {
          this.logger.warn(
            `[podcast.local_discovery] [fail] libraryId=${libraryId} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - local show discovery failed`,
          );
        });
      }
    }
  }

  /**
   * Never throws: a root that cannot be watched is logged and left to the periodic pass. A library
   * counts as watched once any of its roots is, so one unreachable mount does not cost the rest.
   */
  private async startWatchers(libraryId: number, localRoots: string[], signature: string): Promise<boolean> {
    const event = 'podcast.watcher.start';
    await this.stopWatchers(libraryId);
    const started: FSWatcher[] = [];
    for (const rootPath of localRoots) {
      let subscription: FSWatcher | null = null;
      try {
        const watchedRoot = await realpath(rootPath);
        subscription = watch(watchedRoot, { ignoreInitial: true, depth: WATCH_DEPTH });
        subscription.on('all', (eventName, eventPath) => {
          const type = normalizeWatchEvent(eventName);
          if (!type) return;
          // A sidecar BookOrbit is writing back is its own work landing, not a change to react to.
          if (this.selfWrites.isSuppressed(eventPath)) return;
          const showFolder = resolveShowFolderPath(watchedRoot, eventPath);
          if (showFolder) this.schedule(libraryId, showFolder, type === 'create' ? 'sync' : 'check');
        });
        subscription.on('error', (err) => {
          const error = err instanceof Error ? err : new Error(String(err));
          this.logger.warn(
            `[${event}] [fail] libraryId=${libraryId} errorClass=${error.name} error="${sanitizeLogValue(error.message)}" - watcher callback error`,
          );
        });
        await waitForWatcherReady(subscription);
        started.push(subscription);
        this.logger.log(`[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(watchedRoot)}" - podcast local folder watched`);
      } catch (error) {
        if (subscription) await subscription.close().catch(() => undefined);
        this.logger.warn(
          `[${event}] [fail] libraryId=${libraryId} path="${sanitizeLogValue(rootPath)}" errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - podcast local watcher could not start`,
        );
      }
    }
    if (started.length === 0) {
      this.failedStarts.set(libraryId, Date.now());
      return false;
    }
    this.watchers.set(libraryId, started);
    this.watchedRoots.set(libraryId, signature);
    this.failedStarts.delete(libraryId);
    return true;
  }

  private async stopWatchers(libraryId: number): Promise<void> {
    const prefix = `${libraryId}:`;
    for (const [key, timer] of this.pendingTimers) {
      if (key.startsWith(prefix)) {
        clearTimeout(timer);
        this.pendingTimers.delete(key);
      }
    }
    this.watchedRoots.delete(libraryId);
    const watchers = this.watchers.get(libraryId);
    if (!watchers) return;
    this.watchers.delete(libraryId);
    for (const watcher of watchers) await watcher.close().catch(() => undefined);
  }

  /**
   * One pending action per show folder, so a burst over the same folder settles into a single run.
   * The latest event decides what that run does: a rename arrives as a delete and a create, and
   * whichever lands last is the state the folder actually ended up in.
   */
  private schedule(libraryId: number, showFolder: string, action: WatchAction, delayMs = SYNC_DEBOUNCE_MS): void {
    const key = `${libraryId}:${showFolder}`;
    const existing = this.pendingTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pendingTimers.delete(key);
      void (action === 'sync' ? this.syncNow(libraryId, showFolder) : this.checkMissingNow(libraryId, showFolder));
    }, delayMs);
    this.pendingTimers.set(key, timer);
  }

  private async checkMissingNow(libraryId: number, showFolder: string): Promise<void> {
    if (!this.watchers.has(libraryId)) return;
    try {
      await this.imports.markLocalShowMissingIfGone(libraryId, showFolder);
    } catch (error) {
      this.logger.warn(
        `[podcast.watcher.missing] [fail] libraryId=${libraryId} folder="${sanitizeLogValue(showFolder)}" errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - local show missing check failed`,
      );
    }
  }

  private async syncNow(libraryId: number, showFolder: string): Promise<void> {
    if (!this.watchers.has(libraryId)) return;
    try {
      const result = await this.imports.syncLocalShowFolder(libraryId, showFolder);
      // An import for this show was already running, so what this event announced may not have
      // been on disk when that run listed the folder. Re-check until a slot is free.
      if (result.outcome === 'deferred') this.schedule(libraryId, showFolder, 'sync', DEFERRED_RETRY_MS);
    } catch (error) {
      this.logger.warn(
        `[podcast.watcher.sync] [fail] libraryId=${libraryId} folder="${sanitizeLogValue(showFolder)}" errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - local show sync failed`,
      );
    }
  }
}

/** The top-level folder of a local root an event belongs to, or null for the root itself. */
function resolveShowFolderPath(watchedRoot: string, eventPath: string): string | null {
  const relativePath = relative(watchedRoot, eventPath);
  if (!relativePath || relativePath === '.' || relativePath.startsWith('..')) return null;
  const [first] = relativePath.split(sep);
  return first ? join(watchedRoot, first) : null;
}
