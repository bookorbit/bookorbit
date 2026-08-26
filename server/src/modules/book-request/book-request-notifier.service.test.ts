import { NotificationType, Permission } from '@bookorbit/types';

import { BookRequestNotifier } from './book-request-notifier.service';

function makeNotifier(
  interested: number[] = [3, 4],
  reachers: number[] = interested,
  libraryId: number | null = 5,
  restricted: number[] = [],
  exempt: number[] = [],
) {
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  const repo = {
    findInterestedUserIds: vi.fn().mockResolvedValue(interested),
    findBookLibraryId: vi.fn().mockResolvedValue(libraryId),
  };
  const libraries = { findUserIdsWithAccess: vi.fn().mockResolvedValue(new Set(reachers)) };
  const contentFilters = {
    hasAnyContentFilters: vi.fn().mockResolvedValue(new Set(restricted)),
    findExemptUserIds: vi.fn().mockResolvedValue(new Set(exempt)),
  };
  return {
    notifier: new BookRequestNotifier(notifications as never, repo as never, libraries as never, contentFilters as never),
    notifications,
    repo,
    libraries,
    contentFilters,
  };
}

const payload = { title: 'Book request download failed', message: '"Dune": the tracker went away' };

describe('BookRequestNotifier.notifyResponsible', () => {
  it('tells the approvers about an ordinary request', async () => {
    const { notifier, notifications } = makeNotifier();

    await notifier.notifyResponsible({ id: 7, selfServe: false }, NotificationType.BookRequestFailed, payload);

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { kind: 'permission', permission: Permission.ManageBookRequests } }),
    );
  });

  /**
   * A self-serve row was deliberately kept out of the moderation queue on the way in. Telling every
   * approver when it goes wrong would put it back there, about work only its owner can act on.
   */
  it('tells the owner, and not the approvers, about a self-serve request', async () => {
    const { notifier, notifications } = makeNotifier([3]);

    await notifier.notifyResponsible({ id: 7, selfServe: true }, NotificationType.BookRequestFailed, payload);

    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ scope: { kind: 'user', userId: 3 } }));
  });

  it('reaches every subscriber of a self-serve request, not only its creator', async () => {
    const { notifier, notifications } = makeNotifier([3, 4]);

    await notifier.notifyResponsible({ id: 7, selfServe: true }, NotificationType.BookRequestNeedsReview, payload);

    expect(notifications.notify).toHaveBeenCalledTimes(2);
  });
});

/**
 * Where a request files is allowed to be a library the requester cannot read; saying so with a
 * link that answers 403 is not. Both halves are asserted in one place because the two paths that
 * announce a filed book - automatic import and closing by hand - go through this method.
 */
describe('BookRequestNotifier.notifyBookAvailable', () => {
  const available = { title: 'Your requested book is available', message: '"Dune" is ready' };

  it('links straight to the book for a recipient who can open it', async () => {
    const { notifier, notifications } = makeNotifier([3], [3]);

    await notifier.notifyBookAvailable(7, 42, available);

    expect(notifications.notify).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ actionUrl: '/book/42', scope: { kind: 'user', userId: 3 } }),
    );
  });

  it('sends a recipient who cannot reach the destination to their request list instead', async () => {
    const { notifier, notifications } = makeNotifier([3, 4], [3]);

    await notifier.notifyBookAvailable(7, 42, available);

    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ actionUrl: '/book/42', scope: { kind: 'user', userId: 3 } }));
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ actionUrl: '/requests', scope: { kind: 'user', userId: 4 } }));
  });

  it('sends everyone to the request list when nothing was filed as a book', async () => {
    const { notifier, notifications, libraries } = makeNotifier([3, 4]);

    await notifier.notifyBookAvailable(7, null, available);

    expect(libraries.findUserIdsWithAccess).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ actionUrl: '/requests' }));
  });

  /** A book row with no library is a row nothing can be opened through, so nobody gets its link. */
  it('sends everyone to the request list when the book names no library', async () => {
    const { notifier, notifications } = makeNotifier([3], [3], null);

    await notifier.notifyBookAvailable(7, 42, available);

    expect(notifications.notify).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actionUrl: '/requests' }));
  });
});

describe('BookRequestNotifier.notifyBookAvailable content restrictions', () => {
  it('sends a restricted recipient to their request list, not to a book their rules hide', async () => {
    const { notifier, notifications } = makeNotifier([3], [3], 5, [3], []);

    await notifier.notifyBookAvailable(7, 55, payload);

    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ actionUrl: '/requests', scope: { kind: 'user', userId: 3 } }));
  });

  it('links a restricted recipient straight to the book when they are exempt for their own requests', async () => {
    const { notifier, notifications } = makeNotifier([3], [3], 5, [3], [3]);

    await notifier.notifyBookAvailable(7, 55, payload);

    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ actionUrl: '/book/55', scope: { kind: 'user', userId: 3 } }));
  });
});
