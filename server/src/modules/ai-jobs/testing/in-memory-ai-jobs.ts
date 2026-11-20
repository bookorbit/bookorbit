import { randomUUID } from 'crypto';
import { EMPTY_CONTENT_FILTER_RULES, type Permission } from '@bookorbit/types';

import type { RequestUser } from '../../../common/types/request-user';
import type { AiJobRow } from '../../../db/schema';
import type { UserService } from '../../user/user.service';
import { AiFeatureRegistry } from '../ai-feature.registry';
import type { AiJobActivityService } from '../ai-job-activity.service';
import { AiJobChecks } from '../ai-job-checks.service';
import type { AiJobRepository } from '../ai-job.repository';
import { AiJobRunner } from '../ai-job-runner.service';
import type { AiJobStepRepository, CachedUnit } from '../ai-job-step.repository';
import { createFakeAiFeature, createFakeFeatureState, createFakePorts, fakeRef, fakeSubject } from './fake-ai-feature';

/**
 * The runner with in-memory stand-ins for its repositories, for unit tests of its decisions. The
 * repositories' SQL is covered against PostgreSQL by the ai-jobs e2e suite.
 */
export function createRunnerHarness() {
  const featureState = createFakeFeatureState();
  const feature = createFakeAiFeature(featureState);
  const { ports, state: portsState, client } = createFakePorts();
  const registry = new AiFeatureRegistry();
  registry.register(feature);

  const people = new Map<number, RequestUser>();
  const users = { findByIdWithPermissions: (id: number) => Promise.resolve(people.get(id) ?? null) } as unknown as UserService;

  const cache = new Map<string, CachedUnit & { generation: number }>();
  const saves: { step: string; unit: string; fingerprint: string; value: CachedUnit }[] = [];
  const steps = {
    lookup: (scope: { feature: string; subjectKey: string; step: string }, units: { unit: string; fingerprint: string }[]) => {
      const found = new Map<string, CachedUnit>();
      for (const entry of units) {
        const hit = cache.get(cacheKey(scope.subjectKey, scope.step, entry.unit, entry.fingerprint));
        if (hit) found.set(entry.unit, hit.outcome === 'ok' ? { outcome: 'ok', result: hit.result } : { outcome: 'skipped', reason: hit.reason });
      }
      return Promise.resolve(found);
    },
    save: (scope: { subjectKey: string; step: string }, saved: { unit: string; fingerprint: string; generation: number; value: CachedUnit }) => {
      const key = cacheKey(scope.subjectKey, scope.step, saved.unit, saved.fingerprint);
      if (!cache.has(key)) cache.set(key, { ...saved.value, generation: saved.generation });
      saves.push({ step: scope.step, unit: saved.unit, fingerprint: saved.fingerprint, value: saved.value });
      return Promise.resolve();
    },
  } as unknown as AiJobStepRepository;

  const jobState = {
    running: true,
    models: null as AiJobRow['models'],
    usage: { tokens: 0, costMicros: 0 },
    progress: [] as { phase: string; done: number; total: number }[],
  };
  const jobs = {
    setModels: (_id: string, _owner: string, models: AiJobRow['models']) => {
      jobState.models = models;
      return Promise.resolve(jobState.running);
    },
    setProgress: (_id: string, _owner: string, progress: { phase: string; done: number; total: number }) => {
      jobState.progress.push(progress);
      return Promise.resolve();
    },
    addUsage: (_id: string, tokens: number, costMicros: number | null) => {
      jobState.usage.tokens += tokens;
      jobState.usage.costMicros += costMicros ?? 0;
      return Promise.resolve();
    },
    isRunningFor: () => Promise.resolve(jobState.running),
  } as unknown as AiJobRepository;

  const events: { code: string; step: string | null; data: unknown }[] = [];
  const activity = {
    record: (_jobId: string, _level: string, step: string | null, code: string, data: unknown = null) => {
      events.push({ code, step, data });
      return Promise.resolve();
    },
  } as unknown as AiJobActivityService;

  const runner = new AiJobRunner(registry, jobs, steps, new AiJobChecks(users), activity, ports);

  function user(change: Partial<RequestUser> = {}): RequestUser {
    const id = people.size + 1;
    const value: RequestUser = {
      id,
      username: `user-${id}`,
      name: `User ${id}`,
      email: null,
      active: true,
      isSuperuser: false,
      isDefaultPassword: false,
      tokenVersion: 0,
      settings: {},
      avatarUrl: null,
      provisioningMethod: 'local',
      permissions: [feature.permission as Permission],
      contentFilters: EMPTY_CONTENT_FILTER_RULES,
      ...change,
    };
    people.set(id, value);
    return value;
  }

  function job(passages = 4, change: Partial<AiJobRow> = {}): AiJobRow {
    const requester = user();
    const fileId = featureState.subjects.size + 1;
    const key = `text-${fileId}`;
    featureState.subjects.set(String(fileId), fakeSubject(key, passages));
    const now = new Date();
    return {
      id: randomUUID(),
      feature: feature.id,
      kind: 'build',
      subjectKey: key,
      subjectRef: fakeRef(fileId),
      pipeline: feature.pipeline,
      generation: 1,
      status: 'running',
      phase: null,
      done: 0,
      total: 0,
      reason: null,
      requestedBy: requester.id,
      leaseOwner: 'owner',
      leaseUntil: new Date(now.getTime() + 60_000),
      attempts: 1,
      priority: 0,
      nextAttemptAt: now,
      models: null,
      estimate: { words: 100, minutes: 1, cost: 0.01 },
      tokens: 0,
      costMicros: null,
      capRaises: 0,
      pausedAt: null,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: null,
      dismissedAt: null,
      ...change,
    };
  }

  async function run(row: AiJobRow, controller = new AbortController()) {
    return await runner.run(row, 'owner', controller);
  }

  return { feature, featureState, ports, portsState, client, registry, runner, people, users, cache, saves, jobState, events, user, job, run };
}

function cacheKey(subjectKey: string, step: string, unit: string, fingerprint: string): string {
  return `${subjectKey}|${step}|${unit}|${fingerprint}`;
}
