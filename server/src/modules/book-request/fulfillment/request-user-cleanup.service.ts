import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { USER_DELETING, UserEventsService, type UserDeletingEvent } from '../../user/user-events.service';
import { BookRequestDownloadRepository, MAX_DETACH_ON_OWNER_DELETE } from './book-request-download.repository';
import { DownloadRemovalService } from './download-removal.service';

/**
 * Stops the transfers behind a deleted account's requests, before the account takes their tracking
 * rows with it.
 *
 * `book_requests.user_id` cascades, and every attempt hangs off the request, so deleting somebody
 * removes the only record of which torrents and which staged files were theirs. The client goes on
 * seeding a torrent nothing points at, and a direct download this process is still writing goes on
 * writing. Detaching first is the only moment either is still findable.
 *
 * Its own service rather than a branch in `UserService`, because the user module must not learn
 * what a book request is: the dependency runs one way, from here to the event the user module
 * publishes.
 */
@Injectable()
export class RequestUserCleanupService implements OnModuleInit {
  private readonly logger = new Logger(RequestUserCleanupService.name);

  constructor(
    private readonly users: UserEventsService,
    private readonly downloads: BookRequestDownloadRepository,
    private readonly removal: DownloadRemovalService,
  ) {}

  onModuleInit(): void {
    this.users.on(USER_DELETING, (event: UserDeletingEvent) => {
      event.waitFor(this.detachOwnedWork(event.userId));
    });
  }

  /**
   * Torrent data is kept and staged files are dropped, which is the same split cancelling a
   * request makes: a seeding torrent is worth something to the swarm and to whoever imported it,
   * while partial staging is worth nothing to anybody.
   *
   * Every attempt is tried even when one refuses. A download client that is down is a reason to
   * report one leaked torrent, not to leave the rest of them running too.
   */
  private async detachOwnedWork(userId: number): Promise<void> {
    const rows = await this.downloads.findInFlightForOwner(userId);
    if (rows.length === 0) return;

    let detached = 0;
    const refusals: string[] = [];
    for (const row of rows) {
      const error = await this.removal.detachAttempt(row, false);
      if (error === null) detached++;
      else refusals.push(error);
    }

    // A truncated pass must not read as a complete one: whatever is past the bound goes on running
    // with its tracking rows already gone, and the log line is the only place that can say so.
    const truncated = rows.length === MAX_DETACH_ON_OWNER_DELETE;
    const level = refusals.length > 0 || truncated ? 'warn' : 'log';
    this.logger[level](
      `[book_request.owner_delete] [end] userId=${userId} attempts=${rows.length} detached=${detached} refused=${refusals.length} truncated=${truncated}` +
        (refusals[0] ? ` error="${sanitizeLogValue(refusals[0])}"` : '') +
        ' - stopped the downloads behind a deleted account',
    );
  }
}
