import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FSWatcher } from 'chokidar';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { libraries, libraryFolders } from '../../db/schema';
import { ScanGateway } from './scan.gateway';
import { FileEventProcessorService } from './file-event-processor.service';

type Db = NodePgDatabase<typeof schema>;

const DEBOUNCE_MS = 500;

@Injectable()
export class FileWatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FileWatcherService.name);
  private readonly watchers = new Map<number, FSWatcher>();
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly processor: FileEventProcessorService,
    private readonly gateway: ScanGateway,
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
  }

  async onModuleDestroy(): Promise<void> {
    for (const timer of this.pendingTimers.values()) clearTimeout(timer);
    this.pendingTimers.clear();
    for (const watcher of this.watchers.values()) await watcher.close();
    this.watchers.clear();
  }

  async startWatcher(libraryId: number, paths: string[]): Promise<void> {
    await this.stopWatcher(libraryId);
    if (paths.length === 0) return;

    const { watch } = await import('chokidar');
    const watcher = watch(paths, { ignoreInitial: true, persistent: true });

    watcher.on('unlink', (path) => this.schedule('unlink', path));
    watcher.on('unlinkDir', (path) => this.schedule('unlinkDir', path));
    watcher.on('error', (err) => this.logger.warn(`Watcher error for library ${libraryId}: ${err}`));

    this.watchers.set(libraryId, watcher);
    this.logger.log(`Watching ${paths.length} folder(s) for library ${libraryId}`);
  }

  async stopWatcher(libraryId: number): Promise<void> {
    const existing = this.watchers.get(libraryId);
    if (!existing) return;
    await existing.close();
    this.watchers.delete(libraryId);
  }

  private schedule(type: 'unlink' | 'unlinkDir', path: string): void {
    const key = `${type}:${path}`;
    clearTimeout(this.pendingTimers.get(key));
    this.pendingTimers.set(
      key,
      setTimeout(() => {
        this.pendingTimers.delete(key);
        this.process(type, path).catch((err) => this.logger.error(`Failed to process ${type} for ${path}: ${(err as Error).message}`));
      }, DEBOUNCE_MS),
    );
  }

  private async process(type: 'unlink' | 'unlinkDir', path: string): Promise<void> {
    const result = type === 'unlink' ? await this.processor.handleUnlink(path) : await this.processor.handleUnlinkDir(path);

    if (result.type === 'book-missing') {
      this.gateway.emitBookMissing({ libraryId: result.libraryId, bookIds: result.bookIds });
    } else if (result.type === 'file-removed') {
      this.gateway.emitBookFileRemoved({ libraryId: result.libraryId, bookId: result.bookId, fileId: result.fileId });
    }
  }
}
