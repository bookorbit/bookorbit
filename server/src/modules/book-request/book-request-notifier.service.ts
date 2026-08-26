import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, Permission } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { LibraryService } from '../library/library.service';
import { NotificationService } from '../notification/notification.service';
import { ContentFilterRepository } from '../user/content-filter.repository';
import { BookRequestRepository } from './book-request.repository';

export interface RequestNotification {
  title: string;
  message: string;
  actionUrl?: string;
  meta?: Record<string, unknown>;
}

/**
 * One place for the two audiences this feature notifies, so the grab pipeline and the approval
 * flow cannot drift on who hears about what. A failed notification never fails the operation that
 * triggered it: a book that landed has landed whether or not the mail went out.
 */
@Injectable()
export class BookRequestNotifier {
  private readonly logger = new Logger(BookRequestNotifier.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly repo: BookRequestRepository,
    private readonly libraries: LibraryService,
    private readonly contentFilters: ContentFilterRepository,
  ) {}

  /** Everyone who can act on the queue, resolved by permission rather than by enumerating users. */
  async notifyApprovers(type: NotificationType, payload: RequestNotification): Promise<void> {
    await this.dispatch(type, { ...payload, scope: { kind: 'permission', permission: Permission.ManageBookRequests } });
  }

  /**
   * Who hears about one request going wrong.
   *
   * A self-serve row is nobody's queue item. Its owner picked the release, is the only person who
   * can act on what happened to it, and was deliberately kept out of the moderation queue on the
   * way in; telling every approver about it would be noise about work that is not theirs.
   */
  async notifyResponsible(request: { id: number; selfServe: boolean }, type: NotificationType, payload: RequestNotification): Promise<void> {
    if (request.selfServe) return this.notifyInterested(request.id, type, payload);
    return this.notifyApprovers(type, payload);
  }

  /** The requester plus every subscriber: everyone who put their name against this book. */
  async notifyInterested(requestId: number, type: NotificationType, payload: RequestNotification): Promise<void> {
    const userIds = await this.repo.findInterestedUserIds(requestId);
    for (const userId of userIds) {
      await this.dispatch(type, { ...payload, scope: { kind: 'user', userId } });
    }
  }

  /**
   * The same audience, told that their book landed, with the link resolved for each of them.
   *
   * Where a request files is deliberately allowed to be a library the requester cannot read: the
   * operator chose the instance default for the whole instance, and somebody who cannot see it is
   * exactly who it exists for. Saying so with a link that answers 403 is not deliberate. Anybody
   * who can open the book is sent to the book; everybody else is sent to their request list,
   * which is theirs whatever the destination turned out to be.
   *
   * Library access is only the first gate. Content restrictions hide individual books inside a
   * library somebody can otherwise open, so a restricted reader was still being handed a link to
   * a book their own queries refuse to return. Somebody exempted from their restrictions for
   * their own requests can open this one by definition, since this is one. The remaining case,
   * a restricted reader whose rules happen to admit this book anyway, is sent to the request list
   * rather than resolved exactly: one extra click beats a link that answers nothing.
   */
  async notifyBookAvailable(requestId: number, bookId: number | null, payload: Omit<RequestNotification, 'actionUrl'>): Promise<void> {
    const userIds = await this.repo.findInterestedUserIds(requestId);
    const libraryId = bookId === null ? null : await this.repo.findBookLibraryId(bookId);
    const reachers = libraryId === null ? new Set<number>() : await this.libraries.findUserIdsWithAccess(libraryId, userIds);

    const restricted = await this.contentFilters.hasAnyContentFilters([...reachers]);
    const exempt = restricted.size > 0 ? await this.contentFilters.findExemptUserIds([...restricted]) : new Set<number>();

    for (const userId of userIds) {
      const canOpen = reachers.has(userId) && (!restricted.has(userId) || exempt.has(userId));
      const actionUrl = bookId !== null && canOpen ? `/book/${bookId}` : '/requests';
      await this.dispatch(NotificationType.BookRequestAvailable, { ...payload, actionUrl, scope: { kind: 'user', userId } });
    }
  }

  private async dispatch(
    type: NotificationType,
    payload: RequestNotification & { scope: Parameters<NotificationService['notify']>[0]['scope'] },
  ): Promise<void> {
    await this.notifications.notify({ type, ...payload }).catch((err: unknown) => {
      const message = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(`[book_request.notify] [fail] type=${type} error="${message}" - notification dispatch failed`);
    });
  }
}
