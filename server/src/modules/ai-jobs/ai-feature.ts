import type {
  AiJobSubjectSummary,
  AiJobEstimate,
  AiJobFailureReason,
  AiJobKind,
  AiJobModels,
  AiJobPauseReason,
  AiJobSkipReason,
  AiJobSubjectRef,
  AuditResource,
  NotificationType,
  Permission,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { AiRequest, AiResult, AiSlot } from './ai-jobs.ports';

/** What a feature builds for. `key` identifies its content (for a book, the text key). */
export interface AiSubject {
  key: string;
}

/** Why a subject cannot be built at all, such as a book that is too long. */
export interface AiRefusal {
  reason: string;
  limit?: number;
}

/** One piece of a step's work. The id is stable for the same input and at most 64 characters. */
export interface AiUnit {
  id: string;
}

export interface AiJobInfo {
  id: string;
  feature: string;
  kind: AiJobKind;
  subjectKey: string;
  subjectRef: AiJobSubjectRef;
  generation: number;
  models: AiJobModels;
}

export interface AiRunContext<Subject extends AiSubject = AiSubject> {
  job: AiJobInfo;
  subject: Subject;
  /** Results of a step's finished units, by unit id. For the running sequential step, the units done so far. */
  results(stepId: string): ReadonlyMap<string, unknown>;
  /** A step's units that were left out, with why. */
  skipped(stepId: string): ReadonlyMap<string, AiJobSkipReason>;
  signal: AbortSignal;
}

export type AiStepRequest = Omit<AiRequest, 'feature' | 'slot' | 'jobId' | 'signal'>;

export interface AiStepContext<Subject extends AiSubject = AiSubject> extends AiRunContext<Subject> {
  step: string;
  /** The model the step's slot uses for this job; null for a step that runs code only. */
  model: string | null;
  /** A request on the step's slot for this job. A refused or filtered reply leaves the unit out. */
  complete(request: AiStepRequest): Promise<AiResult>;
}

export interface AiAssembleContext<Subject extends AiSubject = AiSubject> extends AiRunContext<Subject> {
  /** The lowest share of units any step finished. */
  coverage: number;
  /** The format the artifact is stored in: the feature's newest. */
  format: number;
}

export interface AiStep<Subject extends AiSubject = AiSubject> {
  id: string;
  /** Bumped by any change to the step's prompt, schema or checks. */
  version: number;
  slot: AiSlot | null;
  dependsOn: string[];
  units(ctx: AiRunContext<Subject>): AiUnit[];
  /**
   * A hash of what the unit reads that the engine cannot see: its prompt and its input. The engine
   * adds the step's version, the slot's model, the job's generation and the results of the steps it
   * depends on.
   */
  fingerprint(ctx: AiRunContext<Subject>, unit: AiUnit): string;
  /** Units run one at a time in order, each able to read the ones before it. */
  sequential?: boolean;
  /**
   * The step adds extras the result is complete without: units it could not finish never fail the
   * job, and do not lower the coverage the result reports.
   */
  optional?: boolean;
  run(ctx: AiStepContext<Subject>, unit: AiUnit): Promise<unknown>;
}

/** What a build can reuse, for its estimate. */
export interface AiEstimateReuse {
  kind: AiJobKind;
  generation: number;
  models: AiJobModels;
  artifact: { pipeline: string; generation: number; models: AiJobModels | null } | null;
}

export interface AiNotice {
  type: NotificationType;
  /** English fallback; clients that know the type render their own copy from `meta`. */
  title: string;
  message?: string;
  actionUrl?: string;
  meta?: Record<string, unknown>;
}

export type AiJobOutcome = 'completed' | 'failed';

/** How a job's subject shows in a list: a name, a byline, the page it opens and a picture. */
export type AiSubjectLabel = AiJobSubjectSummary;

export interface AiFeature<Subject extends AiSubject = AiSubject, Artifact = unknown> {
  id: string;
  /** Formats the server can still render, newest last. */
  formats: number[];
  /** Bumped by any step change; artifacts from another pipeline are outdated. */
  pipeline: string;
  /** In order: a step comes after every step it depends on. */
  steps: AiStep<Subject>[];
  /** Needed to request a job and checked again while it runs. Superusers always pass. */
  permission: Permission;
  /** Throws `AiJobFailure` with `unreadable` or `source-changed` when the subject cannot be read. */
  resolveSubject(ref: AiJobSubjectRef): Promise<Subject>;
  check(subject: Subject): Promise<AiRefusal | null>;
  estimate(subject: Subject, reuse: AiEstimateReuse): Promise<AiJobEstimate>;
  assemble(ctx: AiAssembleContext<Subject>): Promise<Artifact>;
  /** Down to an older format, or null when it no longer can. */
  render(artifact: Artifact, format: number): Artifact | null;
  /** Whether the user can still reach what the reference names. */
  canReach(user: RequestUser, ref: AiJobSubjectRef): Promise<boolean>;
  /** Labels for job subjects, by job id, in one read. A subject that no longer exists is left out. */
  describe(refs: ReadonlyMap<string, AiJobSubjectRef>): Promise<Map<string, AiSubjectLabel>>;
  /** What the requester is told when a job ends; null sends nothing. */
  notice(job: AiJobInfo, outcome: AiJobOutcome, reason: AiJobFailureReason | null): Promise<AiNotice | null>;
  /** Where audit entries for this subject point. */
  auditTarget(ref: AiJobSubjectRef): { resource: AuditResource; resourceId: number } | null;
}

/** Leaves one unit out for a reason another try would not fix. Only these lower coverage. */
export class AiUnitSkipped extends Error {
  override readonly name = 'AiUnitSkipped';

  constructor(readonly reason: AiJobSkipReason) {
    super(`Unit left out: ${reason}`);
  }
}

/** Ends the job as failed. */
export class AiJobFailure extends Error {
  override readonly name = 'AiJobFailure';

  constructor(
    readonly reason: AiJobFailureReason,
    message?: string,
  ) {
    super(message ?? reason);
  }
}

/** Pauses the job until its cause clears. */
export class AiJobPause extends Error {
  override readonly name = 'AiJobPause';

  constructor(
    readonly reason: AiJobPauseReason,
    message?: string,
  ) {
    super(message ?? reason);
  }
}

/** The slots a feature's steps send requests on. */
export function slotsOf(feature: Pick<AiFeature, 'steps'>): AiSlot[] {
  return [...new Set(feature.steps.flatMap((step) => (step.slot ? [step.slot] : [])))];
}
