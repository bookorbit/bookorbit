import { createHash } from 'crypto';
import { gzipSync } from 'zlib';
import { Inject, Injectable } from '@nestjs/common';
import type { AiJobFailureReason, AiJobModels, AiJobPauseReason, AiJobSkipReason } from '@bookorbit/types';

import type { AiJobRow, NewAiArtifactRow, NewAiStepTimingRow } from '../../db/schema';
import {
  AiJobFailure,
  AiJobPause,
  AiUnitSkipped,
  slotsOf,
  type AiFeature,
  type AiJobInfo,
  type AiRunContext,
  type AiStep,
  type AiStepContext,
  type AiStepRequest,
  type AiSubject,
  type AiUnit,
} from './ai-feature';
import { AiFeatureRegistry } from './ai-feature.registry';
import { unitFingerprint, upstreamDigest } from './ai-fingerprint';
import { AiJobActivityService } from './ai-job-activity.service';
import { AiJobChecks } from './ai-job-checks.service';
import { AiJobRepository } from './ai-job.repository';
import { AiJobStepRepository, type CachedUnit, type CacheScope } from './ai-job-step.repository';
import { AI_JOBS_MIN_COVERAGE, AI_JOBS_OVER_ESTIMATE_FACTOR, AI_JOBS_STATE_CHECK_MS, AI_JOBS_UNIT_CONCURRENCY } from './ai-jobs.constants';
import { AI_JOBS_PORTS, aiErrorCode, type AiJobsPorts, type AiResult } from './ai-jobs.ports';

export type AiArtifactValues = Omit<NewAiArtifactRow, 'jobId' | 'builtAt'>;

/** How long a model step took for the units this run sent itself, saved once the job completes. */
export type AiStepTiming = Omit<NewAiStepTimingRow, 'id' | 'createdAt'>;

export type AiRunOutcome =
  | { kind: 'completed'; artifact: AiArtifactValues; timings: AiStepTiming[] }
  | { kind: 'paused'; reason: AiJobPauseReason; detail: string | null }
  | { kind: 'failed'; reason: AiJobFailureReason; detail: string | null; step: string | null }
  /** Cancelled, or no longer this worker's: whoever moved the job owns what happens next. */
  | { kind: 'stopped' };

const PAUSE_CODES = new Set<string>(['off', 'slot-empty', 'budget', 'provider-auth', 'model-missing', 'provider-down']);
const PROGRESS_EVERY_MS = 1_000;

/** Stops the run without a state change: the job was cancelled or another worker owns it now. */
class AiRunStopped extends Error {
  override readonly name = 'AiRunStopped';
}

/** A failure inside one step, so the outcome can name it. */
class AiStepError extends Error {
  override readonly name = 'AiStepError';

  constructor(
    readonly step: string,
    override readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

/**
 * Runs one claimed job: the run-time checks, then each step in order, reusing every unit the step
 * cache already holds under the same fingerprint, then the artifact. It decides the outcome; the
 * worker records it.
 */
@Injectable()
export class AiJobRunner {
  constructor(
    private readonly registry: AiFeatureRegistry,
    private readonly jobs: AiJobRepository,
    private readonly steps: AiJobStepRepository,
    private readonly checks: AiJobChecks,
    private readonly activity: AiJobActivityService,
    @Inject(AI_JOBS_PORTS) private readonly ports: AiJobsPorts,
  ) {}

  async run(row: AiJobRow, owner: string, controller: AbortController): Promise<AiRunOutcome> {
    try {
      return await this.execute(row, owner, controller);
    } catch (error) {
      return outcomeOf(error, controller.signal);
    }
  }

  private async execute(row: AiJobRow, owner: string, controller: AbortController): Promise<AiRunOutcome> {
    const feature = this.registry.get(row.feature);
    if (!feature) throw new AiJobFailure('error', `No feature ${row.feature} on this server`);
    const { subject } = await this.checks.verify(row, feature);
    const models = await this.prepare(row, owner, feature);
    const run = new JobRun(row, owner, feature, subject, models, controller, this.jobs);

    for (const [index, step] of feature.steps.entries()) {
      if (index > 0) {
        await this.checks.verify(row, feature);
        if (!(await this.ports.settings.get(feature.id)).enabled) throw new AiJobPause('off');
      }
      try {
        await this.runStep(run, step);
      } catch (error) {
        throw error instanceof AiStepError ? error : new AiStepError(step.id, error);
      }
    }
    return { kind: 'completed', artifact: await this.assemble(run), timings: run.timings };
  }

  /** The switch, the slots' models (recorded the first time, kept after), their health and the budget. */
  private async prepare(row: AiJobRow, owner: string, feature: AiFeature): Promise<AiJobModels> {
    if (!(await this.ports.settings.get(feature.id)).enabled) throw new AiJobPause('off');
    const slots = slotsOf(feature);
    let models: AiJobModels = row.models ?? {};
    if (slots.some((slot) => !models[slot])) {
      const resolved = await this.ports.slots.resolve(feature.id, slots);
      if (resolved.missing.length > 0) throw new AiJobPause('slot-empty');
      models = { ...models, ...resolved.models };
      if (!(await this.jobs.setModels(row.id, owner, models))) throw new AiRunStopped();
      await this.activity.record(row.id, 'info', null, 'models_recorded', modelSummary(models));
    }
    const health = await this.ports.health.check(feature.id, models);
    if (health) throw new AiJobPause(health);
    const reservation = await this.ports.budget.reserve({ jobId: row.id, feature: feature.id, amount: row.estimate?.cost ?? null });
    if (!reservation.ok) throw new AiJobPause('budget');
    return models;
  }

  private async runStep(run: JobRun, step: AiStep): Promise<void> {
    const context = run.context();
    const units = step.units(context);
    validateUnits(step, units);
    const upstream = upstreamDigest(step.dependsOn.map((id) => ({ id, data: { results: run.results(id), skipped: run.skipped(id) } })));
    const model = step.slot ? (run.models[step.slot]?.model ?? null) : null;
    const scope: CacheScope = { feature: run.feature.id, subjectKey: run.row.subjectKey, step: step.id };
    const fingerprint = (unit: AiUnit) =>
      unitFingerprint({
        feature: run.feature.id,
        step: step.id,
        version: step.version,
        model,
        generation: run.row.generation,
        upstream,
        own: step.fingerprint(run.context(), unit),
      });
    const progress = run.progress(step.id, units.length);
    await progress.start();
    const startedAt = Date.now();
    let reused = 0;
    let ran = 0;
    let lanes = 1;

    if (step.sequential) {
      for (const unit of units) {
        run.throwIfStopped();
        const print = fingerprint(unit);
        const hit = (await this.steps.lookup(scope, [{ unit: unit.id, fingerprint: print }], run.row.id)).get(unit.id);
        if (hit) {
          run.apply(step.id, unit.id, hit);
          reused++;
        } else {
          await this.runUnit(run, step, unit, print, scope, model);
          ran++;
        }
        await progress.advance();
      }
    } else {
      const entries = units.map((unit) => ({ unit, fingerprint: fingerprint(unit) }));
      const hits = await this.steps.lookup(
        scope,
        entries.map((entry) => ({ unit: entry.unit.id, fingerprint: entry.fingerprint })),
        run.row.id,
      );
      for (const [unitId, hit] of hits) run.apply(step.id, unitId, hit);
      reused = hits.size;
      await progress.advance(hits.size);
      const misses = entries.filter((entry) => !hits.has(entry.unit.id));
      lanes = Math.max(1, Math.min(AI_JOBS_UNIT_CONCURRENCY, misses.length));
      await runPool(misses, AI_JOBS_UNIT_CONCURRENCY, run.signal, async (entry) => {
        await this.runUnit(run, step, entry.unit, entry.fingerprint, scope, model);
        ran++;
        await progress.advance();
      });
    }
    run.throwIfStopped();
    const durationMs = Date.now() - startedAt;

    const finished = run.results(step.id).size;
    const coverage = units.length === 0 ? 1 : finished / units.length;
    if (!step.optional) run.coverage.set(step.id, coverage);
    await progress.finish();
    await this.activity.record(run.row.id, 'info', step.id, 'step_finished', {
      units: units.length,
      reused,
      skipped: run.skipped(step.id).size,
      coverage: Math.round(coverage * 1000) / 1000,
    });
    if (!step.optional && coverage < AI_JOBS_MIN_COVERAGE) {
      throw new AiStepError(step.id, new AiJobFailure('low-coverage', `Step ${step.id} finished ${finished} of ${units.length} units`));
    }
    const use = step.slot ? run.models[step.slot] : undefined;
    if (use && ran > 0) {
      run.timings.push({
        feature: run.feature.id,
        step: step.id,
        connectionId: use.connectionId,
        model: use.model,
        effort: use.effort ?? null,
        units: ran,
        lanes,
        durationMs,
        jobId: run.row.id,
      });
    }
  }

  private async runUnit(run: JobRun, step: AiStep, unit: AiUnit, fingerprint: string, scope: CacheScope, model: string | null): Promise<void> {
    const usage = { tokens: 0, costMicros: null as number | null, model };
    const context: AiStepContext = {
      ...run.context(),
      step: step.id,
      model,
      complete: (request) => this.request(run, step, request, usage),
    };
    let value: CachedUnit;
    try {
      value = { outcome: 'ok', result: await step.run(context, unit) };
    } catch (error) {
      const reason = skipReasonOf(error);
      if (!reason || run.signal.aborted) throw error;
      value = { outcome: 'skipped', reason };
      await this.activity.record(run.row.id, 'warn', step.id, 'unit_skipped', { unit: unit.id, reason });
    }
    await this.steps.save(scope, {
      unit: unit.id,
      fingerprint,
      generation: run.row.generation,
      value,
      model: usage.model,
      tokens: usage.tokens,
      costMicros: usage.costMicros,
      jobId: run.row.id,
    });
    run.apply(step.id, unit.id, value);
  }

  private async request(
    run: JobRun,
    step: AiStep,
    request: AiStepRequest,
    usage: { tokens: number; costMicros: number | null; model: string | null },
  ): Promise<AiResult> {
    if (!step.slot) throw new Error(`Step ${step.id} runs code only and cannot send requests`);
    await run.ensureStillRunning();
    if (run.overCap()) throw new AiJobPause('over-estimate');
    const result = await this.ports.client.complete({
      ...request,
      feature: run.feature.id,
      slot: step.slot,
      jobId: run.row.id,
      signal: run.signal,
      use: run.models[step.slot],
    });
    const tokens = result.usage.input + result.usage.output + (result.usage.reasoning ?? 0);
    const costMicros = result.usage.cost == null ? null : Math.round(result.usage.cost * 1_000_000);
    usage.tokens += tokens;
    usage.model = result.model || usage.model;
    if (costMicros != null) usage.costMicros = (usage.costMicros ?? 0) + costMicros;
    run.spend(costMicros);
    await this.jobs.addUsage(run.row.id, tokens, costMicros);
    if (result.finish === 'refused' || result.finish === 'filtered') throw new AiUnitSkipped(result.finish);
    return result;
  }

  private async assemble(run: JobRun): Promise<AiArtifactValues> {
    const format = run.feature.formats[run.feature.formats.length - 1]!;
    const coverage = Math.min(1, ...run.coverage.values());
    const artifact = await run.feature.assemble({ ...run.context(), coverage, format });
    run.throwIfStopped();
    const json = Buffer.from(JSON.stringify(artifact));
    const payload = gzipSync(json);
    return {
      feature: run.feature.id,
      subjectKey: run.row.subjectKey,
      format,
      pipeline: run.feature.pipeline,
      generation: run.row.generation,
      payload,
      sha256: createHash('sha256').update(json).digest('hex'),
      size: payload.length,
      coverage,
      models: run.models,
      costMicros: run.costMicros,
    };
  }
}

/** One run's in-memory state: the results so far, spending, and whether it still owns the job. */
class JobRun {
  readonly coverage = new Map<string, number>();
  readonly timings: AiStepTiming[] = [];
  private readonly ok = new Map<string, Map<string, unknown>>();
  private readonly left = new Map<string, Map<string, AiJobSkipReason>>();
  private lastStateCheck = 0;
  costMicros: number | null;

  constructor(
    readonly row: AiJobRow,
    readonly owner: string,
    readonly feature: AiFeature,
    readonly subject: AiSubject,
    readonly models: AiJobModels,
    private readonly controller: AbortController,
    private readonly jobs: AiJobRepository,
  ) {
    this.costMicros = row.costMicros;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  context(): AiRunContext {
    const info: AiJobInfo = {
      id: this.row.id,
      feature: this.row.feature,
      kind: this.row.kind as AiJobInfo['kind'],
      subjectKey: this.row.subjectKey,
      subjectRef: this.row.subjectRef,
      generation: this.row.generation,
      models: this.models,
    };
    return {
      job: info,
      subject: this.subject,
      results: (stepId) => this.results(stepId),
      skipped: (stepId) => this.skipped(stepId),
      signal: this.signal,
    };
  }

  results(stepId: string): ReadonlyMap<string, unknown> {
    return this.ok.get(stepId) ?? new Map();
  }

  skipped(stepId: string): ReadonlyMap<string, AiJobSkipReason> {
    return this.left.get(stepId) ?? new Map();
  }

  apply(stepId: string, unitId: string, value: CachedUnit): void {
    if (value.outcome === 'ok') {
      if (!this.ok.has(stepId)) this.ok.set(stepId, new Map());
      this.ok.get(stepId)!.set(unitId, value.result);
    } else {
      if (!this.left.has(stepId)) this.left.set(stepId, new Map());
      this.left.get(stepId)!.set(unitId, value.reason);
    }
  }

  spend(costMicros: number | null): void {
    if (costMicros != null) this.costMicros = (this.costMicros ?? 0) + costMicros;
  }

  /** Spent past the cap: three times the estimate, raised once more for each Continue. */
  overCap(): boolean {
    const estimate = this.row.estimate?.cost;
    if (estimate == null || estimate <= 0 || this.costMicros == null) return false;
    const cap = estimate * 1_000_000 * AI_JOBS_OVER_ESTIMATE_FACTOR * (this.row.capRaises + 1);
    return this.costMicros >= cap;
  }

  throwIfStopped(): void {
    if (this.signal.aborted) throw new AiRunStopped();
  }

  /** Before a request: a cancel from any server ends the job at its next request. */
  async ensureStillRunning(): Promise<void> {
    this.throwIfStopped();
    const now = Date.now();
    if (now - this.lastStateCheck < AI_JOBS_STATE_CHECK_MS) return;
    this.lastStateCheck = now;
    if (!(await this.jobs.isRunningFor(this.row.id, this.owner))) {
      this.controller.abort();
      throw new AiRunStopped();
    }
  }

  progress(step: string, total: number) {
    let done = 0;
    let savedAt = 0;
    const save = async (force: boolean) => {
      const now = Date.now();
      if (!force && now - savedAt < PROGRESS_EVERY_MS) return;
      savedAt = now;
      await this.jobs.setProgress(this.row.id, this.owner, { phase: step, done, total });
    };
    return {
      start: () => save(true),
      advance: async (by = 1) => {
        done += by;
        await save(false);
      },
      finish: () => save(true),
    };
  }
}

/**
 * Runs up to `limit` items at once. After the first failure no new item starts, and the ones in
 * flight finish, so what they cost is saved rather than thrown away.
 */
async function runPool<T>(items: readonly T[], limit: number, signal: AbortSignal, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const failures: unknown[] = [];
  const lane = async () => {
    while (failures.length === 0 && !signal.aborted && next < items.length) {
      const item = items[next++]!;
      try {
        await work(item);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  if (failures.length > 0) throw failures[0];
}

function validateUnits(step: AiStep, units: readonly AiUnit[]): void {
  const ids = new Set<string>();
  for (const unit of units) {
    if (unit.id.length === 0 || unit.id.length > 64)
      throw new AiJobFailure('error', `Step ${step.id} produced a unit id of ${unit.id.length} characters`);
    if (ids.has(unit.id)) throw new AiJobFailure('error', `Step ${step.id} produced unit ${unit.id} twice`);
    ids.add(unit.id);
  }
}

function skipReasonOf(error: unknown): AiJobSkipReason | null {
  if (error instanceof AiUnitSkipped) return error.reason;
  const code = aiErrorCode(error);
  return code === 'invalid-json' || code === 'too-long' ? code : null;
}

function modelSummary(models: AiJobModels): Record<string, string | number | null> {
  return Object.fromEntries(Object.entries(models).map(([slot, value]) => [slot, value?.model ?? null]));
}

function outcomeOf(error: unknown, signal: AbortSignal): AiRunOutcome {
  const step = error instanceof AiStepError ? error.step : null;
  const cause = error instanceof AiStepError ? error.cause : error;
  if (cause instanceof AiRunStopped) return { kind: 'stopped' };
  if (cause instanceof AiJobPause) return { kind: 'paused', reason: cause.reason, detail: cause.message };
  if (cause instanceof AiJobFailure) return { kind: 'failed', reason: cause.reason, detail: cause.message, step };
  const code = aiErrorCode(cause);
  if (code === 'cancelled' || (signal.aborted && code !== null)) return { kind: 'stopped' };
  if (code && PAUSE_CODES.has(code))
    return { kind: 'paused', reason: code as AiJobPauseReason, detail: cause instanceof Error ? cause.message : null };
  if (signal.aborted) return { kind: 'stopped' };
  return { kind: 'failed', reason: 'error', detail: cause instanceof Error ? cause.message : String(cause), step };
}
