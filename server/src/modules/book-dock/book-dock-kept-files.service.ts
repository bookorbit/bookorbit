import { Injectable, Logger } from '@nestjs/common';
import { stat } from 'fs/promises';
import type { Stats } from 'fs';

import type { BookDockFileRow, NewBookDockKeptFileRow } from '../../db/schema';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { BookDockKeptFilesRepository } from './book-dock-kept-files.repository';
import { BookDockRepository } from './book-dock.repository';
import { LibraryDockRegistry } from './library-dock-registry.service';
import { resolveDockSettings } from './library-dock-settings';

type KeepOriginalRow = Pick<BookDockFileRow, 'dockId' | 'autoFinalizeSuppressed' | 'uploadedBy'>;

const PRUNE_PAGE_SIZE = 500;
const STAT_CONCURRENCY = 16;

/**
 * Keep-original docks (D33 to D36): a file dropped there and then filed or discarded stays on disk,
 * usually because a download client is seeding it. Each such file is remembered by path, size and modification time,
 * so discovery never takes it in again while it is unchanged, and forgotten once it is gone.
 */
@Injectable()
export class BookDockKeptFilesService {
  private readonly logger = new Logger(BookDockKeptFilesService.name);

  constructor(
    private readonly kept: BookDockKeptFilesRepository,
    private readonly repo: BookDockRepository,
    private readonly appSettings: AppSettingsService,
    private readonly dockRegistry: LibraryDockRegistry,
  ) {}

  /**
   * Whether rows leave their files in place, for checking many rows against one read of the
   * settings. Only a file dropped on disk does: nothing seeds an upload, and a request import's dock
   * copy is BookOrbit's own staging link while the download client keeps the original.
   */
  async keepOriginalCheck(): Promise<(row: KeepOriginalRow) => Promise<boolean>> {
    const global = await this.appSettings.getBookDockSettings();
    return async (row) => {
      if (row.autoFinalizeSuppressed || row.uploadedBy !== null) return false;
      const dock = row.dockId == null ? undefined : await this.dockRegistry.findById(row.dockId);
      return resolveDockSettings(dock ?? null, global).keepOriginal;
    };
  }

  async keepsOriginals(row: KeepOriginalRow): Promise<boolean> {
    return (await this.keepOriginalCheck())(row);
  }

  /**
   * Remembers every file of a row that leaves the dock but stays on disk: filed into `bookId`, or
   * discarded. A file that has since vanished is not remembered.
   */
  async remember(row: Pick<BookDockFileRow, 'id' | 'absolutePath' | 'dockId'>, outcome: { bookId: number } | { discarded: true }): Promise<void> {
    const unitFiles = await this.repo.findUnitFiles(row.id);
    const paths = unitFiles.length > 0 ? unitFiles.map((file) => file.absolutePath) : [row.absolutePath];
    const ignored = 'discarded' in outcome;
    const entries: NewBookDockKeptFileRow[] = [];
    for (const [path, info] of await statAll(paths)) {
      if (!info?.isFile()) continue;
      entries.push({
        absolutePath: path,
        fileSize: info.size,
        mtimeMs: Math.trunc(info.mtimeMs),
        dockId: row.dockId,
        bookId: ignored ? null : outcome.bookId,
        ignored,
      });
    }
    await this.kept.upsert(entries);
  }

  /**
   * The paths among these that were left in place and have not changed since. A changed file is
   * forgotten, so it is taken in again as a new arrival; so is one that is gone.
   */
  async unchangedKept(paths: string[]): Promise<Set<string>> {
    const unchanged = new Set<string>();
    if (paths.length === 0) return unchanged;
    const entries = await this.kept.findByPaths(paths);
    if (entries.length === 0) return unchanged;

    const stats = await statAll(entries.map((entry) => entry.absolutePath));
    const stale: number[] = [];
    for (const entry of entries) {
      const info = stats.get(entry.absolutePath);
      if (info?.isFile() && info.size === entry.fileSize && Math.trunc(info.mtimeMs) === entry.mtimeMs) unchanged.add(entry.absolutePath);
      else stale.push(entry.id);
    }
    await this.kept.deleteByIds(stale);
    return unchanged;
  }

  /** A file or folder was deleted from the dock. */
  async forget(path: string): Promise<void> {
    await this.kept.deleteAtOrUnder(path);
  }

  /** Drops every entry whose file is gone, a page at a time. Returns how many were dropped. */
  async prune(): Promise<number> {
    const startedAt = Date.now();
    let checked = 0;
    let dropped = 0;
    let afterId: number | undefined;
    try {
      while (true) {
        const page = await this.kept.findPage(afterId, PRUNE_PAGE_SIZE);
        if (page.length === 0) break;
        const stats = await statAll(page.map((entry) => entry.absolutePath));
        const gone = page.filter((entry) => !stats.get(entry.absolutePath)?.isFile()).map((entry) => entry.id);
        await this.kept.deleteByIds(gone);
        checked += page.length;
        dropped += gone.length;
        afterId = page[page.length - 1]!.id;
      }
      if (dropped > 0) {
        this.logger.log(
          `[book_dock.kept_prune] [end] checked=${checked} dropped=${dropped} durationMs=${Date.now() - startedAt} - forgot kept files that are gone`,
        );
      }
      return dropped;
    } catch (err) {
      this.logger.warn(
        `[book_dock.kept_prune] [fail] checked=${checked} dropped=${dropped} durationMs=${Date.now() - startedAt} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - kept file prune failed`,
      );
      return dropped;
    }
  }

  countByDock(): Promise<Map<number | null, number>> {
    return this.kept.countByDock();
  }
}

/** Stats paths a few at a time; a path that cannot be read maps to null. */
async function statAll(paths: string[]): Promise<Map<string, Stats | null>> {
  const result = new Map<string, Stats | null>();
  for (let index = 0; index < paths.length; index += STAT_CONCURRENCY) {
    const batch = paths.slice(index, index + STAT_CONCURRENCY);
    const stats = await Promise.all(batch.map((path) => stat(path).catch(() => null)));
    batch.forEach((path, offset) => result.set(path, stats[offset] ?? null));
  }
  return result;
}
