import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AsyncSubscription } from '@parcel/watcher';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { libraries, libraryFolders } from '../../db/schema';
import { ScanGateway } from './scan.gateway';
import { ScannerService } from './scanner.service';
import { FileEventProcessorService, type FileEventResult } from './file-event-processor.service';

type Db = NodePgDatabase<typeof schema>;
type EventType = 'delete' | 'create';

const DEBOUNCE_MS = 500;
const SCAN_DEBOUNCE_MS = 3_000;
const RECONCILE_MS = 30_000;

@Injectable()
export class FileWatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FileWatcherService.name);
  private readonly subscriptions = new Map<number, AsyncSubscription[]>();
  private readonly pendingTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; type: EventType; libraryId: number }>();
  private readonly pendingScanTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly processor: FileEventProcessorService,
    private readonly gateway: ScanGateway,
    private readonly scannerService: ScannerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const watchedLibraries = await this.db.select().from(libraries).where(eq(libraries.watch, true));
    for (const lib of watchedLibraries) {
      const folders = await this.db.select().from(libraryFolders).where(eq(libraryFolders.libraryId, lib.id));
      await this.startWatcher(
        lib.id,
        folders.map((f) => f.path),
      );
    }

    this.reconcileTimer = setInterval(() => {
      this.reconcile().catch((err) => this.logger.error(`Reconcile error: ${(err as Error).message}`));
    }, RECONCILE_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    for (const entry of this.pendingTimers.values()) clearTimeout(entry.timer);
    this.pendingTimers.clear();
    for (const timer of this.pendingScanTimers.values()) clearTimeout(timer);
    this.pendingScanTimers.clear();
    for (const subs of this.subscriptions.values()) {
      for (const sub of subs) await sub.unsubscribe();
    }
    this.subscriptions.clear();
  }

  private async reconcile(): Promise<void> {
    const libraryIds = [...this.subscriptions.keys()];
    if (libraryIds.length === 0) return;

    const results = await this.processor.reconcileMissingBooks(libraryIds);
    for (const result of results) {
      if (result.type === 'book-restored') {
        this.gateway.emitBookRestored({ libraryId: result.libraryId, bookIds: result.bookIds });
      }
    }
  }

  async startWatcher(libraryId: number, paths: string[]): Promise<void> {
    await this.stopWatcher(libraryId);
    if (paths.length === 0) return;

    const { subscribe } = await import('@parcel/watcher');
    const subs: AsyncSubscription[] = [];

    for (const path of paths) {
      const sub = await subscribe(path, (err, events) => {
        if (err) {
          this.logger.warn(`Watcher error for library ${libraryId}: ${err.message}`);
          return;
        }
        for (const event of events) {
          if (event.type === 'delete' || event.type === 'create') {
            this.schedule(event.type, event.path, libraryId);
          }
        }
      });
      subs.push(sub);
    }

    this.subscriptions.set(libraryId, subs);
    this.logger.log(`Watching ${paths.length} folder(s) for library ${libraryId}`);
  }

  async stopWatcher(libraryId: number): Promise<void> {
    const existing = this.subscriptions.get(libraryId);
    if (!existing) return;
    for (const sub of existing) await sub.unsubscribe();
    this.subscriptions.delete(libraryId);
  }

  private scheduleScan(libraryId: number): void {
    const existing = this.pendingScanTimers.get(libraryId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pendingScanTimers.delete(libraryId);
      this.scannerService.startScanAsync(libraryId);
    }, SCAN_DEBOUNCE_MS);
    this.pendingScanTimers.set(libraryId, timer);
  }

  private schedule(type: EventType, path: string, libraryId: number): void {
    const existing = this.pendingTimers.get(path);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pendingTimers.delete(path);
      this.process(type, path, libraryId).catch((err) => this.logger.error(`Failed to process ${type} for ${path}: ${(err as Error).message}`));
    }, DEBOUNCE_MS);
    this.pendingTimers.set(path, { timer, type, libraryId });
  }

  private async process(type: EventType, path: string, libraryId: number): Promise<void> {
    let result: FileEventResult;
    if (type === 'create') {
      result = await this.processor.handleCreate(path);
      if (result.type === 'noop') {
        this.scheduleScan(libraryId);
        return;
      }
    } else {
      result = await this.processor.handleUnlink(path);
      if (result.type === 'noop') {
        result = await this.processor.handleUnlinkDir(path);
      }
    }

    if (result.type === 'book-missing') {
      this.gateway.emitBookMissing({ libraryId: result.libraryId, bookIds: result.bookIds });
    } else if (result.type === 'book-restored') {
      this.gateway.emitBookRestored({ libraryId: result.libraryId, bookIds: result.bookIds });
    } else if (result.type === 'book-moved') {
      this.gateway.emitBookMoved({ libraryId: result.libraryId, bookIds: result.bookIds });
    }
  }
}
