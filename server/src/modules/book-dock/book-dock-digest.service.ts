import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { NotificationType, Permission } from '@bookorbit/types';

import type { BookDockFileRow } from '../../db/schema';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { NotificationService, type NotificationScope, type NotifyPayload } from '../notification/notification.service';
import { LibraryDockRegistry } from './library-dock-registry.service';

/** A dock's digest goes out once nothing has been filed or held there for this long (P4). */
export const DIGEST_QUIET_MS = 5 * 60_000;
/** A dock that never goes quiet still hears about its files this often. */
export const DIGEST_MAX_WAIT_MS = 60 * 60_000;

type DigestRow = Pick<BookDockFileRow, 'id' | 'fileName' | 'dockId' | 'uploadedBy'>;

interface Digest {
  key: string;
  dockId: number | null;
  scope: NotificationScope;
  filed: number;
  held: number;
  /** The one file filed so far, so a digest of one can still name it. */
  first: { fileId: number; fileName: string; bookId: number | undefined } | null;
  startedAt: number;
  timer: NodeJS.Timeout | null;
}

/**
 * Collects what auto-file did in each dock and tells each recipient once the dock goes quiet (D32):
 * "Filed 482 into Fiction, 18 need review" rather than 500 notifications. A file someone uploaded
 * is reported to them; a file dropped on disk to the dock managers. Counts live in memory and are
 * lost on restart, which is acceptable for a summary (P4).
 */
@Injectable()
export class BookDockDigestService implements OnModuleDestroy {
  private readonly logger = new Logger(BookDockDigestService.name);
  private readonly digests = new Map<string, Digest>();

  constructor(
    private readonly notificationService: NotificationService,
    private readonly dockRegistry: LibraryDockRegistry,
  ) {}

  /** Auto-file filed this file into `bookId`. */
  recordFiled(row: DigestRow, bookId: number | undefined): void {
    const digest = this.digestFor(row);
    digest.filed++;
    if (digest.filed === 1) digest.first = { fileId: row.id, fileName: row.fileName, bookId };
    this.schedule(digest);
  }

  /** Auto-file looked at this file and left it waiting for a person. */
  recordHeld(row: DigestRow): void {
    const digest = this.digestFor(row);
    digest.held++;
    this.schedule(digest);
  }

  onModuleDestroy(): void {
    for (const digest of this.digests.values()) if (digest.timer) clearTimeout(digest.timer);
    this.digests.clear();
  }

  private digestFor(row: DigestRow): Digest {
    const key = `${row.dockId ?? 'unsorted'}:${row.uploadedBy ?? 'managers'}`;
    let digest = this.digests.get(key);
    if (!digest) {
      digest = {
        key,
        dockId: row.dockId,
        scope: row.uploadedBy ? { kind: 'user', userId: row.uploadedBy } : { kind: 'permission', permission: Permission.ManageBookDock },
        filed: 0,
        held: 0,
        first: null,
        startedAt: Date.now(),
        timer: null,
      };
      this.digests.set(key, digest);
    }
    return digest;
  }

  private schedule(digest: Digest): void {
    if (digest.timer) clearTimeout(digest.timer);
    const wait = Math.max(0, Math.min(DIGEST_QUIET_MS, digest.startedAt + DIGEST_MAX_WAIT_MS - Date.now()));
    digest.timer = setTimeout(() => void this.flush(digest.key), wait);
    digest.timer.unref?.();
  }

  private async flush(key: string): Promise<void> {
    const digest = this.digests.get(key);
    if (!digest) return;
    this.digests.delete(key);
    if (digest.timer) clearTimeout(digest.timer);
    try {
      await this.notificationService.notify(await this.payloadFor(digest));
    } catch (err) {
      this.logger.warn(
        `[book_dock.digest] [fail] dockId=${digest.dockId ?? 'none'} filed=${digest.filed} held=${digest.held} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - dock digest could not be sent`,
      );
    }
  }

  private async payloadFor(digest: Digest): Promise<NotifyPayload> {
    const { filed, held, first, scope } = digest;
    // A single filed book is told about as it always was, by name (D32).
    if (filed === 1 && held === 0 && first) {
      return {
        type: NotificationType.BookDockFinalized,
        title: 'Book auto-finalized',
        message: `"${first.fileName}" was added to your library`,
        scope,
        meta: { fileId: first.fileId, bookId: first.bookId },
      };
    }
    const dock = digest.dockId === null ? undefined : await this.dockRegistry.findById(digest.dockId);
    const dockName = digest.dockId === null ? 'Unsorted' : (dock?.libraryName ?? 'a library');
    return {
      type: held > 0 ? NotificationType.BookDockDigestNeedsReview : NotificationType.BookDockDigest,
      title: `Library Dock: ${dockName}`,
      message: digestMessage(filed, held),
      actionUrl: '/book-dock',
      scope,
      meta: { dockId: digest.dockId, libraryId: dock?.libraryId ?? null, libraryName: dock?.libraryName ?? null, filed, held },
    };
  }
}

/** The English text stored with the notification; the web words it again in the reader's locale. */
function digestMessage(filed: number, held: number): string {
  const books = (count: number) => `${count} ${count === 1 ? 'book' : 'books'}`;
  if (held === 0) return `${books(filed)} filed.`;
  const review = `${held} ${held === 1 ? 'needs' : 'need'} review`;
  return filed === 0 ? `${books(held)} ${held === 1 ? 'needs' : 'need'} review.` : `${books(filed)} filed, ${review}.`;
}
