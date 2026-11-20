import { randomUUID } from 'crypto';
import { gunzipSync } from 'zlib';
import { and, eq, inArray } from 'drizzle-orm';

import { AuditAction, AuditResource, NotificationType, Permission, type AiJobSubjectRef } from '@bookorbit/types';

import type { RequestUser } from '../src/common/types/request-user';
import * as schema from '../src/db/schema';
import { AI_JOBS_MAX_ATTEMPTS } from '../src/modules/ai-jobs/ai-jobs.constants';
import { AiError, type AiRequest } from '../src/modules/ai-jobs/ai-jobs.ports';
import { defaultAnswer, hangUntilAborted } from '../src/modules/ai-jobs/testing/fake-ai-feature';
import { openAiJobsDb, type AiJobsDb } from './e2e/ai-jobs/ai-jobs-db';
import { createAiJobsEngine, eventually, type AiJobsEngine } from './e2e/ai-jobs/ai-jobs-engine';

/** The AI jobs engine against PostgreSQL: its tables, conditional updates and the fake feature end to end. */
describe('AI jobs (e2e)', { timeout: 120_000 }, () => {
  let db!: AiJobsDb;
  let close!: () => Promise<void>;

  beforeAll(() => {
    ({ db, close } = openAiJobsDb());
  });

  afterAll(async () => {
    await close();
  });

  describe('schema', () => {
    function insertJob(subjectKey: string, values: Partial<schema.NewAiJobRow> = {}) {
      return db
        .insert(schema.aiJobs)
        .values({ feature: 'fake', kind: 'build', subjectKey, subjectRef: {}, pipeline: 'p1', ...values })
        .returning();
    }

    it('keeps one unfinished job per feature and subject', async () => {
      const key = `key-${randomUUID()}`;
      const [first] = await insertJob(key);
      for (const status of ['queued', 'running', 'paused'] as const) {
        await expect(insertJob(key, { status, kind: 'rebuild' })).rejects.toThrow();
      }
      await db.update(schema.aiJobs).set({ status: 'running' }).where(eq(schema.aiJobs.id, first!.id));
      await expect(insertJob(key)).rejects.toThrow();

      for (const status of ['completed', 'failed', 'cancelled'] as const) {
        await db.update(schema.aiJobs).set({ status }).where(eq(schema.aiJobs.id, first!.id));
        const [next] = await insertJob(key, { kind: 'update' });
        expect(next!.status).toBe('queued');
        await db.update(schema.aiJobs).set({ status: 'cancelled' }).where(eq(schema.aiJobs.id, next!.id));
      }
    });

    it('lets another feature use the same subject key', async () => {
      const key = `key-${randomUUID()}`;
      await insertJob(key);
      const [other] = await insertJob(key, { feature: 'other' });
      expect(other!.feature).toBe('other');
    });

    it('refuses an unknown status or kind', async () => {
      await expect(insertJob(`key-${randomUUID()}`, { status: 'waiting' })).rejects.toThrow();
      await expect(insertJob(`key-${randomUUID()}`, { kind: 'refresh' })).rejects.toThrow();
    });

    it('keeps one cached result per unit and fingerprint', async () => {
      const key = `key-${randomUUID()}`;
      const row = { feature: 'fake', subjectKey: key, step: 'names', unit: 'p1', fingerprint: 'f'.repeat(64), generation: 1, result: { n: 1 } };
      await db.insert(schema.aiJobSteps).values(row);
      await expect(db.insert(schema.aiJobSteps).values(row)).rejects.toThrow();
      await db.insert(schema.aiJobSteps).values({ ...row, fingerprint: 'e'.repeat(64) });
    });

    it('keeps one artifact per feature and subject', async () => {
      const key = `key-${randomUUID()}`;
      const row = {
        feature: 'fake',
        subjectKey: key,
        format: 1,
        pipeline: 'p1',
        generation: 1,
        payload: Buffer.from('x'),
        sha256: 'a'.repeat(64),
        size: 1,
        coverage: 1,
      };
      await db.insert(schema.aiArtifacts).values(row);
      await expect(db.insert(schema.aiArtifacts).values(row)).rejects.toThrow();
      await expect(db.insert(schema.aiArtifacts).values({ ...row, subjectKey: `${key}-2`, coverage: 1.5 })).rejects.toThrow();
    });
  });
  describe('claiming and leases', () => {
    let engine!: AiJobsEngine;

    beforeEach(() => {
      engine = createAiJobsEngine(db);
    });

    afterEach(async () => {
      await engine.stopWorkers();
    });

    async function queue(passages = 4) {
      const actor = await engine.user();
      const book = engine.book(passages);
      const result = await engine.service.request({ feature: engine.feature.id, kind: 'build', subjectRef: book.ref, actor });
      if (result.kind !== 'created') throw new Error(`expected a job, got ${result.kind}`);
      return { job: result.job, actor, book };
    }

    async function expire(jobId: string) {
      await db
        .update(schema.aiJobs)
        .set({ leaseUntil: new Date(Date.now() - 1000) })
        .where(eq(schema.aiJobs.id, jobId));
    }

    it('gives a job to exactly one of many concurrent claimers', async () => {
      const { job } = await queue();
      const claims = await Promise.all(
        Array.from({ length: 20 }, (_, index) => engine.jobs.claimNext(engine.feature.id, `owner-${index}`, 60_000, 3)),
      );
      const winners = claims.filter((row) => row !== null);
      expect(winners).toHaveLength(1);
      expect(winners[0]!.id).toBe(job.id);
      expect(winners[0]!.status).toBe('running');
      expect(winners[0]!.attempts).toBe(1);
    });

    it('never runs more jobs of a feature at once than its builds-at-once setting, across servers', async () => {
      for (let index = 0; index < 4; index++) await queue();
      const claims = await Promise.all(
        Array.from({ length: 12 }, (_, index) => engine.jobs.claimNext(engine.feature.id, `server-${index}`, 60_000, 2)),
      );
      expect(claims.filter((row) => row !== null)).toHaveLength(2);
    });

    it('two workers running side by side never run one job twice', async () => {
      engine.portsState.settings.buildsAtOnce = 3;
      const queued = await Promise.all(Array.from({ length: 6 }, () => queue(5)));
      const [first, second] = [engine.worker(), engine.worker()];
      await eventually(async () => {
        await Promise.all([first.tick(), second.tick()]);
        for (const { job } of queued) expect((await engine.job(job.id)).status).toBe('completed');
      }, 30_000);
      for (const { job } of queued) {
        expect(engine.runsOf(job.id, 'text')).toHaveLength(1);
        const names = engine.runsOf(job.id, 'names').map((run) => run.unit);
        expect(names.sort()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
        expect(engine.runsOf(job.id, 'summary')).toHaveLength(1);
      }
      expect(engine.client.calls).toHaveLength(6 * 6);
    });

    it('renews a lease only for the run that holds it', async () => {
      const { job } = await queue();
      const claimed = await engine.jobs.claimNext(engine.feature.id, 'owner-a', 60_000, 1);
      expect(claimed!.id).toBe(job.id);
      expect(await engine.jobs.renewLease(job.id, 'owner-a', 60_000)).toBe(true);
      expect(await engine.jobs.renewLease(job.id, 'owner-b', 60_000)).toBe(false);
      await expire(job.id);
      await engine.lifecycle.recoverExpired();
      expect((await engine.job(job.id)).status).toBe('queued');
      expect(await engine.jobs.renewLease(job.id, 'owner-a', 60_000)).toBe(false);
      expect(await engine.jobs.pause(job.id, 'owner-a', 'budget')).toBeNull();
      expect(await engine.jobs.fail(job.id, 'owner-a', 'error')).toBeNull();
    });

    it("resumes a killed worker's job from the step cache", async () => {
      const { job } = await queue(8);
      const answered = new Set(['Passage 0', 'Passage 1', 'Passage 2']);
      engine.client.handler = (request) =>
        request.slot === 'fast' && !answered.has(request.user.slice(0, 9)) ? hangUntilAborted(request) : defaultAnswer(request);

      // The first server claims the job, saves three units and hangs on the rest, then dies.
      const dead = new AbortController();
      const claimed = await engine.jobs.claimNext(engine.feature.id, 'dead-server', 60_000, 1);
      const deadRun = engine.runner.run(claimed!, 'dead-server', dead);
      await eventually(async () => {
        const saved = await db.select().from(schema.aiJobSteps).where(eq(schema.aiJobSteps.subjectKey, job.subjectKey));
        expect(saved.filter((row) => row.step === 'names')).toHaveLength(3);
      });
      await expire(job.id);
      await engine.lifecycle.recoverExpired();
      expect((await engine.job(job.id)).status).toBe('queued');
      expect((await engine.events(job.id)).map((event) => event.code)).toContain('recovered');

      // The next server resumes: the text and the three saved units come from the cache.
      engine.client.handler = (request) => defaultAnswer(request);
      const worker = engine.worker();
      await eventually(async () => {
        await worker.tick();
        expect((await engine.job(job.id)).status).toBe('completed');
      });
      expect(engine.runsOf(job.id, 'text')).toHaveLength(1);
      const names = engine.runsOf(job.id, 'names').map((run) => run.unit);
      for (const unit of ['p0', 'p1', 'p2']) expect(names.filter((value) => value === unit)).toHaveLength(1);
      for (const unit of ['p3', 'p4', 'p5', 'p6', 'p7']) expect(names.filter((value) => value === unit)).toHaveLength(2);
      const finished = await engine.job(job.id);
      expect(finished.attempts).toBe(2);

      // The dead run wakes up to find the job gone from it, and writes nothing.
      dead.abort();
      await expect(deadRun).resolves.toEqual({ kind: 'stopped' });
      expect((await engine.job(job.id)).status).toBe('completed');
      const [artifact] = await db.select().from(schema.aiArtifacts).where(eq(schema.aiArtifacts.subjectKey, job.subjectKey));
      expect(artifact!.jobId).toBe(job.id);
    });

    it('fails a job that keeps losing its lease, and tells the requester once', async () => {
      const { job } = await queue();
      await db
        .update(schema.aiJobs)
        .set({ attempts: AI_JOBS_MAX_ATTEMPTS - 1 })
        .where(eq(schema.aiJobs.id, job.id));
      await engine.jobs.claimNext(engine.feature.id, 'crashing-server', 60_000, 1);
      await expire(job.id);
      await engine.lifecycle.recoverExpired();
      await engine.lifecycle.recoverExpired();
      const failed = await engine.job(job.id);
      expect(failed.status).toBe('failed');
      expect(failed.reason).toBe('error');
      expect(engine.sent.filter((notice) => notice.meta?.jobId === job.id)).toHaveLength(1);
      expect(engine.portsState.released).toContain(job.id);
    });
  });

  describe('step cache and generations', () => {
    let engine!: AiJobsEngine;

    beforeEach(() => {
      engine = createAiJobsEngine(db);
    });

    afterEach(async () => {
      await engine.stopWorkers();
    });

    function runs(jobId: string) {
      return {
        text: engine.runsOf(jobId, 'text').length,
        names: engine.runsOf(jobId, 'names').length,
        summary: engine.runsOf(jobId, 'summary').length,
      };
    }

    async function built(passages: number) {
      const actor = await engine.user();
      const book = engine.book(passages);
      const job = await engine.request('build', book.ref, actor);
      await engine.runUntil(job.id);
      expect(runs(job.id)).toEqual({ text: 1, names: passages, summary: 1 });
      return { actor, book, job };
    }

    async function artifactOf(subjectKey: string) {
      const [artifact] = await db
        .select()
        .from(schema.aiArtifacts)
        .where(and(eq(schema.aiArtifacts.feature, engine.feature.id), eq(schema.aiArtifacts.subjectKey, subjectKey)));
      return artifact!;
    }

    async function cachedGenerations(subjectKey: string) {
      const rows = await db
        .select({ generation: schema.aiJobSteps.generation })
        .from(schema.aiJobSteps)
        .where(and(eq(schema.aiJobSteps.feature, engine.feature.id), eq(schema.aiJobSteps.subjectKey, subjectKey)));
      return [...new Set(rows.map((row) => row.generation))].sort();
    }

    it('reruns a step whose version changed and the steps after it, never the steps before it', async () => {
      const { actor, book } = await built(6);

      engine.featureState.versions.names = 2;
      engine.featureState.pipeline = 'fake-2';
      const namesUpdate = await engine.request('update', book.ref, actor);
      expect(namesUpdate.generation).toBe(1);
      await engine.runUntil(namesUpdate.id);
      expect(runs(namesUpdate.id)).toEqual({ text: 0, names: 6, summary: 1 });

      engine.featureState.versions.summary = 2;
      engine.featureState.pipeline = 'fake-3';
      const summaryUpdate = await engine.request('update', book.ref, actor);
      await engine.runUntil(summaryUpdate.id);
      expect(runs(summaryUpdate.id)).toEqual({ text: 0, names: 0, summary: 1 });

      const finished = (await engine.events(summaryUpdate.id)).filter((event) => event.code === 'step_finished');
      expect(finished.map((event) => [event.step, event.data?.reused])).toEqual([
        ['text', 1],
        ['names', 6],
        ['summary', 0],
      ]);
      expect(await artifactOf(book.key)).toMatchObject({ pipeline: 'fake-3', generation: 1, jobId: summaryUpdate.id });
    });

    it('leaves the steps after a rerun step cached when its results did not change', async () => {
      const { actor, book } = await built(4);
      engine.featureState.versions.text = 2;
      engine.featureState.pipeline = 'fake-2';
      const update = await engine.request('update', book.ref, actor);
      await engine.runUntil(update.id);
      expect(runs(update.id)).toEqual({ text: 1, names: 0, summary: 0 });
    });

    it('reruns the steps on a slot whose model changed', async () => {
      const { actor, book } = await built(4);
      const unchanged = await engine.service.request({ feature: engine.feature.id, kind: 'update', subjectRef: book.ref, actor });
      expect(unchanged).toEqual({ kind: 'refused', refusal: { reason: 'up-to-date' } });

      engine.portsState.models.fast = { connectionId: 1, model: 'fast-model-2' };
      const update = await engine.request('update', book.ref, actor);
      await engine.runUntil(update.id);
      expect(runs(update.id)).toEqual({ text: 0, names: 4, summary: 0 });
      expect((await artifactOf(book.key)).models).toEqual(engine.portsState.models);
    });

    it('reruns everything on a Rebuild, under a new generation', async () => {
      const { actor, book } = await built(5);
      const rebuild = await engine.request('rebuild', book.ref, actor);
      expect(rebuild.generation).toBe(2);
      await engine.runUntil(rebuild.id);
      expect(runs(rebuild.id)).toEqual({ text: 1, names: 5, summary: 1 });
      expect(await artifactOf(book.key)).toMatchObject({ generation: 2, jobId: rebuild.id });
      expect(await cachedGenerations(book.key)).toEqual([1, 2]);

      // A later Update continues the new generation and reuses all of it.
      engine.featureState.pipeline = 'fake-2';
      const update = await engine.request('update', book.ref, actor);
      expect(update.generation).toBe(2);
      await engine.runUntil(update.id);
      expect(runs(update.id)).toEqual({ text: 0, names: 0, summary: 0 });
    });

    it('refuses a Rebuild or an Update before anything was built', async () => {
      const actor = await engine.user();
      const book = engine.book(3);
      for (const kind of ['rebuild', 'update'] as const) {
        expect(await engine.service.request({ feature: engine.feature.id, kind, subjectRef: book.ref, actor })).toEqual({
          kind: 'refused',
          refusal: { reason: 'no-artifact' },
        });
      }
    });

    it('sweeps cached units that nothing can use once they are 30 days unused', async () => {
      const replaced = await built(3);
      const rebuild = await engine.request('rebuild', replaced.book.ref, replaced.actor);
      await engine.runUntil(rebuild.id);

      // Another subject whose old generation an unfinished Rebuild could still be asked to reuse.
      const waiting = await built(2);
      const secondRebuild = await engine.request('rebuild', waiting.book.ref, waiting.actor);
      await engine.runUntil(secondRebuild.id);
      const recent = await built(2);
      // Queued after the last run, so no worker claims it.
      await engine.request('rebuild', waiting.book.ref, waiting.actor);

      const old = new Date(Date.now() - 31 * 24 * 60 * 60_000);
      await db
        .update(schema.aiJobSteps)
        .set({ usedAt: old })
        .where(and(eq(schema.aiJobSteps.feature, engine.feature.id), inArray(schema.aiJobSteps.subjectKey, [replaced.book.key, waiting.book.key])));

      await engine.lifecycle.sweep();
      expect(await cachedGenerations(replaced.book.key)).toEqual([2]);
      expect(await cachedGenerations(waiting.book.key)).toEqual([1, 2]);
      expect(await cachedGenerations(recent.book.key)).toEqual([1]);
    });
  });

  /**
   * Every edge of the job state machine, each through the code path that takes it:
   *
   *   queued   -> running (claim) | cancelled (Cancel)
   *   running  -> completed | failed | paused (each reason) | cancelled (Cancel, here or on another
   *               server) | queued (lease lapsed)
   *   paused   -> queued (cause cleared on its own, Try again, Continue) | cancelled | failed
   *               (provider down for a day)
   *   failed   -> queued (Try again) | dismissed (Dismiss) | out of status after 30 days
   *   completed, cancelled: Cancel and Try again change nothing.
   */
  describe('states and transitions', () => {
    const AUTO_REASONS = ['off', 'slot-empty', 'provider-auth', 'model-missing', 'provider-down', 'budget'] as const;
    type AutoReason = (typeof AUTO_REASONS)[number];
    const EDGES = [
      'queued->running',
      'queued->cancelled',
      'running->completed',
      'running->failed',
      'running->paused',
      'running->cancelled',
      'running->queued',
      'paused->queued',
      'paused->cancelled',
      'paused->failed',
      'failed->queued',
      'failed->dismissed',
    ];
    const covered = new Set<string>();
    let engine!: AiJobsEngine;

    beforeEach(() => {
      engine = createAiJobsEngine(db);
    });

    afterEach(async () => {
      await engine.stopWorkers();
    });

    function edge(from: string, to: string) {
      covered.add(`${from}->${to}`);
    }

    function cause(reason: AutoReason, holds: boolean) {
      const state = engine.portsState;
      if (reason === 'off') state.settings.enabled = !holds;
      else if (reason === 'slot-empty') state.missing = holds ? ['fast'] : [];
      else if (reason === 'budget') state.budget = holds ? 'budget' : 'ok';
      else state.health = holds ? reason : null;
    }

    async function queued(passages = 3) {
      const actor = await engine.user();
      const book = engine.book(passages);
      const job = await engine.request('build', book.ref, actor);
      return { actor, book, job };
    }

    async function pausedFor(reason: AutoReason, passages = 3) {
      const queuedJob = await queued(passages);
      cause(reason, true);
      const paused = await engine.runUntil(queuedJob.job.id, ['paused']);
      expect(paused).toMatchObject({ status: 'paused', reason });
      edge('queued', 'running');
      edge('running', 'paused');
      return queuedJob;
    }

    function act(kind: 'retry' | 'cancel', target: { book: { ref: AiJobSubjectRef; key: string }; actor: RequestUser }) {
      return kind === 'retry'
        ? engine.service.retry({ feature: engine.feature.id, subjectRef: target.book.ref, actor: target.actor })
        : engine.service.cancel({ feature: engine.feature.id, subjectKey: target.book.key, actor: target.actor });
    }

    async function shown(book: { key: string }) {
      return (await engine.service.status(engine.feature.id, book.key)).job;
    }

    it('runs a queued job to completed, and shows it in status until then', async () => {
      const target = await queued();
      const status = await engine.service.status(engine.feature.id, target.book.key);
      expect(status).toMatchObject({ job: { id: target.job.id, status: 'queued' }, ahead: 0, artifact: null });
      expect(await engine.runUntil(target.job.id)).toMatchObject({ status: 'completed', reason: null });
      edge('queued', 'running');
      edge('running', 'completed');
      expect(await engine.service.status(engine.feature.id, target.book.key)).toMatchObject({ job: null, ahead: null, artifact: { generation: 1 } });
      expect(engine.sent.filter((notice) => notice.meta?.jobId === target.job.id)).toHaveLength(1);
    });

    it('saves how long each model step took once a job completes, and nothing for a job that did not', async () => {
      const [connection] = await db
        .insert(schema.aiConnections)
        .values({ name: `timings-${randomUUID().slice(0, 8)}`, apiType: 'openai', baseUrl: 'http://127.0.0.1:9' })
        .returning();
      engine.portsState.models = {
        fast: { connectionId: connection!.id, model: 'fast-model' },
        careful: { connectionId: connection!.id, model: 'careful-model' },
      };
      const timings = () =>
        db.select().from(schema.aiStepTimings).where(eq(schema.aiStepTimings.feature, engine.feature.id)).orderBy(schema.aiStepTimings.id);

      const cancelled = await queued(4);
      await engine.service.cancel({ feature: engine.feature.id, subjectKey: cancelled.book.key, actor: cancelled.actor });
      const target = await queued(4);
      expect(await engine.runUntil(target.job.id)).toMatchObject({ status: 'completed' });
      expect(
        (await timings()).map((row) => ({
          step: row.step,
          connectionId: row.connectionId,
          model: row.model,
          units: row.units,
          lanes: row.lanes,
          jobId: row.jobId,
        })),
      ).toEqual([
        { step: 'names', connectionId: connection!.id, model: 'fast-model', units: 4, lanes: 4, jobId: target.job.id },
        { step: 'summary', connectionId: connection!.id, model: 'careful-model', units: 1, lanes: 1, jobId: target.job.id },
      ]);
      const table = await engine.rates.table(engine.feature.id);
      expect(table.msPerUnit('names', engine.portsState.models.fast)).toBeGreaterThanOrEqual(0);

      // A connection that goes takes what was learned on it along.
      await db.delete(schema.aiConnections).where(eq(schema.aiConnections.id, connection!.id));
      expect(await timings()).toEqual([]);
    });

    it('counts the jobs ahead of a queued one', async () => {
      const first = await queued();
      const second = await queued();
      await engine.jobs.claimNext(engine.feature.id, 'busy-server', 60_000, 1);
      expect((await engine.service.status(engine.feature.id, second.book.key)).ahead).toBe(1);
      expect((await engine.job(first.job.id)).status).toBe('running');
    });

    it.each(AUTO_REASONS)('pauses %s, waits while it holds, then resumes on its own and completes', async (reason) => {
      const target = await pausedFor(reason);
      await engine.lifecycle.resumePaused();
      expect(await engine.job(target.job.id)).toMatchObject({ status: 'paused', reason });
      expect(await shown(target.book)).toMatchObject({ status: 'paused', reason });

      cause(reason, false);
      await engine.lifecycle.resumePaused();
      expect(await engine.job(target.job.id)).toMatchObject({ status: 'queued', reason: null, pausedAt: null, attempts: 0 });
      edge('paused', 'queued');
      expect(await engine.runUntil(target.job.id)).toMatchObject({ status: 'completed' });
      const codes = (await engine.events(target.job.id)).map((event) => event.code);
      expect(codes).toEqual(expect.arrayContaining(['paused', 'resumed', 'completed']));
      expect(engine.sent.filter((notice) => notice.meta?.jobId === target.job.id)).toHaveLength(1);
    });

    it('pauses over-estimate at three times the estimate, waits for Continue, and Continue raises the cap', async () => {
      const target = await queued(10);
      // Each fake request costs $0.0001 and the cap is three times $0.00033: no names request can
      // start past it (at most $0.0009 spent before one), and the summary request (after $0.001) does.
      await db
        .update(schema.aiJobs)
        .set({ estimate: { words: 100, minutes: 1, cost: 0.00033 } })
        .where(eq(schema.aiJobs.id, target.job.id));
      const paused = await engine.runUntil(target.job.id, ['paused']);
      expect(paused).toMatchObject({ reason: 'over-estimate', phase: 'summary', costMicros: 1000 });
      edge('running', 'paused');

      await engine.lifecycle.resumePaused();
      expect((await engine.job(target.job.id)).status).toBe('paused');

      const manager = await engine.user();
      const result = await act('retry', { book: target.book, actor: manager });
      expect(result).toMatchObject({ kind: 'resumed', job: { status: 'queued', capRaises: 1, requestedBy: manager.id } });
      edge('paused', 'queued');
      expect(await engine.runUntil(target.job.id)).toMatchObject({ status: 'completed', costMicros: 1100 });
      expect(engine.runsOf(target.job.id, 'names')).toHaveLength(10);
      expect((await engine.events(target.job.id)).map((event) => event.code)).toContain('continued');
    });

    it('Try again tests the connection now and resumes a paused job once it passes, as the caller', async () => {
      const target = await pausedFor('provider-auth');
      engine.portsState.retestHealth = null;
      await engine.lifecycle.resumePaused();
      expect((await engine.job(target.job.id)).status).toBe('paused');

      const manager = await engine.user();
      expect(await act('retry', { book: target.book, actor: manager })).toMatchObject({
        kind: 'resumed',
        job: { status: 'queued', requestedBy: manager.id },
      });
      edge('paused', 'queued');
      engine.portsState.health = null;
      expect(await engine.runUntil(target.job.id)).toMatchObject({ status: 'completed', requestedBy: manager.id });
    });

    it('Try again keeps a paused job paused while a cause holds, naming the cause that holds now', async () => {
      const target = await pausedFor('budget');
      expect(await act('retry', target)).toMatchObject({ kind: 'still-paused', reason: 'budget', job: { status: 'paused' } });
      engine.portsState.settings.enabled = false;
      expect(await act('retry', target)).toMatchObject({ kind: 'still-paused', reason: 'off', job: { status: 'paused', reason: 'off' } });
      expect(await engine.job(target.job.id)).toMatchObject({ status: 'paused', reason: 'off' });
      expect((await engine.events(target.job.id)).filter((event) => event.code === 'still_paused')).toHaveLength(2);
    });

    it('fails a job the provider kept unreachable for a day, and tells the requester once', async () => {
      const target = await pausedFor('provider-down');
      await db
        .update(schema.aiJobs)
        .set({ pausedAt: new Date(Date.now() - 25 * 60 * 60_000) })
        .where(eq(schema.aiJobs.id, target.job.id));
      await engine.lifecycle.resumePaused();
      await engine.lifecycle.resumePaused();
      expect(await engine.job(target.job.id)).toMatchObject({ status: 'failed', reason: 'provider-down' });
      edge('paused', 'failed');
      expect(engine.sent.filter((notice) => notice.meta?.jobId === target.job.id)).toHaveLength(1);
      expect(engine.portsState.released).toContain(target.job.id);
    });

    it('cancels a queued job: it leaves status and never runs', async () => {
      const target = await queued();
      expect(await act('cancel', target)).toMatchObject({ kind: 'cancelled', job: { status: 'cancelled' } });
      edge('queued', 'cancelled');
      expect(await shown(target.book)).toBeNull();
      await engine.local.tick();
      await engine.local.idle();
      expect(engine.runsOf(target.job.id)).toHaveLength(0);
      expect((await engine.events(target.job.id)).map((event) => event.code)).toContain('cancelled');
    });

    it('cancels a running job on this server at once, keeping the units it saved', async () => {
      const target = await queued(6);
      const answered = new Set(['Passage 0', 'Passage 1']);
      engine.client.handler = (request) =>
        request.slot === 'fast' && !answered.has(request.user.slice(0, 9)) ? hangUntilAborted(request) : defaultAnswer(request);
      await engine.local.tick();
      await eventually(async () => {
        const saved = await db.select().from(schema.aiJobSteps).where(eq(schema.aiJobSteps.subjectKey, target.book.key));
        expect(saved.filter((row) => row.step === 'names')).toHaveLength(2);
      });

      expect(await act('cancel', target)).toMatchObject({ kind: 'cancelled' });
      edge('running', 'cancelled');
      await engine.local.idle();
      expect(engine.local.runningJobIds).toEqual([]);
      expect(await engine.job(target.job.id)).toMatchObject({ status: 'cancelled' });
      expect(await engine.artifacts.findInfo(engine.feature.id, target.book.key)).toBeNull();
      expect(engine.sent.filter((notice) => notice.meta?.jobId === target.job.id)).toHaveLength(0);
      expect(engine.portsState.released).toContain(target.job.id);

      // A later build reuses what the cancelled one saved.
      engine.client.handler = (request) => defaultAnswer(request);
      const next = await engine.request('build', target.book.ref, target.actor);
      await engine.runUntil(next.id);
      expect(engine.runsOf(next.id, 'names')).toHaveLength(4);
    });

    it('cancels a running job on another server at its next request', async () => {
      const target = await queued(60);
      engine.client.handler = async (request) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return defaultAnswer(request);
      };
      const remote = engine.worker();
      await remote.tick();
      await eventually(() => expect(engine.client.calls.length).toBeGreaterThan(0));

      expect(await act('cancel', target)).toMatchObject({ kind: 'cancelled' });
      edge('running', 'cancelled');
      await eventually(() => expect(remote.runningJobIds).toEqual([]), 10_000);
      expect(await engine.job(target.job.id)).toMatchObject({ status: 'cancelled' });
      expect(engine.runsOf(target.job.id, 'names').length).toBeLessThan(60);
      expect(engine.runsOf(target.job.id, 'summary')).toHaveLength(0);
    });

    it('cancels a paused job, which then never resumes', async () => {
      const target = await pausedFor('off');
      expect(await act('cancel', target)).toMatchObject({ kind: 'cancelled' });
      edge('paused', 'cancelled');
      cause('off', false);
      await engine.lifecycle.resumePaused();
      expect((await engine.job(target.job.id)).status).toBe('cancelled');
    });

    it('requeues a running job whose lease lapsed', async () => {
      const target = await queued();
      await engine.jobs.claimNext(engine.feature.id, 'gone-server', 60_000, 1);
      await db
        .update(schema.aiJobs)
        .set({ leaseUntil: new Date(Date.now() - 1000) })
        .where(eq(schema.aiJobs.id, target.job.id));
      await engine.lifecycle.recoverExpired();
      expect((await engine.job(target.job.id)).status).toBe('queued');
      edge('running', 'queued');
    });

    it('Try again on a failed job continues its generation, as the caller, reusing every saved unit', async () => {
      const target = await queued(6);
      let failedOnce = false;
      engine.client.handler = (request) => {
        if (!failedOnce && request.user.startsWith('Passage 3')) {
          failedOnce = true;
          return Promise.reject(new Error('unexpected reply'));
        }
        return defaultAnswer(request);
      };
      expect(await engine.runUntil(target.job.id, ['failed'])).toMatchObject({ status: 'failed', reason: 'error', phase: 'names' });
      edge('running', 'failed');
      expect(await shown(target.book)).toMatchObject({ id: target.job.id, status: 'failed' });
      expect(engine.sent.filter((notice) => notice.meta?.jobId === target.job.id)).toHaveLength(1);

      const manager = await engine.user();
      expect(await act('retry', { book: target.book, actor: manager })).toMatchObject({
        kind: 'resumed',
        job: { id: target.job.id, status: 'queued', generation: 1, requestedBy: manager.id, finishedAt: null },
      });
      edge('failed', 'queued');
      expect(await engine.runUntil(target.job.id)).toMatchObject({ status: 'completed' });
      const names = engine.runsOf(target.job.id, 'names').map((run) => run.unit);
      expect(names.filter((unit) => unit === 'p3')).toHaveLength(2);
      for (const unit of ['p0', 'p1', 'p2', 'p4', 'p5']) expect(names.filter((value) => value === unit)).toHaveLength(1);
      expect(engine.sent.filter((notice) => notice.meta?.jobId === target.job.id)).toHaveLength(2);
    });

    async function failed(passages = 2) {
      const target = await queued(passages);
      engine.client.handler = () => Promise.reject(new Error('unexpected reply'));
      await engine.runUntil(target.job.id, ['failed']);
      engine.client.handler = (request) => defaultAnswer(request);
      return target;
    }

    it('Dismiss takes a failed job out of status; it stays failed, with its log', async () => {
      const target = await failed();
      expect(await act('cancel', target)).toMatchObject({ kind: 'dismissed', job: { status: 'failed' } });
      edge('failed', 'dismissed');
      expect(await shown(target.book)).toBeNull();
      expect(await engine.job(target.job.id)).toMatchObject({ status: 'failed', dismissedAt: expect.any(Date) });
      expect(await act('retry', target)).toEqual({ kind: 'none', job: null });
      expect((await engine.events(target.job.id)).map((event) => event.code)).toEqual(expect.arrayContaining(['failed', 'dismissed']));
    });

    it('stops showing a failed job after 30 days, or once a new build starts', async () => {
      const old = await failed();
      await db
        .update(schema.aiJobs)
        .set({ finishedAt: new Date(Date.now() - 31 * 24 * 60 * 60_000) })
        .where(eq(schema.aiJobs.id, old.job.id));
      expect(await shown(old.book)).toBeNull();

      const replaced = await failed();
      const next = await engine.request('build', replaced.book.ref, replaced.actor);
      expect(await shown(replaced.book)).toMatchObject({ id: next.id, status: 'queued' });
    });

    it('changes nothing for Cancel or Try again on a completed or cancelled job, or Try again on a queued or running one', async () => {
      const done = await queued();
      await engine.runUntil(done.job.id);
      expect(await act('cancel', done)).toEqual({ kind: 'none', job: null });
      expect(await act('retry', done)).toEqual({ kind: 'none', job: null });
      expect((await engine.job(done.job.id)).status).toBe('completed');

      const cancelled = await queued();
      await act('cancel', cancelled);
      expect(await act('cancel', cancelled)).toEqual({ kind: 'none', job: null });
      expect(await act('retry', cancelled)).toEqual({ kind: 'none', job: null });
      expect((await engine.job(cancelled.job.id)).status).toBe('cancelled');

      const waiting = await queued();
      expect(await act('retry', waiting)).toMatchObject({ kind: 'none', job: { status: 'queued' } });
      await engine.jobs.claimNext(engine.feature.id, 'busy-server', 60_000, 1);
      expect(await act('retry', waiting)).toMatchObject({ kind: 'none', job: { status: 'running' } });
    });

    it('refuses every action to someone without the permission', async () => {
      const target = await queued();
      const reader = await engine.user({ permissions: [] });
      await expect(act('cancel', { book: target.book, actor: reader })).rejects.toThrow('Not allowed');
      await expect(act('retry', { book: target.book, actor: reader })).rejects.toThrow('Not allowed');
      await expect(engine.service.request({ feature: engine.feature.id, kind: 'build', subjectRef: target.book.ref, actor: reader })).rejects.toThrow(
        'Not allowed',
      );
    });

    it('covered every edge of the state machine', () => {
      expect([...covered].sort()).toEqual([...EDGES].sort());
    });
  });

  describe('change announcements', () => {
    let engine!: AiJobsEngine;

    beforeEach(() => {
      engine = createAiJobsEngine(db);
    });

    afterEach(async () => {
      await engine.stopWorkers();
    });

    it('announces each write a page shows, naming the job and its subject, and nothing for a write that changed nothing', async () => {
      const actor = await engine.user();
      const book = engine.book(3);
      const job = await engine.request('build', book.ref, actor);
      await engine.runUntil(job.id);
      const mine = engine.announced.filter((change) => change.id === job.id);
      for (const change of mine) expect(change).toMatchObject({ feature: engine.feature.id, subjectRef: book.ref });
      // Queued, claimed, completed.
      expect(mine.filter((change) => change.kind === 'state')).toHaveLength(3);
      expect(mine.some((change) => change.kind === 'progress')).toBe(true);

      const before = engine.announced.length;
      await engine.service.cancel({ feature: engine.feature.id, subjectKey: book.key, actor });
      expect(engine.announced).toHaveLength(before);
    });

    it('announces a cancel, a dismiss and a lapsed lease', async () => {
      const actor = await engine.user();
      const book = engine.book(3);
      const job = await engine.request('build', book.ref, actor);
      await engine.service.cancel({ feature: engine.feature.id, subjectKey: book.key, actor });
      expect(engine.announced.at(-1)).toMatchObject({ id: job.id, kind: 'state' });

      const lapsed = await engine.request('build', engine.book(3).ref, actor);
      await db
        .update(schema.aiJobs)
        .set({ status: 'running', leaseOwner: 'gone', leaseUntil: new Date(0) })
        .where(eq(schema.aiJobs.id, lapsed.id));
      // Recovery sweeps every lapsed job in the database, so look for this one among what it announced.
      const mark = engine.announced.length;
      await engine.jobs.recoverExpiredLeases(AI_JOBS_MAX_ATTEMPTS);
      expect(engine.announced.slice(mark)).toContainEqual(expect.objectContaining({ id: lapsed.id, kind: 'state' }));

      await db.update(schema.aiJobs).set({ status: 'failed', finishedAt: new Date() }).where(eq(schema.aiJobs.id, lapsed.id));
      await engine.jobs.dismiss(lapsed.id);
      expect(engine.announced.at(-1)).toMatchObject({ id: lapsed.id, kind: 'state' });
    });
  });

  /** The AI area: lists across accounts, places in the queue, and a person's pause and Move to front. */
  describe('the AI area', () => {
    let engine!: AiJobsEngine;

    beforeEach(() => {
      engine = createAiJobsEngine(db);
    });

    afterEach(async () => {
      await engine.stopWorkers();
    });

    const PAGE = { view: 'queue', scope: 'mine', offset: 0, limit: 50 } as const;

    it("lists a person's own jobs, every account's to a manager, and counts each view", async () => {
      const [first, second] = [await engine.user(), await engine.user()];
      const manager = await engine.user({ permissions: [Permission.ManageAppSettings] });
      const mine = await engine.request('build', engine.book(3).ref, first);
      const theirs = await engine.request('build', engine.book(3).ref, second);
      const failed = await engine.request('build', engine.book(3).ref, first);
      await db.update(schema.aiJobs).set({ status: 'failed', reason: 'error', finishedAt: new Date() }).where(eq(schema.aiJobs.id, failed.id));

      const own = await engine.queue.list(first, PAGE);
      expect(own.items.map((item) => item.id)).toEqual([mine.id]);
      expect(own.counts).toEqual({ queue: 1, failed: 1, history: 0, running: 0, queued: 1, paused: 0 });
      expect(own.items[0]).toMatchObject({
        requester: { id: first.id, name: expect.any(String) as string },
        subject: { url: expect.stringMatching(/^\/book\//) as string },
      });

      const all = await engine.queue.list(manager, { ...PAGE, scope: 'all' });
      expect(all.items.map((item) => item.id)).toEqual([mine.id, theirs.id]);
      expect(all.items.map((item) => item.position)).toEqual([1, 2]);
      expect(all.total).toBe(2);
      await expect(engine.queue.list(first, { ...PAGE, scope: 'all' })).rejects.toThrow('every account');

      const failedView = await engine.queue.list(first, { ...PAGE, view: 'failed' });
      expect(failedView.items.map((item) => [item.id, item.actions])).toEqual([[failed.id, ['retry', 'dismiss']]]);
      await engine.queue.act(first, 'dismiss', [failed.id]);
      expect((await engine.queue.list(first, PAGE)).counts).toEqual({ queue: 1, failed: 0, history: 1, running: 0, queued: 1, paused: 0 });
      expect((await engine.queue.list(first, { ...PAGE, view: 'history' })).items.map((item) => item.id)).toEqual([failed.id]);
    });

    it('starts a job moved to the front first, and counts it ahead of older jobs on the book page', async () => {
      const actor = await engine.user();
      const manager = await engine.user({ permissions: [Permission.ManageAppSettings] });
      const older = await engine.request('build', engine.book(3).ref, actor);
      const newer = await engine.request('build', engine.book(3).ref, actor);
      expect(await engine.jobs.countAhead(newer)).toBe(1);

      expect((await engine.queue.act(actor, 'prioritize', [newer.id])).results[0]!.outcome).toBe('refused');
      expect((await engine.queue.act(manager, 'prioritize', [newer.id])).results[0]).toMatchObject({ outcome: 'done', status: 'queued' });
      expect((await engine.job(newer.id)).priority).toBe(1);
      expect(await engine.jobs.countAhead(await engine.job(newer.id))).toBe(0);
      expect(await engine.jobs.countAhead(await engine.job(older.id))).toBe(1);
      expect((await engine.queue.list(actor, PAGE)).items.map((item) => [item.id, item.position])).toEqual([
        [newer.id, 1],
        [older.id, 2],
      ]);

      const claimed = await engine.jobs.claimNext(engine.feature.id, 'owner', 60_000, 3);
      expect(claimed!.id).toBe(newer.id);
      expect(engine.audits.at(-1)).toMatchObject({ action: AuditAction.AiJobPrioritize, userId: manager.id });
    });

    it("keeps a person's pause through housekeeping until Resume puts it back in the queue", async () => {
      const actor = await engine.user();
      const job = await engine.request('build', engine.book(3).ref, actor);
      expect((await engine.queue.act(actor, 'pause', [job.id])).results[0]).toMatchObject({ outcome: 'done', status: 'paused', reason: 'user' });

      await engine.lifecycle.resumePaused();
      expect(await engine.job(job.id)).toMatchObject({ status: 'paused', reason: 'user' });
      expect(await engine.jobs.claimNext(engine.feature.id, 'owner', 60_000, 3)).toBeNull();
      expect((await engine.queue.list(actor, PAGE)).items[0]!.actions).toEqual(['cancel', 'resume']);

      expect((await engine.queue.act(actor, 'resume', [job.id])).results[0]).toMatchObject({ outcome: 'done', status: 'queued' });
      expect((await engine.runUntil(job.id)).status).toBe('completed');
    });

    it('hands a resumed pause to the cause that still holds, which then resumes it on its own', async () => {
      const actor = await engine.user();
      const job = await engine.request('build', engine.book(3).ref, actor);
      await engine.queue.act(actor, 'pause', [job.id]);
      engine.portsState.settings.enabled = false;
      expect((await engine.queue.act(actor, 'resume', [job.id])).results[0]).toMatchObject({ outcome: 'still-paused', reason: 'off' });
      engine.portsState.settings.enabled = true;
      await engine.lifecycle.resumePaused();
      expect((await engine.job(job.id)).status).toBe('queued');
    });

    it('stops a running job on pause without failing it, and resumes from its saved units', async () => {
      const actor = await engine.user();
      const book = engine.book(6);
      const job = await engine.request('build', book.ref, actor);
      const answered = new Set(['Passage 0', 'Passage 1']);
      engine.client.handler = (request: AiRequest) =>
        request.slot === 'fast' && !answered.has(request.user.slice(0, 9)) ? hangUntilAborted(request) : defaultAnswer(request);
      await engine.local.tick();
      await eventually(async () => {
        const saved = await db.select().from(schema.aiJobSteps).where(eq(schema.aiJobSteps.subjectKey, book.key));
        expect(saved.filter((row) => row.step === 'names')).toHaveLength(2);
      });

      expect((await engine.queue.act(actor, 'pause', [job.id])).results[0]).toMatchObject({ outcome: 'done', status: 'paused' });
      await engine.local.idle();
      expect(engine.local.runningJobIds).toEqual([]);
      expect(await engine.job(job.id)).toMatchObject({ status: 'paused', reason: 'user', leaseOwner: null });
      expect((await engine.events(job.id)).map((event) => event.code)).toContain('paused');
      expect(engine.portsState.released).toContain(job.id);

      // The two saved units are reused; only the four cut off run again.
      const before = engine.runsOf(job.id, 'names').length;
      engine.client.handler = (request: AiRequest) => defaultAnswer(request);
      await engine.queue.act(actor, 'resume', [job.id]);
      expect((await engine.runUntil(job.id)).status).toBe('completed');
      expect(engine.runsOf(job.id, 'names').length - before).toBe(4);
    });
  });

  /**
   * A job runs on its requester's authority and builds for one text, so at claim and before each
   * step it checks that the requester is active, still has the permission (or is a superuser) and
   * can reach the book, and that the file still has the same text.
   */
  describe('run-time checks', () => {
    let engine!: AiJobsEngine;

    beforeEach(() => {
      engine = createAiJobsEngine(db);
    });

    afterEach(async () => {
      await engine.stopWorkers();
    });

    type Change = (target: { actor: RequestUser; book: ReturnType<AiJobsEngine['book']> }) => Promise<void> | void;

    const CHANGES: [string, string, Change][] = [
      ['the requester is deactivated', 'requester', ({ actor }) => engine.updateUser(actor.id, { active: false })],
      ['the requester loses the permission', 'requester', ({ actor }) => engine.updateUser(actor.id, { permissions: [] })],
      [
        'the requester loses the book',
        'requester',
        ({ actor }) => {
          engine.featureState.reachable = (user) => user.id !== actor.id;
        },
      ],
      [
        'the requester account is deleted',
        'requester',
        async ({ actor }) => {
          await engine.deleteUser(actor.id);
        },
      ],
      [
        'the file gets another text',
        'source-changed',
        ({ book }) => {
          engine.featureState.subjects.get(String(book.fileId))!.key = `text-${randomUUID()}`;
        },
      ],
      [
        'the file can no longer be read',
        'unreadable',
        ({ book }) => {
          engine.featureState.subjects.delete(String(book.fileId));
        },
      ],
    ];

    async function queued(passages = 3) {
      const actor = await engine.user();
      const book = engine.book(passages);
      const job = await engine.request('build', book.ref, actor);
      return { actor, book, job };
    }

    it.each(CHANGES)('fails the job at its claim when %s, sending nothing', async (_label, reason, change) => {
      const target = await queued();
      await change(target);
      expect(await engine.runUntil(target.job.id, ['failed'])).toMatchObject({ status: 'failed', reason });
      expect(engine.client.calls).toHaveLength(0);
      expect(engine.portsState.released).toContain(target.job.id);
      const failure = (await engine.events(target.job.id)).find((event) => event.code === 'failed');
      expect(failure?.data).toMatchObject({ reason });
    });

    it.each(CHANGES)('fails the job before its next step when %s mid-build', async (_label, reason, change) => {
      const target = await queued(4);
      let changed = false;
      engine.client.handler = async (request) => {
        if (request.slot === 'fast' && !changed) {
          changed = true;
          await change(target);
        }
        return defaultAnswer(request);
      };
      const failed = await engine.runUntil(target.job.id, ['failed']);
      expect(failed).toMatchObject({ status: 'failed', reason });
      expect(engine.runsOf(target.job.id, 'names')).toHaveLength(4);
      expect(engine.runsOf(target.job.id, 'summary')).toHaveLength(0);
      expect(await engine.artifacts.findInfo(engine.feature.id, target.book.key)).toBeNull();
    });

    it('tells a requester who can still build that the job failed, and no one who cannot', async () => {
      const unreadable = await queued();
      engine.featureState.subjects.delete(String(unreadable.book.fileId));
      await engine.runUntil(unreadable.job.id, ['failed']);
      expect(engine.sent.filter((notice) => notice.meta?.jobId === unreadable.job.id)).toHaveLength(1);

      const lost = await queued();
      engine.updateUser(lost.actor.id, { permissions: [] });
      await engine.runUntil(lost.job.id, ['failed']);
      expect(engine.sent.filter((notice) => notice.meta?.jobId === lost.job.id)).toHaveLength(0);
    });

    it('lets a superuser without the permission run a job', async () => {
      const admin = await engine.user({ permissions: [], isSuperuser: true });
      const book = engine.book(3);
      const job = await engine.request('build', book.ref, admin);
      expect(await engine.runUntil(job.id)).toMatchObject({ status: 'completed' });
    });

    it('lets another manager take over a job whose requester lost the permission, with Try again', async () => {
      const target = await queued(4);
      engine.updateUser(target.actor.id, { permissions: [] });
      await engine.runUntil(target.job.id, ['failed']);

      const manager = await engine.user();
      expect(await engine.service.retry({ feature: engine.feature.id, subjectRef: target.book.ref, actor: manager })).toMatchObject({
        kind: 'resumed',
        job: { requestedBy: manager.id },
      });
      expect(await engine.runUntil(target.job.id)).toMatchObject({ status: 'completed', requestedBy: manager.id });
      expect(engine.sent.filter((notice) => notice.meta?.jobId === target.job.id)).toEqual([
        expect.objectContaining({ scope: { kind: 'user', userId: manager.id } }),
      ]);
    });

    it('takes over a paused job too, so it does not fail on its requester when it resumes', async () => {
      const target = await queued();
      engine.portsState.settings.enabled = false;
      await engine.runUntil(target.job.id, ['paused']);
      engine.updateUser(target.actor.id, { active: false });
      engine.portsState.settings.enabled = true;

      const manager = await engine.user();
      expect(await engine.service.retry({ feature: engine.feature.id, subjectRef: target.book.ref, actor: manager })).toMatchObject({
        kind: 'resumed',
        job: { requestedBy: manager.id },
      });
      expect(await engine.runUntil(target.job.id)).toMatchObject({ status: 'completed' });
    });
  });

  /**
   * Coverage is the share of units each step finished. Only a reason another try would not fix
   * leaves a unit out: a refusal, a filter, JSON still invalid after the repair retry, or a reply
   * still cut short at 1,000 characters. An outage pauses the job instead.
   */
  describe('coverage', () => {
    let engine!: AiJobsEngine;

    beforeEach(() => {
      engine = createAiJobsEngine(db);
    });

    afterEach(async () => {
      await engine.stopWorkers();
    });

    function passageIndex(request: AiRequest): number | null {
      const match = /^Passage (\d+) /.exec(request.user);
      return match ? Number(match[1]) : null;
    }

    function refused(request: AiRequest, finish: 'refused' | 'filtered' = 'refused') {
      return { ...defaultAnswer(request), finish, json: undefined };
    }

    async function queued(passages: number) {
      const actor = await engine.user();
      const book = engine.book(passages);
      const job = await engine.request('build', book.ref, actor);
      return { actor, book, job };
    }

    async function skippedUnits(jobId: string) {
      return (await engine.events(jobId)).filter((event) => event.code === 'unit_skipped').map((event) => event.data);
    }

    it('pauses on a provider outage and never lowers coverage', async () => {
      const target = await queued(10);
      let outage = true;
      engine.client.handler = (request) => {
        const index = passageIndex(request);
        if (outage && (index === 3 || index === 7)) {
          engine.portsState.health = 'provider-down';
          return Promise.reject(new AiError('provider-down', 'retries ran out'));
        }
        return defaultAnswer(request);
      };
      expect(await engine.runUntil(target.job.id, ['paused'])).toMatchObject({ status: 'paused', reason: 'provider-down', phase: 'names' });
      await engine.lifecycle.resumePaused();
      expect((await engine.job(target.job.id)).status).toBe('paused');

      outage = false;
      engine.portsState.health = null;
      await engine.lifecycle.resumePaused();
      expect(await engine.runUntil(target.job.id)).toMatchObject({ status: 'completed' });
      expect(await engine.artifacts.findInfo(engine.feature.id, target.book.key)).toMatchObject({ coverage: 1 });
      expect(await skippedUnits(target.job.id)).toEqual([]);
      const names = engine.runsOf(target.job.id, 'names').map((run) => run.unit);
      expect(names.filter((unit) => unit === 'p3' || unit === 'p7')).toHaveLength(4);
      expect(names).toHaveLength(12);
    });

    it('fails low-coverage, naming the step, when 11% of its units are refused', async () => {
      const target = await queued(100);
      engine.client.handler = (request) => ((passageIndex(request) ?? 100) < 11 ? refused(request) : defaultAnswer(request));
      expect(await engine.runUntil(target.job.id, ['failed'])).toMatchObject({ status: 'failed', reason: 'low-coverage', phase: 'names' });
      const failure = (await engine.events(target.job.id)).find((event) => event.code === 'failed');
      expect(failure).toMatchObject({ step: 'names', data: { reason: 'low-coverage', detail: 'Step names finished 89 of 100 units' } });
      expect(await skippedUnits(target.job.id)).toHaveLength(11);
      expect(engine.runsOf(target.job.id, 'summary')).toHaveLength(0);
      expect(await engine.artifacts.findInfo(engine.feature.id, target.book.key)).toBeNull();
      expect(engine.sent.filter((notice) => notice.meta?.jobId === target.job.id)).toEqual([
        expect.objectContaining({ meta: expect.objectContaining({ reason: 'low-coverage' }) }),
      ]);

      // Another model reruns the refused units; the build no longer fails.
      engine.portsState.models.fast = { connectionId: 1, model: 'fast-model-2' };
      engine.client.handler = (request) => defaultAnswer(request);
      const next = await engine.request('build', target.book.ref, target.actor);
      expect(await engine.runUntil(next.id)).toMatchObject({ status: 'completed' });
      expect(engine.runsOf(next.id, 'names')).toHaveLength(100);
      expect(await engine.artifacts.findInfo(engine.feature.id, target.book.key)).toMatchObject({ coverage: 1 });
    });

    it('builds at exactly 90%, leaving out units for each reason that skips one, and records the coverage', async () => {
      const target = await queued(100);
      const passages = engine.featureState.subjects.get(String(target.book.fileId))!.passages;
      passages[50] = `Passage 50 ${'Unsplittable '.repeat(300)}`.trim();
      passages[60] = `Passage 60 names Person60 ${'filler '.repeat(250)}`.trim();
      engine.client.handler = (request) => {
        if (request.slot === 'careful') return defaultAnswer(request);
        if (request.user.includes('Unsplittable') || request.user.length > 1_000) return Promise.reject(new AiError('too-long'));
        const index = passageIndex(request);
        if (index !== null && index < 5) return refused(request);
        if (index !== null && index < 8) return refused(request, 'filtered');
        if (index === 8) return Promise.reject(new AiError('invalid-json'));
        return defaultAnswer(request);
      };
      expect(await engine.runUntil(target.job.id)).toMatchObject({ status: 'completed' });
      expect(await engine.artifacts.findInfo(engine.feature.id, target.book.key)).toMatchObject({ coverage: 0.9 });
      const reasons = (await skippedUnits(target.job.id)).map((data) => data?.reason);
      expect(reasons.sort()).toEqual([
        'filtered',
        'filtered',
        'filtered',
        'invalid-json',
        'refused',
        'refused',
        'refused',
        'refused',
        'refused',
        'too-long',
      ]);

      // The long passage that fit once halved was not left out, and kept its names.
      const [stored] = await db.select().from(schema.aiArtifacts).where(eq(schema.aiArtifacts.subjectKey, target.book.key));
      const payload = JSON.parse(gunzipSync(stored!.payload).toString()) as { names: string[]; coverage: number };
      expect(payload.names).toContain('Person60');
      expect(payload.coverage).toBe(0.9);
    });
  });

  describe('notifications and audit', () => {
    let engine!: AiJobsEngine;

    beforeEach(() => {
      engine = createAiJobsEngine(db);
    });

    afterEach(async () => {
      await engine.stopWorkers();
    });

    async function queued(passages = 3) {
      const actor = await engine.user();
      const book = engine.book(passages);
      const job = await engine.request('build', book.ref, actor);
      return { actor, book, job };
    }

    function noticesFor(jobId: string) {
      return engine.sent.filter((notice) => notice.meta?.jobId === jobId);
    }

    it('tells the requester once when a job finishes, once when it fails, and never for a pause or a cancel', async () => {
      const finished = await queued();
      await engine.runUntil(finished.job.id);
      expect(noticesFor(finished.job.id)).toEqual([
        {
          type: NotificationType.ReadAloudReady,
          title: 'Fake guide ready',
          actionUrl: `/book/${String(finished.book.ref.bookId)}`,
          meta: { bookId: finished.book.ref.bookId, jobId: finished.job.id, feature: engine.feature.id, kind: 'build', reason: null },
          scope: { kind: 'user', userId: finished.actor.id },
        },
      ]);

      const failing = await queued();
      engine.client.handler = () => Promise.reject(new Error('unexpected reply'));
      await engine.runUntil(failing.job.id, ['failed']);
      expect(noticesFor(failing.job.id)).toEqual([
        expect.objectContaining({ type: NotificationType.ReadAloudFailed, meta: expect.objectContaining({ reason: 'error' }) }),
      ]);
      engine.client.handler = (request) => defaultAnswer(request);

      const paused = await queued();
      engine.portsState.settings.enabled = false;
      await engine.runUntil(paused.job.id, ['paused']);
      engine.portsState.settings.enabled = true;
      await engine.service.cancel({ feature: engine.feature.id, subjectKey: paused.book.key, actor: paused.actor });
      expect(noticesFor(paused.job.id)).toEqual([]);
    });

    it('tells the requester once even when a run that lost its lease finishes late', async () => {
      const target = await queued(4);
      engine.client.handler = (request) => (request.slot === 'careful' ? hangUntilAborted(request) : defaultAnswer(request));
      const late = new AbortController();
      const claimed = await engine.jobs.claimNext(engine.feature.id, 'slow-server', 60_000, 1);
      const lateRun = engine.runner.run(claimed!, 'slow-server', late);
      await eventually(() => expect(engine.client.callsFor('careful')).toHaveLength(1));
      await db
        .update(schema.aiJobs)
        .set({ leaseUntil: new Date(Date.now() - 1000) })
        .where(eq(schema.aiJobs.id, target.job.id));
      await engine.lifecycle.recoverExpired();

      engine.client.handler = (request) => defaultAnswer(request);
      await engine.runUntil(target.job.id);
      late.abort();
      await lateRun;
      expect(noticesFor(target.job.id)).toHaveLength(1);
    });

    it('audits each action a person takes against the book, and nothing the engine does on its own', async () => {
      const target = await queued();
      await engine.runUntil(target.job.id);
      const rebuild = await engine.request('rebuild', target.book.ref, target.actor);
      await engine.service.cancel({ feature: engine.feature.id, subjectKey: target.book.key, actor: target.actor });

      engine.portsState.settings.enabled = false;
      const again = await engine.request('rebuild', target.book.ref, target.actor);
      await engine.runUntil(again.id, ['paused']);
      engine.portsState.settings.enabled = true;
      await engine.lifecycle.resumePaused();
      await engine.runUntil(again.id);

      const manager = await engine.user();
      const failing = await queued();
      engine.client.handler = () => Promise.reject(new Error('unexpected reply'));
      await engine.runUntil(failing.job.id, ['failed']);
      engine.client.handler = (request) => defaultAnswer(request);
      await engine.service.retry({ feature: engine.feature.id, subjectRef: failing.book.ref, actor: manager });
      await engine.service.remove({ feature: engine.feature.id, subjectKey: target.book.key, subjectRef: target.book.ref, actor: manager });

      expect(engine.audits.map((entry) => [entry.action, entry.userId, entry.resource, entry.resourceId, entry.meta?.jobId ?? null])).toEqual([
        [AuditAction.AiJobBuild, target.actor.id, AuditResource.Book, target.book.ref.bookId, target.job.id],
        [AuditAction.AiJobRebuild, target.actor.id, AuditResource.Book, target.book.ref.bookId, rebuild.id],
        [AuditAction.AiJobCancel, target.actor.id, AuditResource.Book, target.book.ref.bookId, rebuild.id],
        [AuditAction.AiJobRebuild, target.actor.id, AuditResource.Book, target.book.ref.bookId, again.id],
        [AuditAction.AiJobBuild, failing.actor.id, AuditResource.Book, failing.book.ref.bookId, failing.job.id],
        [AuditAction.AiJobRetry, manager.id, AuditResource.Book, failing.book.ref.bookId, failing.job.id],
        [AuditAction.AiJobOutputDelete, manager.id, AuditResource.Book, target.book.ref.bookId, null],
      ]);
      expect(engine.audits.every((entry) => entry.meta?.feature === engine.feature.id)).toBe(true);
    });

    it('removes the artifact, cancelling an unfinished rebuild first so it cannot write a new one', async () => {
      const target = await queued(4);
      await engine.runUntil(target.job.id);
      engine.client.handler = (request) => (request.slot === 'careful' ? hangUntilAborted(request) : defaultAnswer(request));
      const rebuild = await engine.request('rebuild', target.book.ref, target.actor);
      await engine.local.tick();
      await eventually(() => expect(engine.client.callsFor('careful').length).toBeGreaterThan(1));

      const result = await engine.service.remove({
        feature: engine.feature.id,
        subjectKey: target.book.key,
        subjectRef: target.book.ref,
        actor: target.actor,
      });
      expect(result).toMatchObject({ removed: true, cancelled: { id: rebuild.id, status: 'cancelled' } });
      await engine.local.idle();
      expect(await engine.artifacts.findInfo(engine.feature.id, target.book.key)).toBeNull();
      expect(await engine.service.readArtifact(engine.feature.id, target.book.key, [1, 2])).toEqual({ kind: 'none' });
    });

    it('serves the artifact in the newest format the caller reads', async () => {
      const target = await queued(2);
      await engine.runUntil(target.job.id);
      const newest = await engine.service.readArtifact(engine.feature.id, target.book.key, [1, 2]);
      expect(newest).toMatchObject({ kind: 'found', format: 2, body: { format: 2, names: ['Person0', 'Place0', 'Person1', 'Place1'] } });
      expect(await engine.service.readArtifact(engine.feature.id, target.book.key, [1])).toMatchObject({ kind: 'found', format: 1 });
      expect(await engine.service.readArtifact(engine.feature.id, target.book.key, [3])).toEqual({ kind: 'format' });
    });
  });
});
