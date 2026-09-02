import type { BookRequestDownloadRow } from '../../../db/schema';
import { USER_DELETING, UserEventsService, type UserDeletingEvent } from '../../user/user-events.service';
import { RequestUserCleanupService } from './request-user-cleanup.service';

function attempt(overrides: Partial<BookRequestDownloadRow> = {}): BookRequestDownloadRow {
  return { id: 11, requestId: 5, clientHash: 'a'.repeat(40), source: 'torrent_file', downloadClientId: 2, ...overrides } as BookRequestDownloadRow;
}

function makeService(rows: BookRequestDownloadRow[] = []) {
  const users = new UserEventsService();
  const downloads = { findInFlightForOwner: vi.fn().mockResolvedValue(rows) };
  const removal = { detachAttempt: vi.fn().mockResolvedValue(null) };

  const service = new RequestUserCleanupService(users, downloads as never, removal as never);
  service.onModuleInit();
  return { users, downloads, removal };
}

/** The emitter's own contract: a listener registers work, and the deletion waits for it. */
async function announce(users: UserEventsService, userId: number): Promise<void> {
  const pending: Promise<void>[] = [];
  const event: UserDeletingEvent = { userId, waitFor: (work) => pending.push(work) };
  users.emit(USER_DELETING, event);
  await Promise.allSettled(pending);
}

/**
 * Deleting an account cascades its requests and every attempt behind them away, so this is the
 * last moment anything knows which torrents and staged files were theirs.
 */
describe('RequestUserCleanupService', () => {
  it('detaches every live attempt behind the deleted account, before the cascade takes the rows', async () => {
    const { users, downloads, removal } = makeService([attempt({ id: 11 }), attempt({ id: 12 })]);

    await announce(users, 3);

    expect(downloads.findInFlightForOwner).toHaveBeenCalledWith(3);
    expect(removal.detachAttempt).toHaveBeenCalledTimes(2);
  });

  /** The same split cancelling makes: a seeding torrent is worth keeping, partial staging is not. */
  it('keeps torrent data rather than deleting what the swarm and the import both rely on', async () => {
    const { users, removal } = makeService([attempt()]);

    await announce(users, 3);

    expect(removal.detachAttempt).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }), false);
  });

  /** A client that is down is a reason to report one leaked torrent, not to leave the rest running. */
  it('carries on through a client that refuses one of them', async () => {
    const { users, removal } = makeService([attempt({ id: 11 }), attempt({ id: 12 })]);
    removal.detachAttempt.mockResolvedValueOnce('the client is unreachable');

    await announce(users, 3);

    expect(removal.detachAttempt).toHaveBeenCalledTimes(2);
  });

  it('asks the client nothing when the account had no live downloads', async () => {
    const { users, removal } = makeService();

    await announce(users, 3);

    expect(removal.detachAttempt).not.toHaveBeenCalled();
  });
});
