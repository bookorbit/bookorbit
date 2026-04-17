import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { stat } from 'fs/promises';
import { dirname, sep } from 'path';
import type { AsyncSubscription } from '@parcel/watcher';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { libraries, libraryFolders } from '../../db/schema';
import { ScanGateway } from './scan.gateway';
import { ScannerService } from './scanner.service';
import { FileEventProcessorService, type FileEventResult } from './file-event-processor.service';
import { classifyFile } from './lib/classify';

type Db = NodePgDatabase<typeof schema>;
type EventType = 'delete' | 'create';

export const WATCHER_DEBOUNCE_MS = 500;
const DEBOUNCE_MS = WATCHER_DEBOUNCE_MS;
const SCAN_DEBOUNCE_MS = 3_000;
const DIR_CREATE_SUPPRESS_MS = 6_000;
const CROSS_LIBRARY_RESCAN_DEBOUNCE_MS = 1_500;
const RECONCILE_MS = 30 * 60 * 1_000;

@Injectable()
export class FileWatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FileWatcherService.name);
  private readonly subscriptions = new Map<number, AsyncSubscription[]>();
  private readonly watchedLibraryPaths = new Map<number, string[]>();
  private readonly pendingTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; type: EventType; libraryId: number }>();
  private readonly pendingFolderScanTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; libraryId: number }>();
  private readonly pendingCrossLibraryReconcileLibraryIds = new Set<number>();
  private pendingCrossLibraryReconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly suppressedDirScans = new Map<number, Set<string>>();
  private readonly suppressedDirScanTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly processor: FileEventProcessorService,
    private readonly gateway: ScanGateway,
    private readonly scannerService: ScannerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const event = 'scanner.watcher.bootstrap';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] - watcher bootstrap started`);
    try {
      const watchedLibraries = await this.db.select().from(libraries).where(eq(libraries.watch, true));
      let failedWatcherCount = 0;
      for (const lib of watchedLibraries) {
        const folders = await this.db.select().from(libraryFolders).where(eq(libraryFolders.libraryId, lib.id));
        try {
          await this.startWatcher(
            lib.id,
            folders.map((f) => f.path),
          );
        } catch (err) {
          failedWatcherCount += 1;
          const errorClass = err instanceof Error ? err.name : 'Error';
          const errorMessage = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
          this.logger.warn(
            `[${event}] [skip] libraryId=${lib.id} pathCount=${folders.length} errorClass=${errorClass} error="${errorMessage}" - watcher disabled for library during startup`,
          );
        }
      }

      this.reconcileTimer = setInterval(() => {
        this.reconcile().catch((err) => {
          const errorClass = err instanceof Error ? err.name : 'Error';
          const errorMessage = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
          this.logger.error(`[scanner.watcher.reconcile] [fail] errorClass=${errorClass} error="${errorMessage}" - reconcile failed`);
        });
      }, RECONCILE_MS);
      this.logger.log(
        `[${event}] [end] durationMs=${Date.now() - startedAt} watchedLibraryCount=${watchedLibraries.length} failedWatcherCount=${failedWatcherCount} - watcher bootstrap completed`,
      );
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
      this.logger.warn(
        `[${event}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - watcher bootstrap failed`,
      );
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    const event = 'scanner.watcher.destroy';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] activeWatchers=${this.subscriptions.size} - watcher destroy started`);
    try {
      if (this.reconcileTimer) clearInterval(this.reconcileTimer);
      for (const entry of this.pendingTimers.values()) clearTimeout(entry.timer);
      this.pendingTimers.clear();
      for (const entry of this.pendingFolderScanTimers.values()) clearTimeout(entry.timer);
      this.pendingFolderScanTimers.clear();
      if (this.pendingCrossLibraryReconcileTimer) clearTimeout(this.pendingCrossLibraryReconcileTimer);
      this.pendingCrossLibraryReconcileTimer = null;
      this.pendingCrossLibraryReconcileLibraryIds.clear();
      for (const timer of this.suppressedDirScanTimers.values()) clearTimeout(timer);
      this.suppressedDirScanTimers.clear();
      this.suppressedDirScans.clear();
      for (const subs of this.subscriptions.values()) {
        for (const sub of subs) await sub.unsubscribe();
      }
      this.subscriptions.clear();
      this.watchedLibraryPaths.clear();
      this.logger.log(`[${event}] [end] durationMs=${Date.now() - startedAt} - watcher destroy completed`);
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
      this.logger.warn(
        `[${event}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - watcher destroy failed`,
      );
      throw err;
    }
  }

  private async reconcile(): Promise<void> {
    const event = 'scanner.watcher.reconcile';
    const startedAt = Date.now();
    const libraryIds = [...this.subscriptions.keys()];
    if (libraryIds.length === 0) return;
    const libraryIdsLabel = `[${libraryIds.join(',')}]`;

    this.logger.log(`[${event}] [start] libraryCount=${libraryIds.length} libraryIds=${libraryIdsLabel} - reconcile started`);
    try {
      const results = await this.processor.reconcileMissingBooks(libraryIds);
      for (const result of results) {
        if (result.type === 'book-missing') {
          this.gateway.emitBookMissing({ libraryId: result.libraryId, bookIds: result.bookIds });
          this.scannerService.bufferBooksUnavailableNotification(result.libraryId, result.bookIds);
        } else if (result.type === 'book-restored') {
          this.gateway.emitBookRestored({ libraryId: result.libraryId, bookIds: result.bookIds });
          this.scannerService.bufferBooksRestoredNotification(result.libraryId, result.bookIds);
        } else if (result.type === 'book-moved') {
          this.gateway.emitBookMoved({ libraryId: result.libraryId, bookIds: result.bookIds });
        }
      }
      this.logger.log(
        `[${event}] [end] libraryCount=${libraryIds.length} libraryIds=${libraryIdsLabel} durationMs=${Date.now() - startedAt} resultCount=${results.length} - reconcile completed`,
      );
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
      this.logger.warn(
        `[${event}] [fail] libraryCount=${libraryIds.length} libraryIds=${libraryIdsLabel} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - reconcile failed`,
      );
      throw err;
    }
  }

  async startWatcher(libraryId: number, paths: string[]): Promise<void> {
    const event = 'scanner.watcher.start';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] libraryId=${libraryId} pathCount=${paths.length} - watcher start requested`);
    const subs: AsyncSubscription[] = [];
    let currentPath: string | null = null;
    try {
      await this.stopWatcher(libraryId);
      if (paths.length === 0) {
        this.watchedLibraryPaths.delete(libraryId);
        this.logger.log(`[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} pathCount=0 - watcher start completed`);
        return;
      }

      const { subscribe } = await import('@parcel/watcher');

      for (const path of paths) {
        currentPath = path;
        const sub = await subscribe(path, (err, events) => {
          if (err) {
            this.logger.warn(
              `[${event}] [fail] libraryId=${libraryId} path="${path.replace(/"/g, '\\"')}" errorClass=${err.name ?? 'Error'} error="${err.message.replace(/"/g, '\\"')}" - watcher callback error`,
            );
            return;
          }
          for (const fsEvent of events) {
            const normalizedType: EventType | null =
              fsEvent.type === 'delete' ? 'delete' : fsEvent.type === 'create' || fsEvent.type === 'update' ? 'create' : null;
            if (!normalizedType) continue;
            this.schedule(normalizedType, fsEvent.path, libraryId);
          }
        });
        subs.push(sub);
      }

      this.subscriptions.set(libraryId, subs);
      this.watchedLibraryPaths.set(libraryId, [...paths]);
      currentPath = null;
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} pathCount=${paths.length} - watcher start completed`,
      );
    } catch (err) {
      for (const sub of subs) {
        try {
          await sub.unsubscribe();
        } catch {
          // best-effort cleanup after a partial watcher startup
        }
      }
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
      const pathPart = currentPath ? ` path="${currentPath.replace(/"/g, '\\"')}"` : '';
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId}${pathPart} pathCount=${paths.length} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - watcher start failed`,
      );
      throw err;
    }
  }

  async stopWatcher(libraryId: number): Promise<void> {
    const event = 'scanner.watcher.stop';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] libraryId=${libraryId} - watcher stop requested`);
    try {
      this.watchedLibraryPaths.delete(libraryId);
      const existing = this.subscriptions.get(libraryId);
      if (!existing) {
        this.logger.log(`[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} hadWatcher=false - watcher stop completed`);
        return;
      }
      for (const sub of existing) await sub.unsubscribe();
      this.subscriptions.delete(libraryId);
      this.clearPendingTimersForLibrary(libraryId);
      this.pendingCrossLibraryReconcileLibraryIds.delete(libraryId);
      if (this.pendingCrossLibraryReconcileLibraryIds.size === 0 && this.pendingCrossLibraryReconcileTimer) {
        clearTimeout(this.pendingCrossLibraryReconcileTimer);
        this.pendingCrossLibraryReconcileTimer = null;
      }
      this.clearLibraryFolderScanSuppressions(libraryId);
      this.logger.log(`[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} hadWatcher=true - watcher stop completed`);
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - watcher stop failed`,
      );
      throw err;
    }
  }

  private scheduleFolderScan(filePath: string, libraryId: number): void {
    const bookFolder = dirname(filePath);
    // A root-level file is the book candidate, so debouncing by the library root
    // would drop sibling files moved into the root in the same burst.
    const isRootLevelFile = (this.watchedLibraryPaths.get(libraryId) ?? []).some((libraryPath) => bookFolder === libraryPath);
    const key = `${libraryId}:${isRootLevelFile ? filePath : bookFolder}`;
    const existing = this.pendingFolderScanTimers.get(key);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pendingFolderScanTimers.delete(key);
      this.scannerService.scanBookFolderAsync(filePath, libraryId);
    }, SCAN_DEBOUNCE_MS);
    this.pendingFolderScanTimers.set(key, { timer, libraryId });
  }

  private clearPendingTimersForLibrary(libraryId: number): void {
    for (const [path, entry] of this.pendingTimers.entries()) {
      if (entry.libraryId !== libraryId) continue;
      clearTimeout(entry.timer);
      this.pendingTimers.delete(path);
    }

    for (const [folderPath, entry] of this.pendingFolderScanTimers.entries()) {
      if (entry.libraryId !== libraryId) continue;
      clearTimeout(entry.timer);
      this.pendingFolderScanTimers.delete(folderPath);
    }
  }

  // Only reconcile missing books in other libraries instead of full rescan
  private scheduleCrossLibraryReconcile(sourceLibraryId: number): void {
    const otherLibraryIds = [...this.subscriptions.keys()].filter((id) => id !== sourceLibraryId);
    if (otherLibraryIds.length === 0) return;

    for (const libraryId of otherLibraryIds) this.pendingCrossLibraryReconcileLibraryIds.add(libraryId);
    if (this.pendingCrossLibraryReconcileTimer) clearTimeout(this.pendingCrossLibraryReconcileTimer);

    this.pendingCrossLibraryReconcileTimer = setTimeout(() => {
      this.pendingCrossLibraryReconcileTimer = null;
      const libraryIds = [...this.pendingCrossLibraryReconcileLibraryIds].filter((id) => this.subscriptions.has(id));
      this.pendingCrossLibraryReconcileLibraryIds.clear();
      if (libraryIds.length === 0) return;

      this.processor
        .reconcileMissingBooks(libraryIds)
        .then((results) => {
          for (const result of results) {
            if (result.type === 'book-restored') {
              this.gateway.emitBookRestored({ libraryId: result.libraryId, bookIds: result.bookIds });
              this.scannerService.bufferBooksRestoredNotification(result.libraryId, result.bookIds);
            } else if (result.type === 'book-moved') {
              this.gateway.emitBookMoved({ libraryId: result.libraryId, bookIds: result.bookIds });
            }
          }
        })
        .catch((err) => {
          this.logger.warn(
            `[scanner.watcher.cross_library_reconcile] [fail] libraryCount=${libraryIds.length} libraryIds=[${libraryIds.join(',')}] errorClass=${err instanceof Error ? err.name : 'Error'} error="${(err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"')}" - cross-library reconcile failed`,
          );
        });
    }, CROSS_LIBRARY_RESCAN_DEBOUNCE_MS);
  }

  private suppressFolderScansForDir(dirPath: string, libraryId: number): void {
    const key = `${libraryId}:${dirPath}`;
    const existingTimer = this.suppressedDirScanTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    let librarySet = this.suppressedDirScans.get(libraryId);
    if (!librarySet) {
      librarySet = new Set<string>();
      this.suppressedDirScans.set(libraryId, librarySet);
    }
    librarySet.add(dirPath);

    const timer = setTimeout(() => {
      this.suppressedDirScanTimers.delete(key);
      const currentSet = this.suppressedDirScans.get(libraryId);
      if (!currentSet) return;
      currentSet.delete(dirPath);
      if (currentSet.size === 0) {
        this.suppressedDirScans.delete(libraryId);
      }
    }, DIR_CREATE_SUPPRESS_MS);
    this.suppressedDirScanTimers.set(key, timer);
  }

  private clearLibraryFolderScanSuppressions(libraryId: number): void {
    const prefix = `${libraryId}:`;
    for (const [key, timer] of this.suppressedDirScanTimers.entries()) {
      if (!key.startsWith(prefix)) continue;
      clearTimeout(timer);
      this.suppressedDirScanTimers.delete(key);
    }
    this.suppressedDirScans.delete(libraryId);
  }

  private isFolderScanSuppressed(filePath: string, libraryId: number): boolean {
    const suppressedDirs = this.suppressedDirScans.get(libraryId);
    if (!suppressedDirs) return false;
    for (const dirPath of suppressedDirs) {
      if (filePath === dirPath || filePath.startsWith(`${dirPath}${sep}`)) {
        return true;
      }
    }
    return false;
  }

  private schedule(type: EventType, path: string, libraryId: number): void {
    // Guard orphaned timers - ignore events for unwatched libraries
    if (!this.subscriptions.has(libraryId)) return;

    // Dir-level coalescing - if there's already a pending folder scan
    // for this file's directory, don't schedule individual file processing
    const fileDir = dirname(path);
    const folderKey = `${libraryId}:${fileDir}`;
    if (this.pendingFolderScanTimers.has(folderKey)) return;

    const existing = this.pendingTimers.get(path);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pendingTimers.delete(path);
      this.process(type, path, libraryId).catch((err) =>
        this.logger.error(
          `[scanner.watcher.process_event] [fail] libraryId=${libraryId} type=${type} path="${path.replace(/"/g, '\\"')}" errorClass=${err instanceof Error ? err.name : 'Error'} error="${(err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"')}" - file event processing failed`,
        ),
      );
    }, DEBOUNCE_MS);
    this.pendingTimers.set(path, { timer, type, libraryId });
  }

  private async process(type: EventType, path: string, libraryId: number): Promise<void> {
    let result: FileEventResult;
    if (type === 'create') {
      result = await this.processor.handleCreate(path, libraryId);
      if (result.type === 'noop') {
        const pathStat = await stat(path).catch(() => null);
        if (pathStat?.isDirectory()) {
          // A created directory can be either one book folder or a grouping folder
          // containing many books, so scan that subtree instead of one synthetic child.
          this.suppressFolderScansForDir(path, libraryId);
          this.scannerService.scanBookDirectoryAsync(path, libraryId);
          return;
        }
        // Only schedule a scan for unrecognized content-format files. Supplementary
        // files (covers, metadata, .lit, etc.) don't need a full scan on creation.
        const { role } = classifyFile(path);
        if (role === 'content') {
          if (this.isFolderScanSuppressed(path, libraryId) && this.scannerService.isScanRunning(libraryId)) return;
          this.scheduleFolderScan(path, libraryId);
        }
        return;
      }
    } else {
      result = await this.processor.handleUnlink(path, libraryId);
      if (result.type === 'noop') {
        result = await this.processor.handleUnlinkDir(path, libraryId);
      }
    }

    if (result.type === 'book-missing') {
      this.gateway.emitBookMissing({ libraryId: result.libraryId, bookIds: result.bookIds });
      this.scannerService.bufferBooksUnavailableNotification(result.libraryId, result.bookIds);
      if (type === 'delete') this.scheduleCrossLibraryReconcile(result.libraryId);
    } else if (result.type === 'book-restored') {
      this.gateway.emitBookRestored({ libraryId: result.libraryId, bookIds: result.bookIds });
      this.scannerService.bufferBooksRestoredNotification(result.libraryId, result.bookIds);
    } else if (result.type === 'book-moved') {
      this.gateway.emitBookMoved({ libraryId: result.libraryId, bookIds: result.bookIds });
      // A move updates the file's path and may consolidate virtual-sibling books.
      // Schedule a folder scan so upsertBook can drain any remaining siblings.
      if (type === 'create') this.scheduleFolderScan(path, libraryId);
    }
  }
}
