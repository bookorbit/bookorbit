import type { StoryGuideAnchor } from "./story-guide-payload";
import type { StoryGuideEntityKind } from "./story-guide-ties";

/**
 * Fixes made to a story guide for everyone who reads the same text, synced by
 * `GET`/`PUT /mobile/books/files/:fileId/story-guide/fixes`. The guide's content route serves the
 * payload with them applied, in the order they were made; a Rebuild keeps them, matching each by
 * its target's key and then by the target's former names. A `hide` follows former names only when
 * at least two of them agree on one entry; otherwise it is orphaned.
 */

export const STORY_GUIDE_FIX_KINDS = [
  "rename",
  "kind",
  "guide-kind",
  "merge",
  "split",
  "hide",
  "line",
  "line-hide",
  "tie-hide",
  "tie-type",
  "tie-add",
] as const;
export type StoryGuideFixKind = (typeof STORY_GUIDE_FIX_KINDS)[number];

/** Fix kinds whose target is a tie, by its key `a|type|b`. Every other kind targets an entity. */
export const STORY_GUIDE_TIE_FIX_KINDS: readonly StoryGuideFixKind[] = ["tie-hide", "tie-type"];

/** The tab a `kind` fix moves an entity to, as personal fixes name it. */
export const STORY_GUIDE_FIX_TABS = ["person", "place", "term"] as const;
export type StoryGuideFixTab = (typeof STORY_GUIDE_FIX_TABS)[number];

/** Most live (not deleted) fixes one text may have. */
export const STORY_GUIDE_FIXES_PER_TEXT_MAX = 2000;
/** Most fixes one page returns, and the default page size. */
export const STORY_GUIDE_FIXES_PAGE_MAX = 200;
/** Largest `data` object, measured as its UTF-8 JSON serialisation. */
export const STORY_GUIDE_FIX_DATA_MAX_BYTES = 4096;
/** Longest new name or line a fix may carry. */
export const STORY_GUIDE_FIX_TEXT_MAX_LENGTH = 200;
/** Longest target key: an entity key, or a tie's `a|type|b`. */
export const STORY_GUIDE_FIX_KEY_MAX_LENGTH = 400;
/** Most former names a target may carry, and the longest of them. */
export const STORY_GUIDE_FIX_NAMES_MAX = 50;
export const STORY_GUIDE_FIX_NAME_MAX_LENGTH = 200;
/** How long a deleted fix is kept, so every device learns of the delete. */
export const STORY_GUIDE_FIX_TOMBSTONE_DAYS = 90;

/**
 * What a fix changes: a guide key, and the entity's folded names when it was made, which find it
 * again when a Rebuild gave it another key. A tie target names the tie's key and no names.
 */
export interface StoryGuideFixTarget {
  key: string;
  names: string[];
}

/** A place in the book, as an anchor's spine index `s` and offset `o`. */
export interface StoryGuideFixPosition {
  s: number;
  o: number;
}

/**
 * `data` by kind. Every kind ignores keys it does not know.
 *
 * - `rename`: `{ name }`.
 * - `kind`: `{ kind: "person" | "place" | "term" }`, the tab.
 * - `guide-kind`: `{ kind }`, one of the guide's entity kinds.
 * - `merge`: `{ into: StoryGuideFixTarget }`; the target joins `into`.
 * - `split`: `{ name }`, the name to move out of the target into an entry of its own.
 * - `hide`: `{}`.
 * - `line`: `{ text, through? }`; with `through` (a line's anchor from the payload) it replaces that
 *   line, otherwise it adds a line from `from`.
 * - `line-hide`: `{ through }`, the anchor of the line it removes.
 * - `tie-hide`: `{ a?, b? }`, each side's former names.
 * - `tie-type`: `{ type, a?, b? }`.
 * - `tie-add`: `{ type, b: StoryGuideFixTarget }`; the target is side `a`.
 */
export type StoryGuideFixData = Record<string, unknown>;

export interface StoryGuideRenameData {
  name: string;
}

export interface StoryGuideKindData {
  kind: StoryGuideFixTab;
}

export interface StoryGuideGuideKindData {
  kind: StoryGuideEntityKind;
}

export interface StoryGuideMergeData {
  into: StoryGuideFixTarget;
}

export interface StoryGuideSplitData {
  name: string;
}

export interface StoryGuideLineData {
  text: string;
  through?: StoryGuideAnchor;
}

export interface StoryGuideLineHideData {
  through: StoryGuideAnchor;
}

export interface StoryGuideTieSidesData {
  a?: string[];
  b?: string[];
}

export interface StoryGuideTieTypeData extends StoryGuideTieSidesData {
  type: string;
}

export interface StoryGuideTieAddData {
  type: string;
  b: StoryGuideFixTarget;
}

export interface StoryGuideFix {
  /** Client-generated UUID, unique per text. */
  id: string;
  /** A kind a client does not know is kept and skipped. */
  kind: string;
  target: StoryGuideFixTarget;
  data: StoryGuideFixData;
  /** Where a fix that adds text shows from; null for one that starts where what it replaces starts. */
  from: StoryGuideFixPosition | null;
  /** ISO 8601, the client's time of the change. The later of two writes to one id wins. */
  updatedAt: string;
  /** A tombstone, kept for `STORY_GUIDE_FIX_TOMBSTONE_DAYS` so every device learns of the delete. */
  deleted: boolean;
}

export interface StoryGuideFixesPage {
  /** Changes in the order the server stored them, tombstones included. */
  fixes: StoryGuideFix[];
  /** Opaque; pass back as `since` to get only later changes. */
  cursor: string;
  hasMore: boolean;
  /**
   * Ids of every live fix, on any page, that finds no target in the guide served now. Kept, not
   * applied. Empty while the text has no guide.
   */
  orphans: string[];
  /** For every live fix that found its target by former names, not by key: the key it applies to now. */
  rematched: Record<string, string>;
}

export interface PutStoryGuideFixRequest {
  kind: StoryGuideFixKind;
  target: StoryGuideFixTarget;
  data: StoryGuideFixData;
  from?: StoryGuideFixPosition | null;
  updatedAt: string;
  deleted?: boolean;
}
