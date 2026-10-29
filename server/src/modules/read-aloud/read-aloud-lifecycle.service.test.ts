import { ReadAloudLifecycleService } from './read-aloud-lifecycle.service';
import { jobRow } from './test-helpers';
import { READ_ALOUD_MAX_ATTEMPTS } from './read-aloud.constants';

const KEEP = '00000000-0000-4000-8000-00000000000a';
const ORPHAN = '00000000-0000-4000-8000-00000000000b';

function setup() {
  const jobs = {
    recoverExpiredLeases: vi.fn().mockResolvedValue({ cancelledIds: [], requeuedIds: [], failed: [] }),
    findReviewsToRemind: vi.fn().mockResolvedValue([]),
    markReminded: vi.fn().mockResolvedValue(undefined),
    expireReviews: vi.fn().mockResolvedValue([]),
    clearExpiredWorkWindows: vi.fn().mockResolvedValue(undefined),
    findJobIdsKeepingWork: vi.fn().mockResolvedValue(new Set([KEEP])),
  };
  const workspace = {
    ensureRoot: vi.fn().mockResolvedValue(undefined),
    listJobIds: vi.fn().mockResolvedValue([KEEP, ORPHAN]),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const worker = { cancel: vi.fn().mockResolvedValue(undefined) };
  const activity = { record: vi.fn().mockResolvedValue(undefined) };
  const notifier = { notify: vi.fn().mockResolvedValue(undefined), pushUpdate: vi.fn().mockResolvedValue(undefined) };
  const service = new ReadAloudLifecycleService(jobs as never, workspace as never, worker as never, activity as never, notifier as never);
  return { service, jobs, workspace, worker, activity, notifier };
}

describe('ReadAloudLifecycleService', () => {
  it('stops orphaned worker runs for jobs cancelled while their server was down', async () => {
    const t = setup();
    t.jobs.recoverExpiredLeases.mockResolvedValue({ cancelledIds: [ORPHAN], requeuedIds: [KEEP], failed: [] });
    await t.service.recoverExpiredJobs();
    expect(t.worker.cancel).toHaveBeenCalledWith(ORPHAN);
    expect(t.workspace.remove).toHaveBeenCalledWith(ORPHAN);
    expect(t.workspace.remove).not.toHaveBeenCalledWith(KEEP);
    expect(t.activity.record).toHaveBeenCalledWith(KEEP, 'warn', 'queued', 'recovered', expect.any(String));
  });

  it('fails a job that keeps losing its server, keeping its work for Retry', async () => {
    const t = setup();
    const failed = jobRow({ id: ORPHAN, status: 'failed', errorCode: 'unknown', attemptCount: READ_ALOUD_MAX_ATTEMPTS });
    t.jobs.recoverExpiredLeases.mockResolvedValue({ cancelledIds: [], requeuedIds: [], failed: [failed] });
    await t.service.recoverExpiredJobs();
    expect(t.jobs.recoverExpiredLeases).toHaveBeenCalledWith(READ_ALOUD_MAX_ATTEMPTS, expect.any(Date));
    expect(t.worker.cancel).toHaveBeenCalledWith(ORPHAN);
    expect(t.workspace.remove).not.toHaveBeenCalled();
    expect(t.activity.record).toHaveBeenCalledWith(ORPHAN, 'error', null, 'unknown', expect.any(String));
    expect(t.notifier.pushUpdate).toHaveBeenCalledWith(failed);
    expect(t.notifier.notify).toHaveBeenCalledWith(failed, 'failed');
  });

  it('removes work folders no live or retryable job owns', async () => {
    const t = setup();
    await t.service.sweep();
    expect(t.workspace.remove).toHaveBeenCalledWith(ORPHAN);
    expect(t.workspace.remove).not.toHaveBeenCalledWith(KEEP);
    expect(t.jobs.clearExpiredWorkWindows).toHaveBeenCalled();
  });

  it('reminds once before discarding an unreviewed output', async () => {
    const t = setup();
    const waiting = jobRow({ id: KEEP, status: 'awaiting_review' });
    t.jobs.findReviewsToRemind.mockResolvedValue([waiting]);
    t.jobs.expireReviews.mockResolvedValue([jobRow({ id: ORPHAN, status: 'cancelled', errorCode: 'review_expired' })]);
    await t.service.sweep();
    expect(t.jobs.markReminded).toHaveBeenCalledWith(KEEP);
    expect(t.notifier.notify).toHaveBeenCalledWith(waiting, 'review_expiring');
    expect(t.workspace.remove).toHaveBeenCalledWith(ORPHAN);
    expect(t.notifier.pushUpdate).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'review_expired' }));
  });
});
