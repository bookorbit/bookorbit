import type { AiEffort } from "./ai";

/**
 * Jobs that build an AI feature's output for one subject (for example a book's text), run in steps
 * whose results are cached so a restart resumes and an update reruns only what changed.
 */

export const AI_JOB_KINDS = ["build", "update", "rebuild"] as const;
export type AiJobKind = (typeof AI_JOB_KINDS)[number];

export const AI_JOB_STATUSES = ["queued", "running", "paused", "completed", "failed", "cancelled"] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

/** At most one job in these states exists per feature and subject. */
export const AI_JOB_UNFINISHED_STATUSES = ["queued", "running", "paused"] as const satisfies readonly AiJobStatus[];
export type AiJobUnfinishedStatus = (typeof AI_JOB_UNFINISHED_STATUSES)[number];

/**
 * Why a job waits. Every one but `over-estimate` and `user` clears on its own when its cause does;
 * `user` is a person's pause and waits for Resume.
 */
export const AI_JOB_PAUSE_REASONS = [
  "budget",
  "over-estimate",
  "provider-auth",
  "provider-down",
  "model-missing",
  "off",
  "slot-empty",
  "user",
] as const;
export type AiJobPauseReason = (typeof AI_JOB_PAUSE_REASONS)[number];

/** Why a job ended. `provider-down` ends a job that stayed paused for it too long. */
export const AI_JOB_FAILURE_REASONS = ["low-coverage", "requester", "source-changed", "unreadable", "provider-down", "error"] as const;
export type AiJobFailureReason = (typeof AI_JOB_FAILURE_REASONS)[number];

export type AiJobReason = AiJobPauseReason | AiJobFailureReason;

/** Why one unit of a step was left out. Only these lower a step's coverage. */
export const AI_JOB_SKIP_REASONS = ["refused", "filtered", "invalid-json", "too-long"] as const;
export type AiJobSkipReason = (typeof AI_JOB_SKIP_REASONS)[number];

export type AiJobEventLevel = "info" | "warn" | "error";

/** The connection and model a slot used, recorded when a job first runs and kept until it ends. */
export interface AiJobSlotModel {
  connectionId: number;
  model: string;
  /** The level the slot set; absent when it left effort to the feature. */
  effort?: AiEffort;
}

export type AiJobModels = Partial<Record<"fast" | "careful", AiJobSlotModel>>;

export interface AiJobEstimate {
  words: number;
  /** Null until a finished build has shown how fast the models are; 0 when no model step runs. */
  minutes: number | null;
  /** Dollars; null when a slot the feature uses has no prices. */
  cost: number | null;
}

/** What a feature needs to find its subject again, such as `{ bookId, fileId }`. */
export type AiJobSubjectRef = Record<string, string | number | null>;

/** The AI area's job lists: unfinished jobs, failed ones still shown, and everything that ended. */
export const AI_JOB_LIST_VIEWS = ["queue", "failed", "history"] as const;
export type AiJobListView = (typeof AI_JOB_LIST_VIEWS)[number];

/** `mine`: jobs the viewer asked for. `all`: everyone's, for those who manage the server's settings. */
export const AI_JOB_LIST_SCOPES = ["mine", "all"] as const;
export type AiJobListScope = (typeof AI_JOB_LIST_SCOPES)[number];

export const AI_JOB_LIST_MAX_LIMIT = 100;

/**
 * What a person can do to a job from the AI area. `resume` puts a paused job back in the queue: it
 * is Continue on an over-estimate pause and Try again on any other. `prioritize` moves a queued job
 * to the front of its feature's queue.
 */
export const AI_JOB_ACTIONS = ["cancel", "pause", "resume", "retry", "dismiss", "prioritize"] as const;
export type AiJobQueueAction = (typeof AI_JOB_ACTIONS)[number];

/** Jobs one request may act on. */
export const AI_JOB_ACTION_MAX_IDS = 100;

export interface AiJobSubjectSummary {
  label: string | null;
  /** A short line under the label, such as a book's authors. */
  byline: string | null;
  /** Where the subject opens in the web app. */
  url: string | null;
  /** A small picture of the subject, such as a book's cover thumbnail. */
  image: string | null;
}

export interface AiJobListItem {
  id: string;
  /** The feature that runs it, such as `story-guides`. */
  feature: string;
  kind: AiJobKind;
  status: AiJobStatus;
  reason: AiJobReason | null;
  phase: string | null;
  done: number;
  total: number;
  /** A queued job's place in its feature's queue, 1 being next; null for any other status. */
  position: number | null;
  /** What the job builds for, as its feature names it. Null fields when the viewer can no longer reach it. */
  subject: AiJobSubjectSummary;
  /** Null when the account was deleted. */
  requester: { id: number; name: string } | null;
  /** Dollars spent so far; only for viewers who manage the server's settings, null otherwise or while unknown. */
  cost: number | null;
  createdAt: string;
  startedAt: string | null;
  pausedAt: string | null;
  finishedAt: string | null;
  /** What this viewer may do to it now. */
  actions: AiJobQueueAction[];
}

export interface AiJobList {
  items: AiJobListItem[];
  /** Jobs in the asked view and scope. */
  total: number;
  /** Jobs in each view for the asked scope, and the queue view's jobs by status. */
  counts: AiJobListCounts;
}

export interface AiJobListCounts extends Record<AiJobListView, number> {
  running: number;
  queued: number;
  paused: number;
}

export interface AiJobActionRequest {
  action: AiJobQueueAction;
  ids: string[];
}

/**
 * `done`: the action happened. `still-paused`: Resume found the job held by another cause, now its
 * reason. `skipped`: the job is no longer in a state the action applies to. `conflict`: Retry found
 * another unfinished job for the same subject. `refused`: the viewer may not do it, or the subject
 * cannot be built now. `not-found`: no such job the viewer can see. `error`: the server failed while acting on it.
 */
export const AI_JOB_ACTION_OUTCOMES = ["done", "still-paused", "skipped", "conflict", "refused", "not-found", "error"] as const;
export type AiJobActionOutcome = (typeof AI_JOB_ACTION_OUTCOMES)[number];

export interface AiJobActionResult {
  id: string;
  outcome: AiJobActionOutcome;
  /** The job's status after the action, when it exists. */
  status: AiJobStatus | null;
  reason: AiJobReason | null;
}

export interface AiJobActionResponse {
  results: AiJobActionResult[];
}

/** Sent on the `/ai-jobs` socket when jobs the viewer can see changed; the page reads its list again. */
export interface AiJobsChangedEvent {
  /** True when a job changed status, which can move every queued job's place. */
  state: boolean;
}
