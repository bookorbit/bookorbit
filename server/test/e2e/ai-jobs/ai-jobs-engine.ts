import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { EMPTY_CONTENT_FILTER_RULES, Permission, type AiJobKind, type AiJobSubjectRef } from '@bookorbit/types';

import type { RequestUser } from '../../../src/common/types/request-user';
import * as schema from '../../../src/db/schema';
import { AiArtifactRepository } from '../../../src/modules/ai-jobs/ai-artifact.repository';
import { AiFeatureRegistry } from '../../../src/modules/ai-jobs/ai-feature.registry';
import { AiJobActivityService } from '../../../src/modules/ai-jobs/ai-job-activity.service';
import { AI_JOB_CHANGED, AiJobChanges, type AiJobChange } from '../../../src/modules/ai-jobs/ai-job-changes.service';
import { AiJobChecks } from '../../../src/modules/ai-jobs/ai-job-checks.service';
import { AiJobEventRepository } from '../../../src/modules/ai-jobs/ai-job-event.repository';
import { AiJobLifecycle } from '../../../src/modules/ai-jobs/ai-job-lifecycle.service';
import { AiJobNotifier } from '../../../src/modules/ai-jobs/ai-job-notifier.service';
import { AiJobPauses } from '../../../src/modules/ai-jobs/ai-job-pauses.service';
import { AiJobQueueService } from '../../../src/modules/ai-jobs/ai-job-queue.service';
import { AiJobRepository } from '../../../src/modules/ai-jobs/ai-job.repository';
import { AiJobRunner } from '../../../src/modules/ai-jobs/ai-job-runner.service';
import { AiJobStepRepository } from '../../../src/modules/ai-jobs/ai-job-step.repository';
import { AiJobWorker } from '../../../src/modules/ai-jobs/ai-job-worker.service';
import { AiJobsService } from '../../../src/modules/ai-jobs/ai-jobs.service';
import { AiStepRates } from '../../../src/modules/ai-jobs/ai-step-rates.service';
import { AiStepTimingRepository } from '../../../src/modules/ai-jobs/ai-step-timing.repository';
import {
  createFakeAiFeature,
  createFakeFeatureState,
  createFakePorts,
  fakeRef,
  fakeSubject,
} from '../../../src/modules/ai-jobs/testing/fake-ai-feature';
import type { AuditEventPayload } from '../../../src/modules/audit/audit-events.service';
import type { AuditService } from '../../../src/modules/audit/audit.service';
import type { NotificationService } from '../../../src/modules/notification/notification.service';
import type { UserService } from '../../../src/modules/user/user.service';
import { insertUser, type AiJobsDb } from './ai-jobs-db';

/**
 * The engine's real repositories and services against PostgreSQL, with the fake feature, fake ports
 * and in-memory users and notifications. Workers are created on demand, so a test can run two.
 */
export function createAiJobsEngine(db: AiJobsDb) {
  const featureState = createFakeFeatureState();
  // Each engine has its own feature id, so tests never claim each other's jobs.
  const feature = createFakeAiFeature(featureState, `fake-${randomUUID().slice(0, 8)}`);
  const { ports, state: portsState, client } = createFakePorts();
  const registry = new AiFeatureRegistry();
  registry.register(feature);

  const people = new Map<number, RequestUser>();
  const users = { findByIdWithPermissions: (id: number) => Promise.resolve(people.get(id) ?? null) } as unknown as UserService;
  const sent: Parameters<NotificationService['notify']>[0][] = [];
  const notifications = {
    notify: (payload: Parameters<NotificationService['notify']>[0]) => {
      sent.push(payload);
      return Promise.resolve();
    },
  } as unknown as NotificationService;

  const changes = new AiJobChanges();
  /** Every change the repository announced, in order. */
  const announced: AiJobChange[] = [];
  changes.on(AI_JOB_CHANGED, (change: AiJobChange) => announced.push(change));
  const jobs = new AiJobRepository(db, changes);
  const steps = new AiJobStepRepository(db);
  const activity = new AiJobActivityService(new AiJobEventRepository(db));
  const artifacts = new AiArtifactRepository(db);
  const checks = new AiJobChecks(users);
  const runner = new AiJobRunner(registry, jobs, steps, checks, activity, ports);
  const rates = new AiStepRates(new AiStepTimingRepository(db));
  const notifier = new AiJobNotifier(registry, users, notifications);
  const pauses = new AiJobPauses(ports);
  const lifecycle = new AiJobLifecycle(registry, jobs, steps, pauses, activity, notifier, ports);
  // The service's own worker: the one a cancel on "this server" stops at once.
  const local = new AiJobWorker(registry, jobs, runner, activity, notifier, rates, ports);
  const audits: AuditEventPayload[] = [];
  const audit = {
    record: (payload: AuditEventPayload) => {
      audits.push(payload);
      return Promise.resolve();
    },
  } as unknown as AuditService;
  const service = new AiJobsService(registry, jobs, artifacts, activity, pauses, local, audit, ports);
  const queue = new AiJobQueueService(registry, jobs, service);
  const workers: AiJobWorker[] = [local];

  let nextFileId = Math.floor(Math.random() * 1_000_000) * 100;

  return {
    db,
    feature,
    featureState,
    announced,
    ports,
    portsState,
    client,
    registry,
    jobs,
    steps,
    activity,
    artifacts,
    runner,
    rates,
    notifier,
    lifecycle,
    service,
    queue,
    sent,
    audits,
    /** The worker on the same server as the service. */
    local,

    worker(): AiJobWorker {
      const worker = new AiJobWorker(registry, jobs, runner, activity, notifier, rates, ports);
      workers.push(worker);
      return worker;
    },

    /** Asks for a job as `actor` and returns it; any other answer fails the test. */
    async request(kind: AiJobKind, ref: AiJobSubjectRef, actor: RequestUser): Promise<schema.AiJobRow> {
      const result = await service.request({ feature: feature.id, kind, subjectRef: ref, actor });
      if (result.kind !== 'created') throw new Error(`expected a ${kind} job, got ${JSON.stringify(result)}`);
      return result.job;
    },

    /** Ticks the local worker until the job reaches one of these statuses, and returns its row. */
    async runUntil(jobId: string, statuses: readonly string[] = ['completed']): Promise<schema.AiJobRow> {
      const worker = local;
      let row: schema.AiJobRow | undefined;
      await eventually(async () => {
        await worker.tick();
        row = await this.job(jobId);
        expect(statuses).toContain(row.status);
      });
      await worker.idle();
      return await this.job(jobId);
    },

    async stopWorkers(): Promise<void> {
      await Promise.all(workers.map((worker) => worker.onApplicationShutdown()));
    },

    async user(options: { permissions?: Permission[]; isSuperuser?: boolean; active?: boolean } = {}): Promise<RequestUser> {
      const id = await insertUser(db, options);
      const user: RequestUser = {
        id,
        username: `ai-jobs-${id}`,
        name: `AI jobs ${id}`,
        email: null,
        active: options.active ?? true,
        isSuperuser: options.isSuperuser ?? false,
        isDefaultPassword: false,
        tokenVersion: 0,
        settings: {},
        avatarUrl: null,
        provisioningMethod: 'local',
        permissions: options.permissions ?? [feature.permission],
        contentFilters: EMPTY_CONTENT_FILTER_RULES,
      };
      people.set(id, user);
      return user;
    },

    updateUser(id: number, change: Partial<RequestUser>): void {
      people.set(id, { ...people.get(id)!, ...change });
    },

    /** Deletes the account, which clears `requested_by` on its jobs. */
    async deleteUser(id: number): Promise<void> {
      await db.delete(schema.users).where(eq(schema.users.id, id));
      people.delete(id);
    },

    /** A file whose fake text has `passages` passages, under a fresh text key. */
    book(passages = 10): { ref: ReturnType<typeof fakeRef>; key: string; fileId: number } {
      const fileId = ++nextFileId;
      const key = `text-${randomUUID()}`;
      featureState.subjects.set(String(fileId), fakeSubject(key, passages));
      return { ref: fakeRef(fileId), key, fileId };
    },

    async job(id: string) {
      const [row] = await db.select().from(schema.aiJobs).where(eq(schema.aiJobs.id, id));
      return row!;
    },

    async events(id: string) {
      return await activity.list(id, null);
    },

    runsOf(jobId: string, step?: string) {
      return featureState.runs.filter((run) => run.jobId === jobId && (!step || run.step === step));
    },
  };
}

export type AiJobsEngine = ReturnType<typeof createAiJobsEngine>;

/** Retries the check until it passes or the time runs out, then throws its last failure. */
export async function eventually(check: () => Promise<void> | void, timeoutMs = 15_000, pollMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}
