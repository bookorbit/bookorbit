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
  private readonly pendingTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; type: EventType; libraryId: number }>();
  private readonly pendingFolderScanTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; libraryId: number }>();
  private readonly pendingLibraryRescanTimers = new Map<number, ReturnType<typeof setTimeout>>();
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
      for (const lib of watchedLibraries) {
        const folders = await this.db.select().from(libraryFolders).where(eq(libraryFolders.libraryId, lib.id));
        await this.startWatcher(
          lib.id,
          folders.map((f) => f.path),
        );
      }

      this.reconcileTimer = setInterval(() => {
        this.reconcile().catch((err) => {
          const errorClass = err instanceof Error ? err.name : 'Error';
          const errorMessage = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
          this.logger.error(`[scanner.watcher.reconcile] [fail] errorClass=${errorClass} error="${errorMessage}" - reconcile failed`);
        });
      }, RECONCILE_MS);
      this.logger.log(
        `[${event}] [end] durationMs=${Date.now() - startedAt} watchedLibraryCount=${watchedLibraries.length} - watcher bootstrap completed`,
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
      for (const timer of this.pendingLibraryRescanTimers.values()) clearTimeout(timer);
      this.pendingLibraryRescanTimers.clear();
      for (const timer of this.suppressedDirScanTimers.values()) clearTimeout(timer);
      this.suppressedDirScanTimers.clear();
      this.suppressedDirScans.clear();
      for (const subs of this.subscriptions.values()) {
        for (const sub of subs) await sub.unsubscribe();
      }
      this.subscriptions.clear();
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

    this.logger.log(`[${event}] [start] libraryCount=${libraryIds.length} - reconcile started`);
    try {
      const results = await this.processor.reconcileMissingBooks(libraryIds);
      for (const result of results) {
        if (result.type === 'book-missing') {
          this.gateway.emitBookMissing({ libraryId: result.libraryId, bookIds: result.bookIds });
        } else if (result.type === 'book-restored') {
          this.gateway.emitBookRestored({ libraryId: result.libraryId, bookIds: result.bookIds });
        } else if (result.type === 'book-moved') {
          this.gateway.emitBookMoved({ libraryId: result.libraryId, bookIds: result.bookIds });
        }
      }
      this.logger.log(
        `[${event}] [end] libraryCount=${libraryIds.length} durationMs=${Date.now() - startedAt} resultCount=${results.length} - reconcile completed`,
      );
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
      this.logger.warn(
        `[${event}] [fail] libraryCount=${libraryIds.length} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - reconcile failed`,
      );
      throw err;
    }
  }

  async startWatcher(libraryId: number, paths: string[]): Promise<void> {
    const event = 'scanner.watcher.start';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] libraryId=${libraryId} pathCount=${paths.length} - watcher start requested`);
    try {
      await this.stopWatcher(libraryId);
      if (paths.length === 0) {
        this.logger.log(`[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} pathCount=0 - watcher start completed`);
        return;
      }

      const { subscribe } = await import('@parcel/watcher');
      const subs: AsyncSubscription[] = [];

      for (const path of paths) {
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
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} pathCount=${paths.length} - watcher start completed`,
      );
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId} pathCount=${paths.length} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - watcher start failed`,
      );
      throw err;
    }
  }

  async stopWatcher(libraryId: number): Promise<void> {
    const event = 'scanner.watcher.stop';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] libraryId=${libraryId} - watcher stop requested`);
    try {
      const existing = this.subscriptions.get(libraryId);
      if (!existing) {
        this.logger.log(`[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} hadWatcher=false - watcher stop completed`);
        return;
      }
      for (const sub of existing) await sub.unsubscribe();
      this.subscriptions.delete(libraryId);
      this.clearPendingTimersForLibrary(libraryId);
      const pendingRescan = this.pendingLibraryRescanTimers.get(libraryId);
      if (pendingRescan) {
        clearTimeout(pendingRescan);
        this.pendingLibraryRescanTimers.delete(libraryId);
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
    const existing = this.pendingFolderScanTimers.get(bookFolder);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pendingFolderScanTimers.delete(bookFolder);
      this.scannerService.scanBookFolderAsync(filePath, libraryId);
    }, SCAN_DEBOUNCE_MS);
    this.pendingFolderScanTimers.set(bookFolder, { timer, libraryId });
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

  private scheduleCrossLibraryRescan(sourceLibraryId: number): void {
    for (const libraryId of this.subscriptions.keys()) {
      if (libraryId === sourceLibraryId) continue;
      const existing = this.pendingLibraryRescanTimers.get(libraryId);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        this.pendingLibraryRescanTimers.delete(libraryId);
        this.scannerService.startScanAsync(libraryId);
      }, CROSS_LIBRARY_RESCAN_DEBOUNCE_MS);
      this.pendingLibraryRescanTimers.set(libraryId, timer);
    }
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
          this.suppressFolderScansForDir(path, libraryId);
          this.scannerService.startScanAsync(libraryId);
          return;
        }
        // Only schedule a scan for unrecognised content-format files. Supplementary
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
      if (type === 'delete') this.scheduleCrossLibraryRescan(result.libraryId);
    } else if (result.type === 'book-restored') {
      this.gateway.emitBookRestored({ libraryId: result.libraryId, bookIds: result.bookIds });
    } else if (result.type === 'book-moved') {
      this.gateway.emitBookMoved({ libraryId: result.libraryId, bookIds: result.bookIds });
      // A move updates the file's path and may consolidate virtual-sibling books.
      // Schedule a folder scan so upsertBook can drain any remaining siblings.
      if (type === 'create') this.scheduleFolderScan(path, libraryId);
    }
  }
}
