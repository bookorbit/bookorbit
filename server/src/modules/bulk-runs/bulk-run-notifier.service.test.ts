import { NotificationType } from '@bookorbit/types';

import { BulkRunNotifier } from './bulk-run-notifier.service';
import type { EndedBulkRun } from './bulk-runs.repository';

function ended(change: Partial<EndedBulkRun> = {}): EndedBulkRun {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'book-refresh-metadata',
    requestedBy: 7,
    status: 'completed',
    errorCode: null,
    total: 40,
    processed: 40,
    succeeded: 38,
    failed: 0,
    skipped: 2,
    ...change,
  };
}

function setup() {
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  return { notifier: new BulkRunNotifier(notifications as never), notifications };
}

const UNWATCHED = { watched: false, completionHandled: false };

describe('BulkRunNotifier', () => {
  it('tells the requester about a run that completed after its tab stopped watching', async () => {
    const { notifier, notifications } = setup();
    await notifier.ended(ended(), UNWATCHED);

    expect(notifications.notify).toHaveBeenCalledWith({
      type: NotificationType.BulkRunCompleted,
      title: 'Finished: Refresh book metadata',
      message: '40 items done.',
      actionUrl: '/jobs/activity?view=history&type=bulk-run',
      meta: {
        runId: '11111111-1111-4111-8111-111111111111',
        kind: 'book-refresh-metadata',
        total: 40,
        processed: 40,
        succeeded: 38,
        failed: 0,
        skipped: 2,
        code: null,
      },
      scope: { kind: 'user', userId: 7 },
    });
  });

  it('marks a completed run with failed items as a warning', async () => {
    const { notifier, notifications } = setup();
    await notifier.ended(ended({ succeeded: 35, failed: 3 }), UNWATCHED);

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: NotificationType.BulkRunCompletedWithErrors, message: '3 of 40 items failed.' }),
    );
  });

  it('stays quiet about a completed run a tab watched, or one its kind reports itself', async () => {
    const { notifier, notifications } = setup();
    await notifier.ended(ended(), { watched: true, completionHandled: false });
    await notifier.ended(ended({ kind: 'book-move' }), { watched: false, completionHandled: true });

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('always reports a run that stopped, watched or not, and never a cancelled one', async () => {
    const { notifier, notifications } = setup();
    await notifier.ended(ended({ status: 'failed', errorCode: 'credential-revoked' }), { watched: true, completionHandled: true });
    await notifier.ended(ended({ status: 'cancelled' }), UNWATCHED);

    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.BulkRunFailed,
        title: "Couldn't finish: Refresh book metadata",
        message: 'Stopped: the API key that started it was revoked or has expired.',
        actionUrl: '/jobs/activity?view=failed&type=bulk-run',
        meta: expect.objectContaining({ code: 'credential-revoked' }),
      }),
    );
  });

  it('has nobody to tell when the requester is gone', async () => {
    const { notifier, notifications } = setup();
    await notifier.ended(ended({ status: 'failed', errorCode: 'requester-gone' }), UNWATCHED);
    await notifier.ended(ended({ requestedBy: null }), UNWATCHED);
    await notifier.interrupted([ended({ status: 'interrupted', requestedBy: null })]);

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('reports each run a restart cut short', async () => {
    const { notifier, notifications } = setup();
    await notifier.interrupted([
      ended({ id: 'a', status: 'interrupted', processed: 12 }),
      ended({ id: 'b', kind: 'book-move', status: 'interrupted', requestedBy: 9 }),
    ]);

    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.BulkRunInterrupted,
        title: 'Interrupted: Move books',
        actionUrl: '/jobs/activity?view=failed&type=bulk-run',
        scope: { kind: 'user', userId: 9 },
      }),
    );
  });

  it('never lets a failed delivery escape', async () => {
    const { notifier, notifications } = setup();
    notifications.notify.mockRejectedValueOnce(new Error('db down'));

    await expect(notifier.ended(ended({ status: 'failed', errorCode: 'error' }), UNWATCHED)).resolves.toBeUndefined();
  });
});
