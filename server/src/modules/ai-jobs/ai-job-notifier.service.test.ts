import { NotificationType } from '@bookorbit/types';

import { AiJobNotifier, jobInfo } from './ai-job-notifier.service';
import { createRunnerHarness } from './testing/in-memory-ai-jobs';

function makeNotifier() {
  const h = createRunnerHarness();
  const notifications = { notify: vi.fn(() => Promise.resolve()) };
  const notifier = new AiJobNotifier(h.registry, h.users, notifications as never);
  return { h, notifications, notifier };
}

describe('AiJobNotifier.notify', () => {
  it('sends the feature notice to the requester, with the job in its meta', async () => {
    const n = makeNotifier();
    const row = n.h.job(2, { status: 'completed' });
    await n.notifier.notify(row, 'completed');
    expect(n.notifications.notify).toHaveBeenCalledTimes(1);
    expect(n.notifications.notify).toHaveBeenCalledWith({
      type: NotificationType.ReadAloudReady,
      title: 'Fake guide ready',
      actionUrl: `/book/${String(row.subjectRef.bookId)}`,
      meta: { bookId: row.subjectRef.bookId, jobId: row.id, feature: row.feature, kind: 'build', reason: null },
      scope: { kind: 'user', userId: row.requestedBy },
    });
    expect(n.h.featureState.notices).toEqual([{ jobId: row.id, outcome: 'completed', reason: null }]);
  });

  it('passes the failure reason, and error when none was stored', async () => {
    const n = makeNotifier();
    await n.notifier.notify(n.h.job(2, { status: 'failed', reason: 'low-coverage' }), 'failed');
    await n.notifier.notify(n.h.job(2, { status: 'failed', reason: null }), 'failed');
    expect(n.h.featureState.notices.map((notice) => notice.reason)).toEqual(['low-coverage', 'error']);
    expect(n.notifications.notify).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: NotificationType.ReadAloudFailed, meta: expect.objectContaining({ reason: 'error' }) }),
    );
  });

  it('includes a message only when the notice has one', async () => {
    const n = makeNotifier();
    n.h.feature.notice = () => Promise.resolve({ type: NotificationType.ReadAloudReady, title: 'Done', message: 'All set', meta: {} });
    const row = n.h.job();
    await n.notifier.notify(row, 'completed');
    expect(n.notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ message: 'All set' }));
    expect(n.notifications.notify).toHaveBeenCalledWith(expect.not.objectContaining({ actionUrl: expect.anything() }));
  });

  it('sends nothing when the feature has no notice for the outcome', async () => {
    const n = makeNotifier();
    n.h.feature.notice = () => Promise.resolve(null);
    await n.notifier.notify(n.h.job(), 'completed');
    expect(n.notifications.notify).not.toHaveBeenCalled();
  });

  it('sends nothing for a job without a requester or of an unknown feature', async () => {
    const n = makeNotifier();
    await n.notifier.notify(n.h.job(2, { requestedBy: null }), 'completed');
    await n.notifier.notify(n.h.job(2, { feature: 'gone' }), 'completed');
    expect(n.notifications.notify).not.toHaveBeenCalled();
  });

  it.each([
    ['deleted', (n: ReturnType<typeof makeNotifier>, id: number) => n.h.people.delete(id)],
    ['inactive', (n: ReturnType<typeof makeNotifier>, id: number) => n.h.people.set(id, { ...n.h.people.get(id)!, active: false })],
    ['without the permission', (n: ReturnType<typeof makeNotifier>, id: number) => n.h.people.set(id, { ...n.h.people.get(id)!, permissions: [] })],
    ['out of reach of the book', (n: ReturnType<typeof makeNotifier>) => (n.h.featureState.reachable = () => false)],
  ])('does not tell a requester who is now %s', async (_label, change) => {
    const n = makeNotifier();
    const row = n.h.job();
    change(n, row.requestedBy!);
    await n.notifier.notify(row, 'failed');
    expect(n.notifications.notify).not.toHaveBeenCalled();
  });

  it('never throws when the notification cannot be sent', async () => {
    const n = makeNotifier();
    n.notifications.notify.mockRejectedValueOnce(new Error('database down'));
    await expect(n.notifier.notify(n.h.job(), 'completed')).resolves.toBeUndefined();
  });
});

describe('jobInfo', () => {
  it('gives a feature the job fields it may read, with no models as an empty record', () => {
    const h = createRunnerHarness();
    const row = h.job();
    expect(jobInfo(row)).toEqual({
      id: row.id,
      feature: row.feature,
      kind: 'build',
      subjectKey: row.subjectKey,
      subjectRef: row.subjectRef,
      generation: 1,
      models: {},
    });
  });
});
