import { NotFoundException } from '@nestjs/common';
import { NotificationType } from '@bookorbit/types';

import { ReadAloudNotifier, type ReadAloudOutcome } from './read-aloud-notifier.service';
import { JOB_ID, jobRow, OWNER } from './test-helpers';

function makeNotifier(options: { bookTitle?: string | null; user?: unknown } = {}) {
  const jobs = { findBookTitle: vi.fn().mockResolvedValue(options.bookTitle === undefined ? 'The Hobbit' : options.bookTitle) };
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  const users = { findByIdWithPermissions: vi.fn().mockResolvedValue(options.user === undefined ? OWNER : options.user) };
  const books = { verifyBookAccess: vi.fn().mockResolvedValue(undefined) };
  const presenter = { present: vi.fn((row: { id: string }) => Promise.resolve({ id: row.id })) };
  const gateway = { emitJobUpdated: vi.fn() };
  const notifier = new ReadAloudNotifier(jobs as never, presenter as never, gateway as never, notifications as never, users as never, books as never);
  return { notifier, notifications, users, books, gateway };
}

describe('ReadAloudNotifier.notify', () => {
  it.each<[ReadAloudOutcome, NotificationType]>([
    ['ready', NotificationType.ReadAloudReady],
    ['needs_review', NotificationType.ReadAloudNeedsReview],
    ['failed', NotificationType.ReadAloudFailed],
    ['review_expiring', NotificationType.ReadAloudReviewExpiring],
  ])('stores what the client needs to phrase a %s notification in the reader’s locale', async (outcome, type) => {
    const { notifier, notifications } = makeNotifier();
    await notifier.notify(jobRow({ status: 'failed', errorCode: 'inference_failed' }), outcome);

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type,
        actionUrl: '/book/12/files',
        scope: { kind: 'user', userId: OWNER.id },
        meta: { jobId: JOB_ID, bookId: 12, bookTitle: 'The Hobbit', errorCode: 'inference_failed' },
      }),
    );
  });

  it('keeps an English title and reason as the fallback for clients that do not know the type', async () => {
    const { notifier, notifications } = makeNotifier();
    await notifier.notify(jobRow({ status: 'failed', errorCode: 'insufficient_storage' }), 'failed');

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Read-aloud failed: The Hobbit', message: 'Reason: insufficient storage' }),
    );
  });

  it.each([null, '', '   '])('sends a null book title for %j, so the client can say "untitled" in its own language', async (stored) => {
    const { notifier, notifications } = makeNotifier({ bookTitle: stored });
    await notifier.notify(jobRow({ status: 'completed' }), 'ready');

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Read-aloud ready: Untitled book', meta: expect.objectContaining({ bookTitle: null, errorCode: null }) }),
    );
  });

  it('trims the stored book title', async () => {
    const { notifier, notifications } = makeNotifier({ bookTitle: '  Dune \n' });
    await notifier.notify(jobRow(), 'ready');
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ bookTitle: 'Dune' }) }));
  });

  it.each([
    ['an inactive requester', { ...OWNER, active: false }],
    ['a requester who lost the permission', { ...OWNER, permissions: [] }],
    ['a deleted requester', null],
  ])('says nothing to %s', async (_label, user) => {
    const { notifier, notifications } = makeNotifier({ user });
    await notifier.notify(jobRow(), 'ready');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('says nothing to a requester who can no longer reach the book', async () => {
    const { notifier, notifications, books } = makeNotifier();
    books.verifyBookAccess.mockRejectedValue(new NotFoundException());
    await notifier.notify(jobRow(), 'ready');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('never fails the job when the notification cannot be stored', async () => {
    const { notifier, notifications } = makeNotifier();
    notifications.notify.mockRejectedValue(new Error('database is down'));
    await expect(notifier.notify(jobRow(), 'ready')).resolves.toBeUndefined();
  });
});

describe('ReadAloudNotifier.pushUpdate', () => {
  it('stops pushing to a requester who lost the book, and re-checks one who has it only once a minute', async () => {
    vi.useFakeTimers();
    try {
      const { notifier, gateway, books, users } = makeNotifier();
      await notifier.pushUpdate(jobRow());
      await notifier.pushUpdate(jobRow());
      expect(gateway.emitJobUpdated).toHaveBeenCalledTimes(2);
      expect(users.findByIdWithPermissions).toHaveBeenCalledTimes(1);

      books.verifyBookAccess.mockRejectedValue(new NotFoundException());
      vi.advanceTimersByTime(61_000);
      await notifier.pushUpdate(jobRow());
      expect(gateway.emitJobUpdated).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops pushing to a requester whose permission was revoked', async () => {
    const { notifier, gateway } = makeNotifier({ user: { ...OWNER, permissions: [] } });
    await notifier.pushUpdate(jobRow());
    expect(gateway.emitJobUpdated).not.toHaveBeenCalled();
  });
});
