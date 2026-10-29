import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { ReadAloudJobRow } from '../../db/schema';
import { BookService } from '../book/book.service';
import { NotificationService } from '../notification/notification.service';
import { UserService } from '../user/user.service';
import { ReadAloudJobRepository } from './read-aloud-job.repository';
import { ReadAloudGateway } from './read-aloud.gateway';
import { ReadAloudPresenter } from './read-aloud-presenter.service';

export type ReadAloudOutcome = 'ready' | 'needs_review' | 'failed' | 'review_expiring';

const OUTCOME_TYPES = {
  ready: NotificationType.ReadAloudReady,
  needs_review: NotificationType.ReadAloudNeedsReview,
  failed: NotificationType.ReadAloudFailed,
  review_expiring: NotificationType.ReadAloudReviewExpiring,
} as const;

/** Progress pushes come every few seconds, so a requester who may still see the job is re-checked once a minute. */
const ACCESS_RECHECK_MS = 60_000;

/**
 * Tells the requester what happened: a live socket update for any change, and a notification for
 * the outcomes worth hearing about hours later. Both are best effort and never fail the job.
 *
 * Accounts store no locale, so the stored title and message are an English fallback. The web client
 * renders these types in the reader's own locale from `meta.bookTitle` and `meta.errorCode`; clients
 * that do not know a type show the fallback.
 */
@Injectable()
export class ReadAloudNotifier {
  private readonly logger = new Logger(ReadAloudNotifier.name);
  private readonly visibleUntil = new Map<string, number>();

  constructor(
    private readonly jobs: ReadAloudJobRepository,
    private readonly presenter: ReadAloudPresenter,
    private readonly gateway: ReadAloudGateway,
    private readonly notifications: NotificationService,
    private readonly users: UserService,
    private readonly books: BookService,
  ) {}

  async pushUpdate(row: ReadAloudJobRow | null): Promise<void> {
    if (!row || row.requestedByUserId == null) return;
    try {
      if (!(await this.requesterStillSees(row.requestedByUserId, row.bookId))) return;
      const job = await this.presenter.present(row, { id: row.requestedByUserId, isSuperuser: false });
      this.gateway.emitJobUpdated(row.requestedByUserId, job);
    } catch (error) {
      this.warn('push', row.id, error);
    }
  }

  async notify(row: ReadAloudJobRow, outcome: ReadAloudOutcome): Promise<void> {
    if (row.requestedByUserId == null) return;
    try {
      const user = await this.users.findByIdWithPermissions(row.requestedByUserId);
      if (!(await this.maySee(user, row.bookId))) return;
      const bookTitle = (await this.jobs.findBookTitle(row.bookId))?.trim() || null;
      await this.notifications.notify({
        type: OUTCOME_TYPES[outcome],
        title: this.title(outcome, bookTitle ?? 'Untitled book'),
        message: this.message(row, outcome),
        actionUrl: `/book/${row.bookId}/files`,
        meta: { jobId: row.id, bookId: row.bookId, bookTitle, errorCode: row.errorCode ?? null },
        scope: { kind: 'user', userId: row.requestedByUserId },
      });
    } catch (error) {
      this.warn('notify', row.id, error);
    }
  }

  /**
   * The requester may have lost the permission, the account or the book since the job started; the
   * socket they opened before that stays connected. A positive answer is reused for a minute.
   */
  private async requesterStillSees(userId: number, bookId: number): Promise<boolean> {
    const key = `${userId}:${bookId}`;
    const now = Date.now();
    if ((this.visibleUntil.get(key) ?? 0) > now) return true;
    for (const [cached, until] of this.visibleUntil) if (until <= now) this.visibleUntil.delete(cached);
    const allowed = await this.maySee(await this.users.findByIdWithPermissions(userId), bookId);
    if (allowed) this.visibleUntil.set(key, now + ACCESS_RECHECK_MS);
    return allowed;
  }

  private async maySee(user: RequestUser | null, bookId: number): Promise<boolean> {
    if (!user?.active) return false;
    if (!user.isSuperuser && !user.permissions.includes(Permission.LibraryGenerateReadAloud)) return false;
    try {
      await this.books.verifyBookAccess(bookId, user);
      return true;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  private title(outcome: ReadAloudOutcome, bookTitle: string): string {
    switch (outcome) {
      case 'ready':
        return `Read-aloud ready: ${bookTitle}`;
      case 'needs_review':
        return `Read-aloud needs review: ${bookTitle}`;
      case 'failed':
        return `Read-aloud failed: ${bookTitle}`;
      case 'review_expiring':
        return `Read-aloud review expires soon: ${bookTitle}`;
    }
  }

  private message(row: ReadAloudJobRow, outcome: ReadAloudOutcome): string | undefined {
    if (outcome === 'needs_review') return 'Part of the text could not be matched to the audio. Review it before adding it to the book.';
    if (outcome === 'review_expiring') return 'The generated read-aloud will be discarded in a few days unless you review it.';
    if (outcome === 'failed') return row.errorCode ? `Reason: ${row.errorCode.replaceAll('_', ' ')}` : undefined;
    return undefined;
  }

  private warn(action: string, jobId: string, error: unknown): void {
    this.logger.warn(
      `[read_aloud.notifier] [fail] action=${action} jobId=${jobId} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - read-aloud update not delivered`,
    );
  }
}
