import { ForbiddenException } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { AiJobRow } from '../../db/schema';
import type { AiJobListRow } from './ai-job.repository';
import { AiJobQueueService } from './ai-job-queue.service';
import { createRunnerHarness } from './testing/in-memory-ai-jobs';

function makeQueue() {
  const h = createRunnerHarness();
  const jobs = {
    list: vi.fn((): Promise<{ rows: AiJobListRow[]; total: number }> => Promise.resolve({ rows: [], total: 0 })),
    countViews: vi.fn(() => Promise.resolve({ queue: 0, failed: 0, history: 0 })),
    queuePositions: vi.fn((): Promise<Map<string, number>> => Promise.resolve(new Map())),
    findByIds: vi.fn((): Promise<AiJobRow[]> => Promise.resolve([])),
    findById: vi.fn((): Promise<AiJobRow | null> => Promise.resolve(null)),
  };
  const service = {
    cancelJob: vi.fn((id: string) => Promise.resolve({ kind: 'cancelled', job: { id, status: 'cancelled', reason: null } })),
    pauseJob: vi.fn((id: string) => Promise.resolve({ id, status: 'paused', reason: 'user' } as AiJobRow | null)),
    dismissJob: vi.fn((id: string) => Promise.resolve({ id, status: 'failed', reason: 'error' } as AiJobRow | null)),
    prioritizeJob: vi.fn((id: string) => Promise.resolve({ id, status: 'queued', reason: null } as AiJobRow | null)),
    retryJob: vi.fn((id: string) => Promise.resolve({ kind: 'resumed', job: { id, status: 'queued', reason: null } }) as Promise<unknown>),
  };
  const queue = new AiJobQueueService(h.registry, jobs as never, service as never);
  const owner = h.user();
  const manager = h.user({ permissions: [Permission.ManageAppSettings] });
  const row = (change: Partial<AiJobListRow> = {}): AiJobListRow => ({
    ...h.job(1, { status: 'queued', requestedBy: owner.id, costMicros: 1_500_000, ...change }),
    requesterName: 'Sam Whitfield',
    ...change,
  });
  return { h, jobs, service, queue, owner, manager, row };
}

const PAGE = { view: 'queue', scope: 'mine', offset: 0, limit: 50 } as const;

describe('AiJobQueueService.list', () => {
  it("lists the viewer's own jobs, with place, label and the actions they may take", async () => {
    const q = makeQueue();
    const queued = q.row();
    const paused = q.row({ status: 'paused', reason: 'over-estimate' });
    q.jobs.list.mockResolvedValueOnce({ rows: [queued, paused], total: 2 });
    q.jobs.countViews.mockResolvedValueOnce({ queue: 2, failed: 1, history: 4 });
    q.jobs.queuePositions.mockResolvedValueOnce(new Map([[queued.id, 3]]));

    const list = await q.queue.list(q.owner, PAGE);

    expect(q.jobs.list).toHaveBeenCalledWith(expect.objectContaining({ features: [q.h.feature.id], requestedBy: q.owner.id }), 'queue', 0, 50);
    expect(list.total).toBe(2);
    expect(list.counts).toEqual({ queue: 2, failed: 1, history: 4 });
    expect(list.items[0]).toMatchObject({
      id: queued.id,
      position: 3,
      subject: { label: 'Book 1', byline: null, url: '/book/1', image: null },
      requester: { id: q.owner.id, name: 'Sam Whitfield' },
      cost: null,
      actions: ['cancel', 'pause'],
    });
    expect(list.items[1]).toMatchObject({ position: null, actions: ['cancel', 'resume'] });
  });

  it('lets a manager list every account, with what each job spent, and move queued jobs to the front', async () => {
    const q = makeQueue();
    q.jobs.list.mockResolvedValueOnce({ rows: [q.row()], total: 1 });
    const list = await q.queue.list(q.manager, { ...PAGE, scope: 'all' });
    expect(q.jobs.list).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: null }), 'queue', 0, 50);
    // A manager without the feature's permission cannot hand the job to themselves by resuming it.
    expect(list.items[0]).toMatchObject({ cost: 1.5, actions: ['cancel', 'pause', 'prioritize'] });
  });

  it('refuses every account to someone who does not manage the server', async () => {
    const q = makeQueue();
    await expect(q.queue.list(q.owner, { ...PAGE, scope: 'all' })).rejects.toThrow(ForbiddenException);
    expect(q.jobs.list).not.toHaveBeenCalled();
  });

  it('hides the label of a subject the viewer can no longer reach', async () => {
    const q = makeQueue();
    const row = q.row();
    q.h.featureState.reachable = (_user: RequestUser, ref) => ref.bookId !== row.subjectRef.bookId;
    q.jobs.list.mockResolvedValue({ rows: [row], total: 1 });
    expect((await q.queue.list(q.owner, PAGE)).items[0]!.subject).toEqual({ label: null, byline: null, url: null, image: null });

    expect((await q.queue.list(q.manager, { ...PAGE, scope: 'all' })).items[0]!.subject).toEqual({
      label: 'Book 1',
      byline: null,
      url: '/book/1',
      image: null,
    });
  });

  it('offers Try again and Dismiss on a failed job still shown, and nothing on an ended one', async () => {
    const q = makeQueue();
    q.jobs.list.mockResolvedValueOnce({
      rows: [q.row({ status: 'failed', reason: 'error', finishedAt: new Date() }), q.row({ status: 'completed', finishedAt: new Date() })],
      total: 2,
    });
    const list = await q.queue.list(q.owner, { ...PAGE, view: 'failed' });
    expect(list.items.map((item) => item.actions)).toEqual([['retry', 'dismiss'], []]);
  });
});

describe('AiJobQueueService.act', () => {
  it('acts on each job the viewer owns and says what happened to each', async () => {
    const q = makeQueue();
    const queued = q.row();
    const running = q.row({ status: 'running' });
    q.jobs.findByIds.mockResolvedValueOnce([queued, running]);
    q.service.pauseJob.mockResolvedValueOnce({ id: queued.id, status: 'paused', reason: 'user' } as AiJobRow).mockResolvedValueOnce(null);
    q.jobs.findById.mockResolvedValueOnce({ ...running, status: 'completed' });

    const { results } = await q.queue.act(q.owner, 'pause', [queued.id, running.id, queued.id]);

    expect(results).toEqual([
      { id: queued.id, outcome: 'done', status: 'paused', reason: 'user' },
      { id: running.id, outcome: 'skipped', status: 'completed', reason: null },
    ]);
    expect(q.service.pauseJob).toHaveBeenCalledTimes(2);
  });

  it("answers not-found for another account's job, unless the viewer manages the server", async () => {
    const q = makeQueue();
    const other = q.row({ requestedBy: 999 });
    q.jobs.findByIds.mockResolvedValue([other]);
    expect((await q.queue.act(q.owner, 'cancel', [other.id, 'missing'])).results.map((result) => result.outcome)).toEqual(['not-found', 'not-found']);
    expect(q.service.cancelJob).not.toHaveBeenCalled();

    expect((await q.queue.act(q.manager, 'cancel', [other.id])).results[0]).toMatchObject({ outcome: 'done', status: 'cancelled' });
  });

  it('answers not-found for a job of another feature when the request is limited to one', async () => {
    const q = makeQueue();
    const job = q.row();
    q.jobs.findByIds.mockResolvedValue([job]);
    expect((await q.queue.act(q.manager, 'cancel', [job.id], 'another-feature')).results[0]).toMatchObject({ outcome: 'not-found' });
    expect(q.service.cancelJob).not.toHaveBeenCalled();
    expect((await q.queue.act(q.manager, 'cancel', [job.id], job.feature)).results[0]).toMatchObject({ outcome: 'done' });
  });

  it('skips a job whose status the action does not apply to, and refuses an action the viewer may not take', async () => {
    const q = makeQueue();
    const running = q.row({ status: 'running' });
    q.jobs.findByIds.mockResolvedValue([running]);
    expect((await q.queue.act(q.owner, 'prioritize', [running.id])).results[0]!.outcome).toBe('skipped');
    const queued = q.row();
    q.jobs.findByIds.mockResolvedValue([queued]);
    expect((await q.queue.act(q.owner, 'prioritize', [queued.id])).results[0]!.outcome).toBe('refused');
    expect(q.service.prioritizeJob).not.toHaveBeenCalled();
    expect((await q.queue.act(q.manager, 'prioritize', [queued.id])).results[0]!.outcome).toBe('done');
  });

  it('reports what Resume found, and a failure on one job without stopping the rest', async () => {
    const q = makeQueue();
    const first = q.row({ status: 'paused', reason: 'user' });
    const second = q.row({ status: 'paused', reason: 'user' });
    const third = q.row({ status: 'paused', reason: 'user' });
    q.jobs.findByIds.mockResolvedValueOnce([first, second, third]);
    q.service.retryJob
      .mockResolvedValueOnce({ kind: 'still-paused', job: { ...first, reason: 'budget' }, reason: 'budget' })
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValueOnce({ kind: 'refused', refusal: { reason: 'requester' } });
    const { results } = await q.queue.act(q.owner, 'resume', [first.id, second.id, third.id]);
    expect(results.map((result) => [result.outcome, result.reason])).toEqual([
      ['still-paused', 'budget'],
      ['error', 'user'],
      ['refused', 'user'],
    ]);
  });
});
