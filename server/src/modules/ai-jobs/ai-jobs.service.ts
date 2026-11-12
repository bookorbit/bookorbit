import { gunzipSync } from 'zlib';
import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, type AiJobKind, type AiJobModels, type AiJobPauseReason, type AiJobSubjectRef } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { isUniqueViolation } from '../../common/utils/db-error.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { AiJobRow } from '../../db/schema';
import { AiJobFailure, slotsOf, type AiFeature, type AiRefusal, type AiSubject } from './ai-feature';
import { AiFeatureRegistry } from './ai-feature.registry';
import { AiArtifactRepository, type AiArtifactInfo } from './ai-artifact.repository';
import { AiJobActivityService } from './ai-job-activity.service';
import { mayRun } from './ai-job-checks.service';
import { AiJobPauses } from './ai-job-pauses.service';
import { AiJobRepository } from './ai-job.repository';
import { AiJobWorker } from './ai-job-worker.service';
import { AI_JOBS_FAILED_VISIBLE_MS } from './ai-jobs.constants';
import { AI_JOBS_PORTS, type AiJobsPorts, type AiSlot } from './ai-jobs.ports';
import { AuditService } from '../audit/audit.service';

export interface AiJobRequest {
  feature: string;
  kind: AiJobKind;
  subjectRef: AiJobSubjectRef;
  actor: RequestUser;
}

export type AiJobRequestResult =
  | { kind: 'created'; job: AiJobRow }
  /** The subject already has an unfinished job. */
  | { kind: 'conflict'; job: AiJobRow }
  | { kind: 'refused'; refusal: AiRefusal };

export interface AiJobStatus {
  /** An unfinished job, or a failed one nobody dismissed or retried in the last 30 days. */
  job: AiJobRow | null;
  /** For a queued job: the jobs of the feature that run before it. */
  ahead: number | null;
  artifact: AiArtifactInfo | null;
}

export type AiJobRetryResult =
  /** Back in the queue: a paused job whose cause cleared, Continue, or a failed job. */
  | { kind: 'resumed'; job: AiJobRow }
  /** The cause is still there; `reason` is the one that holds now. */
  | { kind: 'still-paused'; job: AiJobRow; reason: AiJobPauseReason }
  /** A failed job whose subject has another unfinished job by now. */
  | { kind: 'conflict'; job: AiJobRow }
  | { kind: 'refused'; refusal: AiRefusal }
  /** Nothing to try again: no job, or one that is queued or running. */
  | { kind: 'none'; job: AiJobRow | null };

export type AiJobCancelResult =
  | { kind: 'cancelled'; job: AiJobRow }
  /** A failed job taken out of status. */
  | { kind: 'dismissed'; job: AiJobRow }
  | { kind: 'none'; job: AiJobRow | null };

export interface AiJobAction {
  feature: string;
  subjectKey: string;
  actor: RequestUser;
}

export type AiArtifactRead =
  | { kind: 'found'; format: number; body: unknown; sha256: string; builtAt: Date }
  /** No artifact for the subject. */
  | { kind: 'none' }
  /** None of the asked formats can be rendered from the stored artifact. */
  | { kind: 'format' };

const AUDIT_ACTION_BY_KIND: Record<AiJobKind, AuditAction> = {
  build: AuditAction.AiJobBuild,
  update: AuditAction.AiJobUpdate,
  rebuild: AuditAction.AiJobRebuild,
};

/** What features and their routes call: start, retry, cancel and read jobs. */
@Injectable()
export class AiJobsService {
  private readonly logger = new Logger(AiJobsService.name);

  constructor(
    private readonly registry: AiFeatureRegistry,
    private readonly jobs: AiJobRepository,
    private readonly artifacts: AiArtifactRepository,
    private readonly activity: AiJobActivityService,
    private readonly pauses: AiJobPauses,
    private readonly worker: AiJobWorker,
    private readonly audit: AuditService,
    @Inject(AI_JOBS_PORTS) private readonly ports: AiJobsPorts,
  ) {}

  /**
   * Queues a build, update or rebuild. An update needs an artifact from an older pipeline or older
   * models, a rebuild any artifact. A rebuild starts a new generation, which no cached unit matches.
   */
  async request(input: AiJobRequest): Promise<AiJobRequestResult> {
    const feature = this.manageable(input.feature, input.actor);
    const subject = await resolve(feature, input.subjectRef);
    if ('refusal' in subject) return { kind: 'refused', refusal: subject.refusal };
    const refusal = await feature.check(subject);
    if (refusal) return { kind: 'refused', refusal };
    const unfinished = await this.jobs.findUnfinished(feature.id, subject.key);
    if (unfinished) return { kind: 'conflict', job: unfinished };

    const artifact = await this.artifacts.findInfo(feature.id, subject.key);
    const models = await this.currentModels(feature);
    if (input.kind === 'rebuild' && !artifact) return { kind: 'refused', refusal: { reason: 'no-artifact' } };
    if (
      input.kind === 'update' &&
      !(artifact && (artifact.pipeline !== feature.pipeline || modelsChanged(artifact.models, models, slotsOf(feature))))
    ) {
      return { kind: 'refused', refusal: { reason: artifact ? 'up-to-date' : 'no-artifact' } };
    }
    const generation = await this.generationFor(feature, subject.key, input.kind, artifact);
    const estimate = await feature.estimate(subject, {
      kind: input.kind,
      generation,
      models,
      artifact: artifact ? { pipeline: artifact.pipeline, generation: artifact.generation, models: artifact.models } : null,
    });
    const job = await this.jobs.create({
      feature: feature.id,
      kind: input.kind,
      subjectKey: subject.key,
      subjectRef: input.subjectRef,
      pipeline: feature.pipeline,
      generation,
      requestedBy: input.actor.id,
      estimate,
    });
    if (!job) {
      const winner = await this.jobs.findUnfinished(feature.id, subject.key);
      if (winner) return { kind: 'conflict', job: winner };
      throw new Error('The job was neither created nor found');
    }
    await this.activity.record(job.id, 'info', null, 'requested', { kind: input.kind, generation, userId: input.actor.id });
    await this.recordAudit(feature, job, input.actor, AUDIT_ACTION_BY_KIND[input.kind], `Queued an AI ${input.kind} (${feature.id})`, {
      kind: input.kind,
      generation,
    });
    return { kind: 'created', job };
  }

  async artifactInfo(feature: string, subjectKey: string): Promise<AiArtifactInfo | null> {
    return await this.artifacts.findInfo(feature, subjectKey);
  }

  /** Reads only: no subject is resolved, so the caller passes the key it already has. */
  async status(feature: string, subjectKey: string): Promise<AiJobStatus> {
    this.feature(feature);
    const [job, artifact] = await Promise.all([this.shownJob(feature, subjectKey), this.artifacts.findInfo(feature, subjectKey)]);
    const ahead = job?.status === 'queued' ? await this.jobs.countAhead(job) : null;
    return { job, ahead, artifact };
  }

  /**
   * Try again. A paused job re-checks its cause now, testing the connections, and resumes if it
   * cleared; on an over-estimate pause it is Continue, which raises the cap by another three
   * estimates. A failed job goes back to the queue in its generation, reusing every saved unit.
   * Either way the caller becomes the requester.
   */
  async retry(input: Omit<AiJobRequest, 'kind'>): Promise<AiJobRetryResult> {
    const feature = this.manageable(input.feature, input.actor);
    const subject = await resolve(feature, input.subjectRef);
    if ('refusal' in subject) return { kind: 'refused', refusal: subject.refusal };
    const job = await this.shownJob(feature.id, subject.key);
    if (job?.status === 'paused') return await this.retryPaused(job, feature, input.actor);
    if (job?.status !== 'failed') return { kind: 'none', job };
    return await this.retryFailed(job, feature, subject, input.actor);
  }

  /**
   * Try again on one job, named by id as the AI area does: Resume or Continue on a paused job, Try
   * again on a failed one still shown. The caller must still reach the subject, and a failed job
   * whose subject changed since is refused, since its run would fail the same way.
   */
  async retryJob(jobId: string, actor: RequestUser): Promise<AiJobRetryResult> {
    const job = await this.jobs.findById(jobId);
    if (!job) return { kind: 'none', job: null };
    const feature = this.manageable(job.feature, actor);
    const shown = job.status === 'paused' || (job.status === 'failed' && failedAndShown(job, Date.now()));
    if (!shown) return { kind: 'none', job };
    if (!(await feature.canReach(actor, job.subjectRef))) return { kind: 'refused', refusal: { reason: 'requester' } };
    if (job.status === 'paused') return await this.retryPaused(job, feature, actor);
    const subject = await resolve(feature, job.subjectRef);
    if ('refusal' in subject) return { kind: 'refused', refusal: subject.refusal };
    if (subject.key !== job.subjectKey) return { kind: 'refused', refusal: { reason: 'source-changed' } };
    return await this.retryFailed(job, feature, subject, actor);
  }

  /** Stops a queued or running job until someone resumes it. Its saved units stay in the step cache. */
  async pauseJob(jobId: string, actor: RequestUser): Promise<AiJobRow | null> {
    const paused = await this.jobs.pauseByUser(jobId);
    if (!paused) return null;
    this.worker.stop(jobId);
    await this.activity.record(jobId, 'info', paused.phase, 'paused', { reason: 'user', userId: actor.id });
    await this.ports.budget.release(jobId).catch(() => undefined);
    const feature = this.registry.get(paused.feature);
    if (feature) {
      await this.recordAudit(feature, paused, actor, AuditAction.AiJobPause, `Paused an AI ${paused.kind} (${feature.id})`, { kind: paused.kind });
    }
    return paused;
  }

  /** Moves a queued job to the front of its feature's queue. */
  async prioritizeJob(jobId: string, actor: RequestUser): Promise<AiJobRow | null> {
    const moved = await this.jobs.prioritize(jobId);
    if (!moved) return null;
    await this.activity.record(jobId, 'info', null, 'prioritized', { userId: actor.id, priority: moved.priority });
    const feature = this.registry.get(moved.feature);
    if (feature) {
      await this.recordAudit(
        feature,
        moved,
        actor,
        AuditAction.AiJobPrioritize,
        `Moved an AI ${moved.kind} to the front of the queue (${feature.id})`,
        {
          kind: moved.kind,
          priority: moved.priority,
        },
      );
    }
    return moved;
  }

  /** Takes a failed job out of status; it stays in the history. */
  async dismissJob(jobId: string, actor: RequestUser): Promise<AiJobRow | null> {
    const dismissed = await this.jobs.dismiss(jobId);
    if (dismissed) await this.activity.record(jobId, 'info', null, 'dismissed', { userId: actor.id });
    return dismissed;
  }

  private async retryFailed(job: AiJobRow, feature: AiFeature, subject: AiSubject, actor: RequestUser): Promise<AiJobRetryResult> {
    const refusal = await feature.check(subject);
    if (refusal) return { kind: 'refused', refusal };
    let retried: AiJobRow | null;
    try {
      retried = await this.jobs.retryFailed(job.id, actor.id);
    } catch (error) {
      const other = isUniqueViolation(error) ? await this.jobs.findUnfinished(feature.id, subject.key) : null;
      if (other) return { kind: 'conflict', job: other };
      throw error;
    }
    if (!retried) return { kind: 'none', job: await this.jobs.findById(job.id) };
    await this.activity.record(job.id, 'info', null, 'retried', { userId: actor.id, reason: job.reason });
    await this.recordAudit(feature, retried, actor, AuditAction.AiJobRetry, `Tried a failed AI build again (${feature.id})`, {
      from: 'failed',
      reason: job.reason,
    });
    return { kind: 'resumed', job: retried };
  }

  /** Cancel on an unfinished job, Dismiss on a failed one. */
  async cancel(input: AiJobAction): Promise<AiJobCancelResult> {
    const feature = this.manageable(input.feature, input.actor);
    const job = await this.shownJob(feature.id, input.subjectKey);
    if (!job) return { kind: 'none', job: null };
    if (job.status === 'failed') {
      const dismissed = await this.dismissJob(job.id, input.actor);
      if (!dismissed) return { kind: 'none', job: await this.jobs.findById(job.id) };
      return { kind: 'dismissed', job: dismissed };
    }
    return await this.cancelJob(job.id, input.actor);
  }

  /**
   * Removes a subject's artifact, cancelling its unfinished job first so it cannot write a new one.
   * Its cached units stay until the sweep finds them unused.
   */
  async remove(input: AiJobAction & { subjectRef: AiJobSubjectRef }): Promise<{ removed: boolean; cancelled: AiJobRow | null }> {
    const feature = this.manageable(input.feature, input.actor);
    const unfinished = await this.jobs.findUnfinished(feature.id, input.subjectKey);
    const cancel = unfinished ? await this.cancelJob(unfinished.id, input.actor) : null;
    const removed = await this.artifacts.remove(feature.id, input.subjectKey);
    if (removed) {
      await this.recordAudit(
        feature,
        { subjectRef: input.subjectRef },
        input.actor,
        AuditAction.AiJobOutputDelete,
        `Deleted AI output (${feature.id})`,
        {
          cancelledJobId: cancel?.kind === 'cancelled' ? cancel.job.id : null,
        },
      );
    }
    return { removed, cancelled: cancel?.kind === 'cancelled' ? cancel.job : null };
  }

  /**
   * Moves a subject's artifact to the key its content has now, as when a feature's text rules
   * change. Nothing moves when the new key already has an artifact.
   */
  async moveArtifact(feature: string, fromKey: string, toKey: string): Promise<boolean> {
    this.feature(feature);
    return await this.artifacts.move(feature, fromKey, toKey);
  }

  /**
   * Removes every artifact of a feature, cancelling its unfinished jobs first so none writes a new
   * one. `expected` must equal the number stored now, so a stale page cannot remove more than it
   * showed; otherwise nothing is removed.
   */
  async removeAll(
    featureId: string,
    expected: number,
    actor: RequestUser,
  ): Promise<{ kind: 'removed'; removed: number; cancelled: number } | { kind: 'count-changed'; count: number }> {
    const feature = this.feature(featureId);
    const current = await this.artifacts.countForFeature(feature.id);
    if (current !== expected) return { kind: 'count-changed', count: current };
    let cancelled = 0;
    for (const jobId of await this.jobs.unfinishedIdsForFeature(feature.id)) {
      if ((await this.cancelJob(jobId, actor)).kind === 'cancelled') cancelled++;
    }
    const removed = await this.artifacts.removeAll(feature.id);
    await this.recordAudit(feature, { subjectRef: {} }, actor, AuditAction.AiJobOutputDelete, `Deleted all AI output (${feature.id})`, {
      removed,
      cancelled,
    });
    this.logger.log(`[ai_jobs.remove_all] [end] feature=${feature.id} removed=${removed} cancelled=${cancelled} - removed every artifact`);
    return { kind: 'removed', removed, cancelled };
  }

  async artifactSummary(feature: string): Promise<{ count: number; bytes: number }> {
    this.feature(feature);
    return await this.artifacts.summary(feature);
  }

  /** The connection and model each of the feature's slots uses now. */
  async models(featureId: string): Promise<AiJobModels> {
    return await this.currentModels(this.feature(featureId));
  }

  async subjectRefs(jobIds: readonly string[]): Promise<Map<string, AiJobSubjectRef>> {
    return await this.jobs.subjectRefs(jobIds);
  }

  async countArtifacts(feature: string): Promise<number> {
    this.feature(feature);
    return await this.artifacts.countForFeature(feature);
  }

  /**
   * The subject's artifact in the newest of `formats` the feature can still render it in. A client
   * names the formats it reads, so an older one keeps getting a shape it understands.
   */
  async readArtifact(feature: string, subjectKey: string, formats: readonly number[]): Promise<AiArtifactRead> {
    const definition = this.feature(feature);
    const row = await this.artifacts.findWithPayload(feature, subjectKey);
    if (!row) return { kind: 'none' };
    const stored: unknown = JSON.parse(gunzipSync(row.payload).toString('utf8'));
    for (const format of [...formats].sort((a, b) => b - a)) {
      if (!definition.formats.includes(format) || format > row.format) continue;
      const body = definition.render(stored, format);
      if (body !== null) return { kind: 'found', format, body, sha256: row.sha256, builtAt: row.builtAt };
    }
    return { kind: 'format' };
  }

  /**
   * Ends a queued, running or paused job now. A run on this server stops at once; one on another
   * server finds the job gone at its next request. Its saved units stay in the step cache.
   */
  async cancelJob(jobId: string, actor: RequestUser | null): Promise<AiJobCancelResult> {
    const cancelled = await this.jobs.cancel(jobId);
    if (!cancelled) return { kind: 'none', job: await this.jobs.findById(jobId) };
    this.worker.stop(jobId);
    await this.activity.record(jobId, 'info', cancelled.phase, 'cancelled', { userId: actor?.id ?? null });
    await this.ports.budget.release(jobId).catch(() => undefined);
    const feature = this.registry.get(cancelled.feature);
    if (actor && feature) {
      await this.recordAudit(feature, cancelled, actor, AuditAction.AiJobCancel, `Cancelled an AI ${cancelled.kind} (${feature.id})`, {
        kind: cancelled.kind,
        status: 'cancelled',
      });
    }
    return { kind: 'cancelled', job: cancelled };
  }

  /** Unfinished jobs that recorded this connection for a slot. */
  async countUnfinishedUsing(connectionId: number): Promise<number> {
    return await this.jobs.countUnfinishedUsing(connectionId);
  }

  /** Which of these jobs are still unfinished, so a reservation whose job ended can be dropped. */
  async unfinishedJobIds(jobIds: readonly string[]): Promise<string[]> {
    return await this.jobs.unfinishedIds(jobIds);
  }

  private async retryPaused(job: AiJobRow, feature: AiFeature, actor: RequestUser): Promise<AiJobRetryResult> {
    if (job.reason === 'over-estimate') {
      const continued = await this.jobs.resumePaused(job.id, { requestedBy: actor.id, raiseCap: true });
      if (!continued) return { kind: 'none', job: await this.jobs.findById(job.id) };
      await this.activity.record(job.id, 'info', null, 'continued', { userId: actor.id, capRaises: continued.capRaises });
      await this.recordAudit(feature, continued, actor, AuditAction.AiJobRetry, `Continued an AI build past its estimate (${feature.id})`, {
        from: 'paused',
        reason: 'over-estimate',
        capRaises: continued.capRaises,
      });
      return { kind: 'resumed', job: continued };
    }
    const blocker = await this.pauses.blocker(job, feature, true);
    if (blocker) {
      const current = blocker === job.reason ? job : ((await this.jobs.setPauseReason(job.id, blocker)) ?? job);
      await this.activity.record(job.id, 'info', null, 'still_paused', { userId: actor.id, reason: blocker });
      return { kind: 'still-paused', job: current, reason: blocker };
    }
    const resumed = await this.jobs.resumePaused(job.id, { requestedBy: actor.id });
    if (!resumed) return { kind: 'none', job: await this.jobs.findById(job.id) };
    await this.activity.record(job.id, 'info', null, 'resumed', { reason: job.reason, by: 'user', userId: actor.id });
    await this.recordAudit(feature, resumed, actor, AuditAction.AiJobRetry, `Resumed a paused AI build (${feature.id})`, {
      from: 'paused',
      reason: job.reason,
    });
    return { kind: 'resumed', job: resumed };
  }

  /** Best effort: the action already happened, so a lost audit row is logged rather than failing it. */
  private async recordAudit(
    feature: AiFeature,
    job: Pick<AiJobRow, 'subjectRef'> & Partial<Pick<AiJobRow, 'id'>>,
    actor: RequestUser,
    action: AuditAction,
    description: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    const target = feature.auditTarget(job.subjectRef);
    try {
      await this.audit.record({
        userId: actor.id,
        actorUsername: actor.username,
        action,
        ...(target ? { resource: target.resource, resourceId: target.resourceId } : {}),
        description,
        meta: { feature: feature.id, ...(job.id ? { jobId: job.id } : {}), ...meta },
      });
    } catch (error) {
      this.logger.warn(
        `[ai_jobs.audit] [fail] action=${action} feature=${feature.id} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - AI job audit entry not written`,
      );
    }
  }

  /** The unfinished job, else the latest job when it failed and is still shown. */
  private async shownJob(feature: string, subjectKey: string): Promise<AiJobRow | null> {
    const unfinished = await this.jobs.findUnfinished(feature, subjectKey);
    if (unfinished) return unfinished;
    const latest = await this.jobs.findLatest(feature, subjectKey);
    return latest && failedAndShown(latest, Date.now()) ? latest : null;
  }

  private manageable(id: string, actor: RequestUser): AiFeature {
    const feature = this.feature(id);
    if (!mayRun(actor, feature)) throw new ForbiddenException('Not allowed to build this');
    return feature;
  }

  /**
   * Build and update continue the subject's current generation, so they reuse its cached units;
   * a rebuild takes one no job has used yet.
   */
  private async generationFor(feature: AiFeature, subjectKey: string, kind: AiJobKind, artifact: AiArtifactInfo | null): Promise<number> {
    if (kind === 'rebuild') {
      const used = (await this.jobs.maxGeneration(feature.id, subjectKey)) ?? 0;
      return Math.max(used, artifact?.generation ?? 0) + 1;
    }
    if (artifact) return artifact.generation;
    return (await this.jobs.findLatest(feature.id, subjectKey))?.generation ?? 1;
  }

  private async currentModels(feature: AiFeature): Promise<AiJobModels> {
    return (await this.ports.slots.resolve(feature.id, slotsOf(feature))).models;
  }

  private feature(id: string): AiFeature {
    const feature = this.registry.get(id);
    if (!feature) throw new NotFoundException(`No AI feature ${id}`);
    return feature;
  }
}

async function resolve(feature: AiFeature, ref: AiJobSubjectRef): Promise<AiSubject | { refusal: AiRefusal }> {
  try {
    return await feature.resolveSubject(ref);
  } catch (error) {
    if (error instanceof AiJobFailure) return { refusal: { reason: error.reason } };
    throw error;
  }
}

export function failedAndShown(job: Pick<AiJobRow, 'status' | 'dismissedAt' | 'finishedAt'>, now: number): boolean {
  return job.status === 'failed' && !job.dismissedAt && (job.finishedAt?.getTime() ?? now) > now - AI_JOBS_FAILED_VISIBLE_MS;
}

/** A slot whose connection or model differs from the one the artifact was built with. */
export function modelsChanged(built: AiJobModels | null, current: AiJobModels, slots: readonly AiSlot[]): boolean {
  return slots.some((slot) => {
    const before = built?.[slot];
    const now = current[slot];
    if (!before || !now) return false;
    return before.model !== now.model || before.connectionId !== now.connectionId;
  });
}
