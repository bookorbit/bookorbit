import type { AiEffort, AiSlotEffort } from "./ai";
import type { AiJobKind, AiJobModels } from "./ai-jobs";

/** The AI feature id story guides run under. */
export const STORY_GUIDE_FEATURE = "story-guides";

/** Payload formats this server can serve, oldest first. */
export const STORY_GUIDE_FORMATS = [1] as const;

export const STORY_GUIDE_BUILD_REASONS = ["off", "no-text-file", "language", "too-short", "too-long", "too-large", "unreadable", "checking"] as const;
/** Why a book cannot be built now. A client that does not know a reason shows the generic sentence. */
export type StoryGuideBuildReason = (typeof STORY_GUIDE_BUILD_REASONS)[number];

export type StoryGuideBuild =
  | { allowed: true }
  | {
      allowed: false;
      /** Absent for a caller who cannot manage guides. */
      reason?: StoryGuideBuildReason;
      /** For `too-long`: the longest-book setting, in words. */
      limit?: number;
    };

export interface StoryGuideInfo {
  builtAt: string;
  /** Managers only. */
  models?: AiJobModels | null;
  coverage: number;
  format: number;
  /** Built under other text or pipeline rules; Update is offered. */
  outdated: boolean;
  /** Built with models the slots no longer use; Update is offered. */
  modelsChanged: boolean;
  /** Managers only, on servers with `story-guide-fixes`: fixes for everyone that find no target in this guide. */
  orphanedFixes?: number;
}

export type StoryGuideJobState = "queued" | "running" | "paused" | "failed";

export interface StoryGuideJob {
  kind: AiJobKind;
  state: StoryGuideJobState;
  /** Managers only: why a job is paused or failed. */
  reason?: string | null;
  /** Managers only, queued: this job's place, 1 for next. */
  position?: number;
  phase?: string | null;
  /** Managers only, running. */
  done?: number;
  total?: number;
  /** Null until a finished build has shown how fast the job's models are. */
  minutesLeft?: number | null;
  /** Dollars this job has spent so far, sent only to callers who manage app settings; absent while no call has a price. */
  spentCost?: number;
}

export interface StoryGuideEstimate {
  words?: number;
  /** Null until a finished build has shown how fast the slots' models are. */
  minutes: number | null;
  /** Dollars, sent only to callers who manage app settings; null when the slots have no prices. */
  cost?: number | null;
}

export interface StoryGuideStatus {
  /** The file the status is for; null when the book has none a story guide can read. */
  fileId: number | null;
  /** Null until the key job has read the file. */
  textKey: string | null;
  canManage: boolean;
  build: StoryGuideBuild;
  guide: StoryGuideInfo | null;
  job: StoryGuideJob | null;
  /** Managers: Build and Rebuild. */
  estimate?: StoryGuideEstimate;
  /** Managers: Update, when the guide is outdated or its models changed. */
  updateEstimate?: StoryGuideEstimate;
}

export type StoryGuideBuildKind = AiJobKind;

/**
 * On the `/story-guides` socket, to sockets watching the book: its story guide status may have
 * changed. It carries no status; the page asks the status route, which shapes it for the viewer.
 */
export interface StoryGuideChangedEvent {
  bookId: number;
}

export interface StoryGuideBuildRequest {
  fileId?: number;
  kind: StoryGuideBuildKind;
}

export interface StoryGuideFileRequest {
  fileId?: number;
}

export type StoryGuideFixesChoice = "keep" | "delete";

export interface StoryGuideDeleteAllRequest {
  fixes: StoryGuideFixesChoice;
  /** Must equal the number of guides now, so a stale page cannot delete more than it showed. */
  count: number;
}

export interface StoryGuideDeleteAllResponse {
  deleted: number;
  cancelled: number;
}

export interface StoryGuidesSummary {
  /** Guides stored now. */
  count: number;
  bytes: number;
  /** Fixes made for everyone, live now; absent on servers without `story-guide-fixes`. */
  fixes?: number;
}

/** How `GET admin/ai/features/story-guides/guides` can order the stored guides. */
export const STORY_GUIDE_LIST_SORTS = ["built", "title", "cost", "time", "size"] as const;
export type StoryGuideListSort = (typeof STORY_GUIDE_LIST_SORTS)[number];
export const STORY_GUIDE_LIST_DIRECTIONS = ["asc", "desc"] as const;
export type StoryGuideListDirection = (typeof STORY_GUIDE_LIST_DIRECTIONS)[number];
export const STORY_GUIDE_LIST_MAX_LIMIT = 100;
/** Longest title search the guide list accepts. */
export const STORY_GUIDE_LIST_MAX_QUERY = 200;

/** One stored guide, as the AI area's Story guides tab lists it. */
export interface StoryGuideListItem {
  /** The guide's text key. */
  key: string;
  /**
   * The book and file whose text it was built from; the lowest file id when copies share the text.
   * Null when no file has that text any more.
   */
  bookId: number | null;
  fileId: number | null;
  title: string | null;
  /** The book's authors, joined for display. */
  byline: string | null;
  /** The book's cover thumbnail. */
  image: string | null;
  words: number | null;
  /** How the stored guide was built; null once its job is gone. */
  kind: AiJobKind | null;
  builtAt: string;
  /** From the build's start to its end; null once its job is gone. */
  seconds: number | null;
  /** Dollars; null when the models had no prices. */
  cost: number | null;
  bytes: number;
  /** Share of the book the guide covers, 0 to 1. */
  coverage: number;
  models: AiJobModels | null;
}

/** `GET admin/ai/features/story-guides/guides`. */
export interface StoryGuideList {
  items: StoryGuideListItem[];
  /** Guides matching the search. */
  total: number;
}

/** Past builds of the stored guides on one pair of models. */
export interface StoryGuideModelHistory {
  fast: string | null;
  careful: string | null;
  builds: number;
  /** Over the builds that were timed; null when none were. */
  averageSeconds: number | null;
  /** Dollars, over the builds with a known cost; null when none had one. */
  averageCost: number | null;
}

/** `GET admin/ai/features/story-guides/history`: what the stored guides took to build. */
export interface StoryGuideHistory {
  /** Dollars spent on the stored guides, where known. */
  cost: number;
  /** The middle build time in seconds; null when no build was timed. */
  medianSeconds: number | null;
  /** Most builds first. */
  models: StoryGuideModelHistory[];
}

/** The model steps whose speed is learned. */
export const STORY_GUIDE_TIMED_STEPS = ["names", "review", "ties", "lines", "profiles", "summaries"] as const;
export type StoryGuideTimedStep = (typeof STORY_GUIDE_TIMED_STEPS)[number];

export interface StoryGuideStepSpeed {
  step: StoryGuideTimedStep;
  /** How long one call took, the median of the newest builds. */
  secondsPerCall: number;
  /** Builds it was learned from. */
  builds: number;
}

/** What one model on one connection has managed in story guide builds. */
export interface StoryGuideModelSpeed {
  connectionId: number;
  /** Null when the connection cannot be read. */
  connectionName: string | null;
  model: string;
  /** The slot's effort level; absent for builds that left effort to story guides. */
  effort?: AiEffort;
  /** When the newest build it was learned from finished. */
  learnedAt: string;
  steps: StoryGuideStepSpeed[];
}

/** `GET admin/ai/features/story-guides/speeds`. */
export interface StoryGuideSpeeds {
  models: StoryGuideModelSpeed[];
}

/** `POST admin/ai/features/story-guides/speeds/reset`. */
export interface StoryGuideSpeedResetRequest {
  connectionId: number;
  model: string;
  /** One effort's speeds only, `auto` for builds without one; left out, every effort's. */
  effort?: AiSlotEffort;
}

export interface StoryGuideSpeedResetResponse {
  removed: number;
}

/** In `app-info`: whether new builds are allowed and whether any guide exists. */
export interface StoryGuidesAppInfo {
  building: boolean;
  served: boolean;
}

/** `GET mobile/books/files/:fileId/story-guide` when no guide can be sent. */
export interface StoryGuideContentMissing {
  reason: "none" | "format";
}
