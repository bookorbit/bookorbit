import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { gzipSync } from 'zlib';
import { AuditAction, AuditResource } from '@bookorbit/types';

import type { AiArtifactRow, AiJobRow } from '../../db/schema';
import type { AuditEventPayload } from '../audit/audit-events.service';
import type { AiArtifactInfo } from './ai-artifact.repository';
import { AI_JOBS_FAILED_VISIBLE_MS } from './ai-jobs.constants';
import { AiJobsService, modelsChanged } from './ai-jobs.service';
import { fakeRef } from './testing/fake-ai-feature';
import { createRunnerHarness } from './testing/in-memory-ai-jobs';

const MODELS = { fast: { connectionId: 1, model: 'fast-model' }, careful: { connectionId: 1, model: 'careful-model' } };

function makeService() {
  const h = createRunnerHarness();
  const jobs = {
    create: vi.fn((values: Partial<AiJobRow>) => Promise.resolve(h.job(1, { ...values, status: 'queued' }) as AiJobRow | null)),
    findById: vi.fn((): Promise<AiJobRow | null> => Promise.resolve(null)),
    findUnfinished: vi.fn((): Promise<AiJobRow | null> => Promise.resolve(null)),
    findLatest: vi.fn((): Promise<AiJobRow | null> => Promise.resolve(null)),
    maxGeneration: vi.fn((): Promise<number | null> => Promise.resolve(null)),
    countAhead: vi.fn(() => Promise.resolve(2)),
    retryFailed: vi.fn((id: string, requestedBy: number) => Promise.resolve({ ...h.job(1), id, status: 'queued', requestedBy } as AiJobRow | null)),
    resumePaused: vi.fn((id: string, change: { requestedBy?: number; raiseCap?: boolean } = {}) =>
      Promise.resolve({ ...h.job(1), id, status: 'queued', capRaises: change.raiseCap ? 1 : 0, requestedBy: change.requestedBy } as AiJobRow | null),
    ),
    setPauseReason: vi.fn((id: string, reason: string) => Promise.resolve({ id, status: 'paused', reason } as AiJobRow | null)),
    cancel: vi.fn((id: string) => Promise.resolve({ ...h.job(1), id, status: 'cancelled', phase: 'names' } as AiJobRow | null)),
    dismiss: vi.fn((id: string) => Promise.resolve({ id, status: 'failed', dismissedAt: new Date() } as AiJobRow | null)),
    pauseByUser: vi.fn((id: string) => Promise.resolve({ ...h.job(1), id, status: 'paused', reason: 'user', phase: 'names' } as AiJobRow | null)),
    prioritize: vi.fn((id: string) => Promise.resolve({ ...h.job(1), id, status: 'queued', priority: 3 } as AiJobRow | null)),
    countUnfinishedUsing: vi.fn(() => Promise.resolve(3)),
    unfinishedIds: vi.fn((ids: readonly string[]) => Promise.resolve(ids.slice(0, 1))),
  };
  const artifacts = {
    findInfo: vi.fn((): Promise<AiArtifactInfo | null> => Promise.resolve(null)),
    findWithPayload: vi.fn((): Promise<AiArtifactRow | null> => Promise.resolve(null)),
    remove: vi.fn(() => Promise.resolve(true)),
  };
  const activity = { record: vi.fn(() => Promise.resolve()) };
  const pauses = { blocker: vi.fn((): Promise<string | null> => Promise.resolve(null)) };
  const worker = { stop: vi.fn() };
  const audit = { record: vi.fn<(payload: AuditEventPayload) => Promise<void>>(() => Promise.resolve()) };
  const service = new AiJobsService(
    h.registry,
    jobs as never,
    artifacts as never,
    activity as never,
    pauses as never,
    worker as never,
    audit as never,
    h.ports,
  );
  const actor = h.user();
  const subject = h.job(4);
  const ref = subject.subjectRef;
  const key = subject.subjectKey;
  const request = (kind: 'build' | 'update' | 'rebuild', change: { actor?: typeof actor; subjectRef?: typeof ref } = {}) =>
    service.request({ feature: h.feature.id, kind, subjectRef: change.subjectRef ?? ref, actor: change.actor ?? actor });
  return { h, jobs, artifacts, activity, pauses, worker, audit, service, actor, ref, key, request };
}

function artifact(change: Partial<AiArtifactInfo> = {}): AiArtifactInfo {
  return { pipeline: 'fake-1', generation: 1, models: MODELS, format: 2, coverage: 1, builtAt: new Date(), ...change } as AiArtifactInfo;
}

describe('AiJobsService.request', () => {
  it('queues a build in generation 1 and logs who asked', async () => {
    const s = makeService();
    const result = await s.request('build');
    expect(result.kind).toBe('created');
    expect(s.jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: s.h.feature.id,
        kind: 'build',
        subjectKey: s.key,
        generation: 1,
        requestedBy: s.actor.id,
        pipeline: 'fake-1',
      }),
    );
    expect(s.activity.record).toHaveBeenCalledWith(expect.any(String), 'info', null, 'requested', {
      kind: 'build',
      generation: 1,
      userId: s.actor.id,
    });
  });

  it('builds in the generation of the latest job when there is no artifact, so a cancelled build is reused', async () => {
    const s = makeService();
    s.jobs.findLatest.mockResolvedValueOnce({ generation: 4 } as AiJobRow);
    await s.request('build');
    expect(s.jobs.create).toHaveBeenCalledWith(expect.objectContaining({ generation: 4 }));
  });

  it('rebuilds in a generation no job or artifact has used', async () => {
    const s = makeService();
    s.artifacts.findInfo.mockResolvedValue(artifact({ generation: 2 }));
    s.jobs.maxGeneration.mockResolvedValueOnce(5);
    await s.request('rebuild');
    expect(s.jobs.create).toHaveBeenCalledWith(expect.objectContaining({ generation: 6 }));
  });

  it('updates in the generation of the artifact, once its pipeline or a model changed', async () => {
    const s = makeService();
    s.artifacts.findInfo.mockResolvedValue(artifact({ generation: 3 }));
    expect(await s.request('update')).toEqual({ kind: 'refused', refusal: { reason: 'up-to-date' } });
    s.artifacts.findInfo.mockResolvedValue(artifact({ generation: 3, pipeline: 'fake-0' }));
    await s.request('update');
    expect(s.jobs.create).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'update', generation: 3 }));
    s.artifacts.findInfo.mockResolvedValue(artifact({ generation: 3, models: { ...MODELS, careful: { connectionId: 2, model: 'careful-model' } } }));
    expect((await s.request('update')).kind).toBe('created');
  });

  it('refuses an update or a rebuild with nothing built', async () => {
    const s = makeService();
    expect(await s.request('update')).toEqual({ kind: 'refused', refusal: { reason: 'no-artifact' } });
    expect(await s.request('rebuild')).toEqual({ kind: 'refused', refusal: { reason: 'no-artifact' } });
  });

  it('passes on the refusal of a subject that cannot be read or built', async () => {
    const s = makeService();
    expect(await s.request('build', { subjectRef: fakeRef(999) })).toEqual({ kind: 'refused', refusal: { reason: 'unreadable' } });
    const empty = s.h.job(0);
    expect(await s.request('build', { subjectRef: empty.subjectRef })).toEqual({ kind: 'refused', refusal: { reason: 'too-short' } });
  });

  it('rethrows an unexpected error from resolving the subject', async () => {
    const s = makeService();
    s.h.feature.resolveSubject = () => Promise.reject(new Error('disk gone'));
    await expect(s.request('build')).rejects.toThrow('disk gone');
  });

  it('answers with the unfinished job instead of a second one', async () => {
    const s = makeService();
    const running = { id: 'running', status: 'running' } as AiJobRow;
    s.jobs.findUnfinished.mockResolvedValueOnce(running);
    expect(await s.request('build')).toEqual({ kind: 'conflict', job: running });
    expect(s.jobs.create).not.toHaveBeenCalled();
  });

  it('answers with the job that won a race to create it', async () => {
    const s = makeService();
    const winner = { id: 'winner', status: 'queued' } as AiJobRow;
    s.jobs.create.mockResolvedValueOnce(null);
    s.jobs.findUnfinished.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    expect(await s.request('build')).toEqual({ kind: 'conflict', job: winner });
    s.jobs.create.mockResolvedValueOnce(null);
    await expect(s.request('build')).rejects.toThrow('neither created nor found');
  });

  it('refuses someone without the permission, and an unknown feature', async () => {
    const s = makeService();
    await expect(s.request('build', { actor: s.h.user({ permissions: [] }) })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.service.request({ feature: 'gone', kind: 'build', subjectRef: s.ref, actor: s.actor })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AiJobsService.status', () => {
  it('shows the unfinished job, with the jobs ahead of a queued one', async () => {
    const s = makeService();
    const queued = s.h.job(1, { status: 'queued' });
    s.jobs.findUnfinished.mockResolvedValueOnce(queued);
    s.artifacts.findInfo.mockResolvedValueOnce(artifact());
    expect(await s.service.status(s.h.feature.id, s.key)).toEqual({
      job: queued,
      ahead: 2,
      artifact: artifact({ builtAt: expect.any(Date) as Date }),
    });
  });

  it('counts no position for a running job', async () => {
    const s = makeService();
    s.jobs.findUnfinished.mockResolvedValueOnce(s.h.job(1, { status: 'running' }));
    expect((await s.service.status(s.h.feature.id, s.key)).ahead).toBeNull();
  });

  it.each([
    ['a recent failure', { status: 'failed', finishedAt: new Date() }, true],
    ['a failure without an end time', { status: 'failed', finishedAt: null }, true],
    ['a dismissed failure', { status: 'failed', finishedAt: new Date(), dismissedAt: new Date() }, false],
    ['a failure older than 30 days', { status: 'failed', finishedAt: new Date(Date.now() - AI_JOBS_FAILED_VISIBLE_MS - 1000) }, false],
    ['a completed job', { status: 'completed', finishedAt: new Date() }, false],
    ['a cancelled job', { status: 'cancelled', finishedAt: new Date() }, false],
  ])('shows %s as the latest job: %s', async (_label, change, visible) => {
    const s = makeService();
    const latest = s.h.job(1, change as Partial<AiJobRow>);
    s.jobs.findLatest.mockResolvedValueOnce(latest);
    expect((await s.service.status(s.h.feature.id, s.key)).job).toBe(visible ? latest : null);
  });
});

describe('AiJobsService.retry', () => {
  function retry(s: ReturnType<typeof makeService>, actor = s.actor) {
    return s.service.retry({ feature: s.h.feature.id, subjectRef: s.ref, actor });
  }

  it('is Continue on an over-estimate pause: the cap rises and the caller takes the job', async () => {
    const s = makeService();
    const paused = s.h.job(1, { status: 'paused', reason: 'over-estimate' });
    s.jobs.findUnfinished.mockResolvedValueOnce(paused);
    expect(await retry(s)).toMatchObject({ kind: 'resumed', job: { capRaises: 1, requestedBy: s.actor.id } });
    expect(s.jobs.resumePaused).toHaveBeenCalledWith(paused.id, { requestedBy: s.actor.id, raiseCap: true });
    expect(s.pauses.blocker).not.toHaveBeenCalled();
    expect(s.activity.record).toHaveBeenCalledWith(paused.id, 'info', null, 'continued', { userId: s.actor.id, capRaises: 1 });
  });

  it('resumes a paused job whose cause cleared on a retest, as the caller', async () => {
    const s = makeService();
    const paused = s.h.job(1, { status: 'paused', reason: 'provider-auth' });
    s.jobs.findUnfinished.mockResolvedValueOnce(paused);
    expect(await retry(s)).toMatchObject({ kind: 'resumed', job: { status: 'queued' } });
    expect(s.pauses.blocker).toHaveBeenCalledWith(paused, s.h.feature, true);
    expect(s.jobs.resumePaused).toHaveBeenCalledWith(paused.id, { requestedBy: s.actor.id });
  });

  it('keeps a paused job paused under the cause that holds now', async () => {
    const s = makeService();
    const paused = s.h.job(1, { status: 'paused', reason: 'budget' });
    s.jobs.findUnfinished.mockResolvedValue(paused);
    s.pauses.blocker.mockResolvedValueOnce('budget');
    expect(await retry(s)).toEqual({ kind: 'still-paused', job: paused, reason: 'budget' });
    expect(s.jobs.setPauseReason).not.toHaveBeenCalled();

    s.pauses.blocker.mockResolvedValueOnce('off');
    expect(await retry(s)).toMatchObject({ kind: 'still-paused', reason: 'off', job: { reason: 'off' } });
    expect(s.jobs.setPauseReason).toHaveBeenCalledWith(paused.id, 'off');

    s.pauses.blocker.mockResolvedValueOnce('provider-down');
    s.jobs.setPauseReason.mockResolvedValueOnce(null);
    expect(await retry(s)).toMatchObject({ kind: 'still-paused', reason: 'provider-down', job: paused });
  });

  it('answers with the job as it is when it moved before it could resume', async () => {
    const s = makeService();
    const moved = { id: 'x', status: 'cancelled' } as AiJobRow;
    s.jobs.findById.mockResolvedValue(moved);
    s.jobs.resumePaused.mockResolvedValue(null);
    s.jobs.findUnfinished.mockResolvedValueOnce(s.h.job(1, { status: 'paused', reason: 'over-estimate' }));
    expect(await retry(s)).toEqual({ kind: 'none', job: moved });
    s.jobs.findUnfinished.mockResolvedValueOnce(s.h.job(1, { status: 'paused', reason: 'off' }));
    expect(await retry(s)).toEqual({ kind: 'none', job: moved });
  });

  it('queues a failed job again as the caller, after checking the subject can still be built', async () => {
    const s = makeService();
    const failed = s.h.job(1, { status: 'failed', reason: 'requester', finishedAt: new Date() });
    s.jobs.findLatest.mockResolvedValue(failed);
    const other = s.h.user();
    expect(await retry(s, other)).toMatchObject({ kind: 'resumed', job: { requestedBy: other.id } });
    expect(s.activity.record).toHaveBeenCalledWith(failed.id, 'info', null, 'retried', { userId: other.id, reason: 'requester' });

    s.h.featureState.subjects.get(String(s.ref.fileId))!.passages = [];
    expect(await retry(s)).toEqual({ kind: 'refused', refusal: { reason: 'too-short' } });
  });

  it('answers with the other unfinished job when one appeared first', async () => {
    const s = makeService();
    s.jobs.findLatest.mockResolvedValue(s.h.job(1, { status: 'failed', finishedAt: new Date() }));
    const other = { id: 'other', status: 'queued' } as AiJobRow;
    s.jobs.retryFailed.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }));
    s.jobs.findUnfinished.mockResolvedValueOnce(null).mockResolvedValueOnce(other);
    expect(await retry(s)).toEqual({ kind: 'conflict', job: other });

    s.jobs.retryFailed.mockRejectedValueOnce(new Error('database down'));
    await expect(retry(s)).rejects.toThrow('database down');

    s.jobs.retryFailed.mockResolvedValueOnce(null);
    expect(await retry(s)).toEqual({ kind: 'none', job: null });
  });

  it('has nothing to try again for no job, or a queued or running one', async () => {
    const s = makeService();
    expect(await retry(s)).toEqual({ kind: 'none', job: null });
    const running = s.h.job(1, { status: 'running' });
    s.jobs.findUnfinished.mockResolvedValueOnce(running);
    expect(await retry(s)).toEqual({ kind: 'none', job: running });
  });

  it('passes on the refusal of a subject that cannot be read', async () => {
    const s = makeService();
    expect(await s.service.retry({ feature: s.h.feature.id, subjectRef: fakeRef(999), actor: s.actor })).toEqual({
      kind: 'refused',
      refusal: { reason: 'unreadable' },
    });
  });
});

describe('AiJobsService.retryJob', () => {
  it("resumes a person's pause by id once the job's other causes are clear, as the caller", async () => {
    const s = makeService();
    const paused = s.h.job(1, { status: 'paused', reason: 'user' });
    s.jobs.findById.mockResolvedValueOnce(paused);
    expect(await s.service.retryJob(paused.id, s.actor)).toMatchObject({ kind: 'resumed', job: { status: 'queued' } });
    expect(s.pauses.blocker).toHaveBeenCalledWith(paused, s.h.feature, true);
    expect(s.jobs.resumePaused).toHaveBeenCalledWith(paused.id, { requestedBy: s.actor.id });
  });

  it('hands a resumed pause to the cause that still holds, so it resumes on its own later', async () => {
    const s = makeService();
    const paused = s.h.job(1, { status: 'paused', reason: 'user' });
    s.jobs.findById.mockResolvedValueOnce(paused);
    s.pauses.blocker.mockResolvedValueOnce('budget');
    expect(await s.service.retryJob(paused.id, s.actor)).toMatchObject({ kind: 'still-paused', reason: 'budget' });
    expect(s.jobs.setPauseReason).toHaveBeenCalledWith(paused.id, 'budget');
  });

  it('refuses a caller who can no longer reach the subject, and a failed job whose subject changed', async () => {
    const s = makeService();
    const failed = s.h.job(1, { status: 'failed', finishedAt: new Date() });
    s.jobs.findById.mockResolvedValue(failed);
    s.h.featureState.reachable = () => false;
    expect(await s.service.retryJob(failed.id, s.actor)).toEqual({ kind: 'refused', refusal: { reason: 'requester' } });
    expect(s.jobs.retryFailed).not.toHaveBeenCalled();

    s.h.featureState.reachable = () => true;
    s.jobs.findById.mockResolvedValue({ ...failed, subjectKey: 'text-old' });
    expect(await s.service.retryJob(failed.id, s.actor)).toEqual({ kind: 'refused', refusal: { reason: 'source-changed' } });

    s.jobs.findById.mockResolvedValue(failed);
    expect(await s.service.retryJob(failed.id, s.actor)).toMatchObject({ kind: 'resumed' });
    expect(s.jobs.retryFailed).toHaveBeenCalledWith(failed.id, s.actor.id);
  });

  it('has nothing to try again on a running job, a failed one no longer shown, or no job', async () => {
    const s = makeService();
    expect(await s.service.retryJob('missing', s.actor)).toEqual({ kind: 'none', job: null });
    const running = s.h.job(1, { status: 'running' });
    s.jobs.findById.mockResolvedValueOnce(running);
    expect(await s.service.retryJob(running.id, s.actor)).toEqual({ kind: 'none', job: running });
    const dismissed = s.h.job(1, { status: 'failed', finishedAt: new Date(), dismissedAt: new Date() });
    s.jobs.findById.mockResolvedValueOnce(dismissed);
    expect(await s.service.retryJob(dismissed.id, s.actor)).toEqual({ kind: 'none', job: dismissed });
  });

  it('refuses someone without the feature permission', async () => {
    const s = makeService();
    s.jobs.findById.mockResolvedValueOnce(s.h.job(1, { status: 'paused', reason: 'user' }));
    await expect(s.service.retryJob('job', s.h.user({ permissions: [] }))).rejects.toThrow(ForbiddenException);
  });
});

describe('AiJobsService.pauseJob and prioritizeJob', () => {
  it("pauses as a person's pause, stops this server's run, releases the budget and records it", async () => {
    const s = makeService();
    const release = vi.spyOn(s.h.ports.budget, 'release');
    expect(await s.service.pauseJob('job-1', s.actor)).toMatchObject({ status: 'paused', reason: 'user' });
    expect(s.worker.stop).toHaveBeenCalledWith('job-1');
    expect(release).toHaveBeenCalledWith('job-1');
    expect(s.activity.record).toHaveBeenCalledWith('job-1', 'info', 'names', 'paused', { reason: 'user', userId: s.actor.id });
    expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.AiJobPause, userId: s.actor.id }));
  });

  it('does nothing to a job that already left the queue', async () => {
    const s = makeService();
    s.jobs.pauseByUser.mockResolvedValueOnce(null);
    expect(await s.service.pauseJob('job-1', s.actor)).toBeNull();
    expect(s.worker.stop).not.toHaveBeenCalled();
    expect(s.audit.record).not.toHaveBeenCalled();
  });

  it('moves a queued job to the front and records it', async () => {
    const s = makeService();
    expect(await s.service.prioritizeJob('job-1', s.actor)).toMatchObject({ priority: 3 });
    expect(s.activity.record).toHaveBeenCalledWith('job-1', 'info', null, 'prioritized', { userId: s.actor.id, priority: 3 });
    expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.AiJobPrioritize }));

    s.jobs.prioritize.mockResolvedValueOnce(null);
    expect(await s.service.prioritizeJob('job-2', s.actor)).toBeNull();
  });
});

describe('AiJobsService.cancel', () => {
  function cancel(s: ReturnType<typeof makeService>) {
    return s.service.cancel({ feature: s.h.feature.id, subjectKey: s.key, actor: s.actor });
  }

  it('ends an unfinished job, stops this server run of it and releases its budget', async () => {
    const s = makeService();
    const running = s.h.job(1, { status: 'running' });
    s.jobs.findUnfinished.mockResolvedValueOnce(running);
    const release = vi.spyOn(s.h.ports.budget, 'release');
    expect(await cancel(s)).toMatchObject({ kind: 'cancelled', job: { status: 'cancelled' } });
    expect(s.worker.stop).toHaveBeenCalledWith(running.id);
    expect(release).toHaveBeenCalledWith(running.id);
    expect(s.activity.record).toHaveBeenCalledWith(running.id, 'info', 'names', 'cancelled', { userId: s.actor.id });
  });

  it('answers with the job as it is when it ended first', async () => {
    const s = makeService();
    const completed = { id: 'done', status: 'completed' } as AiJobRow;
    s.jobs.findUnfinished.mockResolvedValueOnce(s.h.job(1, { status: 'running' }));
    s.jobs.cancel.mockResolvedValueOnce(null);
    s.jobs.findById.mockResolvedValueOnce(completed);
    expect(await cancel(s)).toEqual({ kind: 'none', job: completed });
    expect(s.worker.stop).not.toHaveBeenCalled();
  });

  it('dismisses a failed job', async () => {
    const s = makeService();
    const failed = s.h.job(1, { status: 'failed', finishedAt: new Date() });
    s.jobs.findLatest.mockResolvedValue(failed);
    expect(await cancel(s)).toMatchObject({ kind: 'dismissed', job: { status: 'failed' } });
    expect(s.activity.record).toHaveBeenCalledWith(failed.id, 'info', null, 'dismissed', { userId: s.actor.id });

    s.jobs.dismiss.mockResolvedValueOnce(null);
    expect(await cancel(s)).toEqual({ kind: 'none', job: null });
  });

  it('has nothing to cancel without a shown job, and records a cancel with no person as such', async () => {
    const s = makeService();
    expect(await cancel(s)).toEqual({ kind: 'none', job: null });
    await s.service.cancelJob('job-1', null);
    expect(s.activity.record).toHaveBeenCalledWith('job-1', 'info', 'names', 'cancelled', { userId: null });
  });

  it('refuses someone without the permission', async () => {
    const s = makeService();
    await expect(s.service.cancel({ feature: s.h.feature.id, subjectKey: s.key, actor: s.h.user({ permissions: [] }) })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('AiJobsService queries for the AI connection', () => {
  it('counts unfinished jobs on a connection and filters job ids to unfinished ones', async () => {
    const s = makeService();
    expect(await s.service.countUnfinishedUsing(7)).toBe(3);
    expect(s.jobs.countUnfinishedUsing).toHaveBeenCalledWith(7);
    expect(await s.service.unfinishedJobIds(['a', 'b'])).toEqual(['a']);
  });

  it('reads artifact info', async () => {
    const s = makeService();
    s.artifacts.findInfo.mockResolvedValueOnce(artifact());
    expect(await s.service.artifactInfo(s.h.feature.id, s.key)).toMatchObject({ generation: 1 });
  });
});

describe('modelsChanged', () => {
  it('is true only when a slot both sides have moved to another model or connection', () => {
    expect(modelsChanged(MODELS, MODELS, ['fast', 'careful'])).toBe(false);
    expect(modelsChanged(MODELS, { ...MODELS, fast: { connectionId: 1, model: 'other' } }, ['fast'])).toBe(true);
    expect(modelsChanged(MODELS, { ...MODELS, fast: { connectionId: 2, model: 'fast-model' } }, ['fast'])).toBe(true);
    expect(modelsChanged(MODELS, { ...MODELS, fast: { connectionId: 1, model: 'other' } }, ['careful'])).toBe(false);
    expect(modelsChanged(null, MODELS, ['fast'])).toBe(false);
    expect(modelsChanged(MODELS, {}, ['fast'])).toBe(false);
  });
});

describe('AiJobsService audit entries', () => {
  it('records a build, an update and a rebuild against the feature target, with the job', async () => {
    const s = makeService();
    const created = await s.request('build');
    expect(s.audit.record).toHaveBeenCalledWith({
      userId: s.actor.id,
      actorUsername: s.actor.username,
      action: AuditAction.AiJobBuild,
      resource: AuditResource.Book,
      resourceId: Number(s.ref.bookId),
      description: `Queued an AI build (${s.h.feature.id})`,
      meta: { feature: s.h.feature.id, jobId: created.kind === 'created' ? created.job.id : null, kind: 'build', generation: 1 },
    });
    s.artifacts.findInfo.mockResolvedValue(artifact({ pipeline: 'fake-0' }));
    await s.request('update');
    await s.request('rebuild');
    expect(s.audit.record.mock.calls.map(([payload]) => payload.action)).toEqual([
      AuditAction.AiJobBuild,
      AuditAction.AiJobUpdate,
      AuditAction.AiJobRebuild,
    ]);
  });

  it('records nothing for a refused or conflicting request', async () => {
    const s = makeService();
    await s.request('rebuild');
    s.jobs.findUnfinished.mockResolvedValueOnce({ id: 'x' } as AiJobRow);
    await s.request('build');
    expect(s.audit.record).not.toHaveBeenCalled();
  });

  it('records Try again, Continue and Cancel, but not Dismiss', async () => {
    const s = makeService();
    s.jobs.findUnfinished.mockResolvedValueOnce(s.h.job(1, { status: 'paused', reason: 'over-estimate' }));
    await s.service.retry({ feature: s.h.feature.id, subjectRef: s.ref, actor: s.actor });
    s.jobs.findUnfinished.mockResolvedValueOnce(s.h.job(1, { status: 'paused', reason: 'off' }));
    await s.service.retry({ feature: s.h.feature.id, subjectRef: s.ref, actor: s.actor });
    s.jobs.findLatest.mockResolvedValueOnce(s.h.job(1, { status: 'failed', finishedAt: new Date() }));
    await s.service.retry({ feature: s.h.feature.id, subjectRef: s.ref, actor: s.actor });
    s.jobs.cancel.mockResolvedValueOnce(s.h.job(1, { status: 'cancelled' }));
    s.jobs.findUnfinished.mockResolvedValueOnce(s.h.job(1, { status: 'running' }));
    await s.service.cancel({ feature: s.h.feature.id, subjectKey: s.key, actor: s.actor });
    s.jobs.findLatest.mockResolvedValueOnce(s.h.job(1, { status: 'failed', finishedAt: new Date() }));
    await s.service.cancel({ feature: s.h.feature.id, subjectKey: s.key, actor: s.actor });
    expect(s.audit.record.mock.calls.map(([payload]) => payload.action)).toEqual([
      AuditAction.AiJobRetry,
      AuditAction.AiJobRetry,
      AuditAction.AiJobRetry,
      AuditAction.AiJobCancel,
    ]);
  });

  it('records no cancel without a person, and leaves out a target the feature does not name', async () => {
    const s = makeService();
    await s.service.cancelJob('job-1', null);
    expect(s.audit.record).not.toHaveBeenCalled();

    s.h.feature.auditTarget = () => null;
    await s.request('build');
    expect(s.audit.record).toHaveBeenCalledWith(expect.not.objectContaining({ resource: expect.anything() }));
  });

  it('keeps the action when the audit entry cannot be written', async () => {
    const s = makeService();
    s.audit.record.mockRejectedValueOnce(new Error('database down'));
    expect((await s.request('build')).kind).toBe('created');
  });
});

describe('AiJobsService.remove', () => {
  it('cancels the unfinished job first, then removes the artifact and records it', async () => {
    const s = makeService();
    const running = s.h.job(1, { status: 'running' });
    s.jobs.findUnfinished.mockResolvedValueOnce(running);
    s.jobs.cancel.mockResolvedValueOnce({ ...running, status: 'cancelled' });
    const result = await s.service.remove({ feature: s.h.feature.id, subjectKey: s.key, subjectRef: s.ref, actor: s.actor });
    expect(result).toEqual({ removed: true, cancelled: expect.objectContaining({ id: running.id, status: 'cancelled' }) });
    expect(s.artifacts.remove).toHaveBeenCalledWith(s.h.feature.id, s.key);
    expect(s.audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: AuditAction.AiJobOutputDelete, meta: { feature: s.h.feature.id, cancelledJobId: running.id } }),
    );
  });

  it('records nothing when there was nothing to remove', async () => {
    const s = makeService();
    s.artifacts.remove.mockResolvedValueOnce(false);
    expect(await s.service.remove({ feature: s.h.feature.id, subjectKey: s.key, subjectRef: s.ref, actor: s.actor })).toEqual({
      removed: false,
      cancelled: null,
    });
    expect(s.audit.record).not.toHaveBeenCalled();
  });
});

describe('AiJobsService.readArtifact', () => {
  function stored(format: number, body: object): AiArtifactRow {
    return { format, payload: gzipSync(JSON.stringify(body)), sha256: 'abc', builtAt: new Date(0) } as AiArtifactRow;
  }

  it('renders the newest format the caller reads', async () => {
    const s = makeService();
    s.artifacts.findWithPayload.mockResolvedValue(stored(2, { format: 2, names: ['A1'], summary: 'x', coverage: 1 }));
    expect(await s.service.readArtifact(s.h.feature.id, s.key, [1, 2])).toMatchObject({ kind: 'found', format: 2, body: { format: 2 } });
    expect(await s.service.readArtifact(s.h.feature.id, s.key, [1])).toMatchObject({ kind: 'found', format: 1, body: { format: 1, names: ['A1'] } });
  });

  it('answers format when no asked format can be rendered, and none without an artifact', async () => {
    const s = makeService();
    expect(await s.service.readArtifact(s.h.feature.id, s.key, [2])).toEqual({ kind: 'none' });
    s.artifacts.findWithPayload.mockResolvedValue(stored(1, { format: 1, names: [], summary: '', coverage: 1 }));
    expect(await s.service.readArtifact(s.h.feature.id, s.key, [2, 3])).toEqual({ kind: 'format' });
    s.h.feature.render = () => null;
    expect(await s.service.readArtifact(s.h.feature.id, s.key, [1])).toEqual({ kind: 'format' });
  });
});
