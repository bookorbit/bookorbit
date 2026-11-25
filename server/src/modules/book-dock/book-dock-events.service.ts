import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

export const BOOK_DOCK_FILE_INGESTED = 'book-dock.file.ingested';

/** How a file another module owns left the dock at a person's hand. */
export type BookDockOwnedFileExit = { kind: 'filed'; bookId: number } | { kind: 'discarded' };

/** Called once for each prepared file that then left the dock. */
export type BookDockOwnedFileExitReport = (fileId: number, exit: BookDockOwnedFileExit) => Promise<void>;

/**
 * Registered by a module that hands the dock files it files itself (`autoFinalizeSuppressed`), so it
 * hears when a person files or discards one in the dock instead. It runs before the dock touches
 * the files, while the foreign keys that point at them still hold: the dock row's removal empties
 * them, and the watcher can remove a row whose file has just moved before the dock's own cleanup does.
 */
export type BookDockOwnedFileExitHandler = (fileIds: number[]) => Promise<BookDockOwnedFileExitReport>;

const NOTHING_TO_REPORT: BookDockOwnedFileExitReport = () => Promise.resolve();

@Injectable()
export class BookDockEventsService extends EventEmitter {
  private readonly logger = new Logger(BookDockEventsService.name);
  private readonly exitHandlers: BookDockOwnedFileExitHandler[] = [];

  onOwnedFileExit(handler: BookDockOwnedFileExitHandler): void {
    this.exitHandlers.push(handler);
  }

  /**
   * Called by a person's file or discard before it touches anything. A row no other module owns
   * never reaches a handler. A handler that fails is logged and skipped rather than thrown: the
   * person's action goes ahead either way, and the owner keeps the state it already had.
   */
  async beforeOwnedFilesExit(rows: ReadonlyArray<{ id: number; autoFinalizeSuppressed: boolean }>): Promise<BookDockOwnedFileExitReport> {
    const fileIds = rows.filter((row) => row.autoFinalizeSuppressed).map((row) => row.id);
    if (fileIds.length === 0 || this.exitHandlers.length === 0) return NOTHING_TO_REPORT;

    const reports: BookDockOwnedFileExitReport[] = [];
    for (const handler of this.exitHandlers) {
      try {
        reports.push(await handler(fileIds));
      } catch (error) {
        this.logger.warn(
          `[book_dock.owned_exit] [fail] stage=prepare files=${fileIds.length} errorClass=${errorClass(error)} error="${errorText(error)}" - the module that owns these files was not told they are leaving the dock`,
        );
      }
    }
    if (reports.length === 0) return NOTHING_TO_REPORT;

    return async (fileId, exit) => {
      for (const report of reports) {
        try {
          await report(fileId, exit);
        } catch (error) {
          this.logger.warn(
            `[book_dock.owned_exit] [fail] stage=report fileId=${fileId} exit=${exit.kind} errorClass=${errorClass(error)} error="${errorText(error)}" - the module that owns this file was not told it left the dock`,
          );
        }
      }
    };
  }
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

function errorText(error: unknown): string {
  return sanitizeLogValue(error instanceof Error ? error.message : String(error));
}
