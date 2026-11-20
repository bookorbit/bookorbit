import type { StoryGuideEntityKind } from "./story-guide-ties";

/**
 * A story guide as the content route serves it, format 1. Clients ignore fields they do not know,
 * show a kind they do not know under Terms, and a tie type they do not know by its `label`.
 */

/**
 * A place in the book: spine index `s`, the raw UTF-16 offset `o` as a hint, and the quote `q`, at
 * most 12 words exactly as in the book and inside one block. `end: true` is the end of spine item `s`.
 */
export type StoryGuideAnchor = { s: number; o: number; q: string } | { s: number; end: true };

export interface StoryGuideName {
  text: string;
  /** Where the name first appears. */
  at: StoryGuideAnchor;
}

export interface StoryGuideLine {
  /** The line holds from the end of this chapter, or part of a long chapter, on. */
  through: StoryGuideAnchor;
  text: string;
}

/** An entry merged into an entity from `at` on. Before `at` it is its own entry. */
export interface StoryGuideJoin {
  key: string;
  name: string;
  names: StoryGuideName[];
  lines: StoryGuideLine[];
  /** Absent from guides built before profiles. */
  profiles?: StoryGuideLine[];
  at: StoryGuideAnchor;
}

export interface StoryGuideEntity {
  /** The folded name, spaces to hyphens, with `-2`, `-3` for collisions in reading order. */
  key: string;
  name: string;
  kind: StoryGuideEntityKind;
  names: StoryGuideName[];
  joins: StoryGuideJoin[];
  /** Short identity lines, each holding from its chapter's end on. */
  lines: StoryGuideLine[];
  /**
   * A few sentences on who the character is and what they have done so far, each holding from its
   * chapter's end on. Absent from guides built before profiles.
   */
  profiles?: StoryGuideLine[];
  /** Shared fixes changed this entity. */
  fixed: boolean;
}

export interface StoryGuideTie {
  /** `a|type|b`, with `a` and `b` in key order for a symmetric type. */
  key: string;
  /** Entity or join keys. */
  a: string;
  type: string;
  b: string;
  /** English fallback, read as "a <label> b". */
  label: string;
  /** The first quote. */
  at: StoryGuideAnchor;
  /** The first few quotes, in reading order. */
  quotes: StoryGuideAnchor[];
  /** How many quotes state the tie. */
  count: number;
  fixed: boolean;
}

export interface StoryGuideSectionInfo {
  s: number;
  title: string | null;
  /** The section's raw text length and the first 8 hex characters of its flattened text's SHA-256. */
  chars: number;
  h: string;
}

export interface StoryGuidePayloadV1 {
  format: 1;
  textKey: string;
  pipeline: string;
  builtAt: string;
  language: string;
  /** Model names by slot. */
  models: Partial<Record<"fast" | "careful", string>>;
  coverage: number;
  fixesRevision: number;
  sections: StoryGuideSectionInfo[];
  entities: StoryGuideEntity[];
  ties: StoryGuideTie[];
  /**
   * What happens in each chapter, or part of a long chapter, in reading order: a few sentences on
   * that stretch alone, holding from its end on. Absent from guides built before summaries.
   */
  summaries?: StoryGuideLine[];
}
