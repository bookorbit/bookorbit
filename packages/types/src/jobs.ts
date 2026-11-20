import { Permission } from "./permissions";

/**
 * The Jobs area: every long-running piece of work a person can see, across features, in one list.
 * Each type is read by its own adapter on the server; the list merges them in one order.
 */

/**
 * Every job type, in the order that breaks ties between types. Ids are declared up front so later
 * adapters never collide; a page renders a type it does not know generically.
 */
export const JOB_TYPES = [
  "story-guide",
  "read-along",
  "book-merge",
  "chapter-edit",
  "chapter-lookup",
  "duplicate-scan",
  "request-download",
  "library-scan",
  "metadata-fetch",
  "author-enrichment",
  "bulk-run",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["queued", "running", "paused", "needs-you", "completed", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * `queue`: running, queued and paused. `needs-you`: waiting on a person's answer. `failed`: failed
 * inside the type's failed window and not dismissed. `history`: completed, cancelled, and failed
 * rows dismissed or aged out.
 */
export const JOB_VIEWS = ["queue", "needs-you", "failed", "history"] as const;
export type JobView = (typeof JOB_VIEWS)[number];

/** `mine`: the viewer's own jobs and the ownerless ones they may see. `everyone`: other accounts' too, where the viewer may see them. */
export const JOB_SCOPES = ["mine", "everyone"] as const;
export type JobScope = (typeof JOB_SCOPES)[number];

/**
 * `move-to-top` reorders a job within its requester's own jobs; `prioritize` moves it ahead of
 * everyone's. `continue` resumes interrupted work where it stopped.
 */
export const JOB_ACTIONS = ["cancel", "pause", "resume", "retry", "continue", "dismiss", "move-to-top", "prioritize"] as const;
export type JobActionKind = (typeof JOB_ACTIONS)[number];

/** `job`: one piece of work. `queue`: a summary row standing for a type's whole queue. */
export const JOB_SHAPES = ["job", "queue"] as const;
export type JobShape = (typeof JOB_SHAPES)[number];

export const JOB_LIST_DEFAULT_LIMIT = 50;
export const JOB_LIST_MAX_LIMIT = 100;
export const JOB_ACTION_MAX_IDS = 100;

/** `<type>:<native id>`, such as `story-guide:3f2a...` or `metadata-fetch:failed`. */
export const JOB_ID_PATTERN = "^[a-z][a-z0-9-]{0,39}:[A-Za-z0-9._-]{1,64}$";

/**
 * Holding any of these shows the Jobs area. Each type adds the permission that lets someone see
 * their own jobs of it, once its adapter exists.
 */
export const JOBS_VIEW_PERMISSIONS: readonly [Permission, Permission, ...Permission[]] = [
  Permission.ManageAppSettings,
  Permission.LibraryGenerateStoryGuide,
  Permission.LibraryGenerateReadAloud,
  Permission.LibraryMergeBooks,
  Permission.LibraryEditMetadata,
  Permission.LibraryDeleteBooks,
  Permission.BookRequestSelfFulfill,
  Permission.ManageBookRequests,
  Permission.ManageLibraries,
  Permission.ManageMetadataConfig,
];

export interface JobSubject {
  label: string | null;
  /** A short line beside the label, such as a book's authors. */
  byline: string | null;
  /** Where the subject opens in the web app. */
  url: string | null;
  /** A small picture of the subject, such as a book's cover thumbnail. */
  image: string | null;
}

/** Numbers a type shows beside its row. */
export interface JobExtra {
  failed?: number;
  review?: number;
  rateLimited?: number;
  /** When the row's result stops being available. */
  expiresAt?: string;
}

export interface JobListItem {
  id: string;
  type: JobType;
  /** Opaque per type, such as a story guide's `build` or `rebuild`. */
  kind: string | null;
  shape: JobShape;
  status: JobStatus;
  /** A stable code the page translates per type; never English. */
  reason: string | null;
  /** A stable code the page translates per type; never English. */
  phase: string | null;
  done: number | null;
  /** Null while the amount of work is unknown. */
  total: number | null;
  /** For types that only know how far along they are. */
  percent: number | null;
  /** A queued job's place in its type's lane, 1 being next; null for parallel lanes, summary rows and other statuses. */
  position: number | null;
  /** Null fields when the viewer can no longer reach the subject. */
  subject: JobSubject;
  /** Null for ownerless work and deleted accounts. */
  requester: { id: number; name: string } | null;
  /** Dollars spent so far, for types that cost money and viewers who manage the server. */
  cost: number | null;
  createdAt: string;
  startedAt: string | null;
  pausedAt: string | null;
  finishedAt: string | null;
  /** What this viewer may do to it now. */
  actions: JobActionKind[];
  /** A stable code saying why a row the viewer sees offers them no action. */
  actionNote: string | null;
  extra: JobExtra | null;
}

/** Jobs in each counted view for the asked scope, and the queue view's jobs by status. History has no count. */
export interface JobCounts {
  queue: number;
  needsYou: number;
  failed: number;
  running: number;
  queued: number;
  paused: number;
}

export interface JobList {
  items: JobListItem[];
  /** Where the next page starts; null on the last page. */
  next: string | null;
  /** Present when asked for with `counts=1`. */
  counts?: JobCounts;
  /** The types this viewer can see, in `JOB_TYPES` order, whatever the type filter. Present with `counts`. */
  types?: JobType[];
  /** The scopes this viewer may ask for; `everyone` only when some type shows them other accounts' jobs. Present with `counts`. */
  scopes?: JobScope[];
}

/**
 * The viewer's own jobs at a glance, for the sidebar. Ownerless work (library scans and the
 * metadata and author queues) never counts here; it is only named in `background`.
 */
export interface JobsSummary {
  running: number;
  /** Queued or paused. */
  waiting: number;
  needsYou: number;
  /** Failed inside their type's failed window and not dismissed. */
  failed: number;
  /** Ownerless types the viewer may see that are running now, in `JOB_TYPES` order. */
  background: JobType[];
}

export interface JobActionRequest {
  action: JobActionKind;
  ids: string[];
}

/**
 * `done`: the action happened. `still-paused`: Resume found the job held by another cause.
 * `skipped`: the job is no longer in a state the action applies to. `conflict`: another unfinished
 * job exists for the same subject. `refused`: the viewer may not do it now. `not-found`: no such job
 * the viewer can see. `error`: the server failed while acting on it.
 */
export const JOB_ACTION_OUTCOMES = ["done", "still-paused", "skipped", "conflict", "refused", "not-found", "error"] as const;
export type JobActionOutcome = (typeof JOB_ACTION_OUTCOMES)[number];

export interface JobActionResult {
  id: string;
  outcome: JobActionOutcome;
  /** The job's status after the action, when it is known. */
  status: JobStatus | null;
}

export interface JobActionResponse {
  results: JobActionResult[];
}

/** Sent on the `/jobs` socket when jobs of a type the viewer sees changed; carries no job data. */
export interface JobsChangedEvent {
  type: JobType;
  /** True when a job changed status, which can move every queued job's place in that type. */
  state: boolean;
}
