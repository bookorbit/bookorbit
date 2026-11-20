import type { StoryGuideEntityKind, StoryGuideTieType } from '@bookorbit/types';

/**
 * The results the story guide steps save, as `assemble` reads them. Everything a reader will see
 * carries where it is in the model's input: a passage id and the exact text there, so assemble can
 * map it through the passage's lines to raw reader offsets.
 */

/** Exact text in one passage's model input: `text === passage.text.slice(offset, offset + text.length)`. */
export interface PassageSpan {
  passage: string;
  /** UTF-16 offset into `StoryPassage.text`. */
  offset: number;
  text: string;
}

/** One entry of a passage's cast, after the code checks. */
export interface StoryNameEntry {
  /** The fullest name, as the model wrote it. */
  name: string;
  aliases: string[];
  kind: StoryGuideEntityKind;
  /** Who or what it is in this passage, from this passage only. */
  what: string;
  /** Where the name and each alias first occur in the passage, by the name as written above. */
  at: Record<string, PassageSpan>;
}

/** `names`: one per passage. */
export interface StoryNamesResult {
  passage: string;
  chapter: number;
  part: number;
  /** The entry name of who tells the passage as "I"; null unless its narration is first person. */
  narrator: string | null;
  entries: StoryNameEntry[];
}

/** A name of a merged entity, at its first sighting. */
export interface StoryMergedName {
  /** `nameKey(text)`: lowercase, no full stops, straight apostrophes, single spaces. */
  key: string;
  text: string;
  at: PassageSpan;
}

/** One entity after the exact joins: every entry that shares a name with it, in reading order. */
export interface StoryMergedEntity {
  /** Index in `StoryMergeResult.entities`; the review and the later steps refer to entities by it. */
  id: number;
  name: string;
  /** The passage of its first entry. */
  first: string;
  names: StoryMergedName[];
  /** The kind each entry gave, in reading order. */
  kinds: { passage: string; kind: StoryGuideEntityKind }[];
  /** What each entry said it is, in reading order. */
  what: { passage: string; text: string }[];
  /** Passages with an entry for it, in reading order. */
  passages: string[];
  /** Passages that name it as the one telling them as "I"; absent when none does. */
  narrated?: number;
}

/** `merge`: one unit for the book. */
export interface StoryMergeResult {
  entities: StoryMergedEntity[];
  /** For each passage, the entity each of its entries' names went to: name key to entity id. Ties resolve names through it. */
  placement: Record<string, Record<string, number>>;
}

/** A group the review answered, its ids checked and its chapter clamped. */
export interface StoryReviewGroup {
  ids: number[];
  /** The chapter the join can take effect in: never before the later member's first chapter. */
  from: number;
  /** What the model answered, kept for the log. */
  modelFrom: number | null;
}

/** When one entity becomes part of another. Before `at`, it is its own entry with its own names and lines. */
export interface StoryJoin {
  /** The merged entity that joins. */
  member: number;
  /** The cast entity it joins: the member of the final group with the most passages. */
  into: number;
  chapter: number;
  /** A reveal: the quote naming both. Otherwise the first name of the group's later member. */
  at: PassageSpan;
  reveal: boolean;
}

/** One entity of the final cast. */
export interface StoryCastEntity {
  /** The merged entity of the group with the most passages (the first such on a tie), which the others join. */
  id: number;
  /** That member's name. */
  name: string;
  kind: StoryGuideEntityKind;
  /** Merged entity ids, `id` first, then in reading order. */
  members: number[];
}

/** `review`: one unit for the book. */
export interface StoryReviewResult {
  groups: StoryReviewGroup[];
  joins: StoryJoin[];
  /** Members the code kept out of a group, with why. */
  blocked: { id: number; reason: StoryReviewBlockReason }[];
  /** Every merged entity belongs to exactly one cast entity. */
  cast: StoryCastEntity[];
}

export type StoryReviewBlockReason = 'honorific' | 'shared-surname' | 'another-person' | 'other-kind' | 'reveal-without-quote';

/** A tie that passed the checks. `a` and `b` are entry names of the passage's own cast (`names`). */
export interface StoryTie {
  a: string;
  type: StoryGuideTieType;
  b: string;
  /** The merged entities `a` and `b` are, through the passage's placement (or the narrator filled in from the cast). */
  aEntity: number;
  bEntity: number;
  quote: PassageSpan;
  /** Where both sides are named: in the quote, in its paragraph or the one before, or within the window before it. */
  evidence: 'quote' | 'paragraph' | 'nearby';
}

export interface StoryDroppedTie {
  a: string;
  type: string;
  b: string;
  quote: string;
  reason: StoryTieDropReason;
}

export type StoryTieDropReason =
  | 'type not on the list'
  | 'name not in the cast'
  | 'points at itself'
  | 'quote not in the passage'
  | 'a side is not named near the quote'
  | 'family only by a title';

/** `ties`: one per passage. */
export interface StoryTiesResult {
  passage: string;
  /** The narrator the checks used: the passage's own, or its chapter's or the book's. */
  narrator: string | null;
  kept: StoryTie[];
  dropped: StoryDroppedTie[];
}

/** The end a line is stamped with: a chapter's, or a part's when the chapter is long. */
export interface StoryLinesThrough {
  chapter: number;
  /** Null when the chapter has one part. */
  part: number | null;
}

export interface StoryLineChange {
  /**
   * The merged entity the line belongs to: a cast entity's `id`, or a member not yet joined to it.
   * A member's lines end at its join; assemble shows them under the join.
   */
  entity: number;
  /** The name the step used for it. */
  name: string;
  text: string;
}

export interface StoryDroppedLine extends StoryLineChange {
  reason: StoryLineDropReason;
}

export type StoryLineDropReason = 'names-later-entity' | 'too-long' | 'hedged' | 'narrator';

/** `lines`: one per chapter, or per part of a long chapter, in order. */
export interface StoryLinesResult {
  through: StoryLinesThrough;
  /** Lines new or changed at this end. Earlier lines still hold; replay the units in order for the state. */
  lines: StoryLineChange[];
  /** Lines that failed a check after their one rewrite; the previous line stays. */
  dropped: StoryDroppedLine[];
  rewritten: number;
}

export interface StoryDroppedProfile extends StoryLineChange {
  reason: StoryProfileDropReason;
}

export type StoryProfileDropReason = 'names-later-entity' | 'too-long' | 'narrator';

/** `profiles`: one per unit of the `lines` step, in order. A profile is kept in a `StoryLineChange`. */
export interface StoryProfilesResult {
  through: StoryLinesThrough;
  /** Profiles new or changed at this end. Earlier ones still hold; replay the units in order for the state. */
  profiles: StoryLineChange[];
  /** Profiles that failed a check after their one rewrite; the previous profile stays. */
  dropped: StoryDroppedProfile[];
  rewritten: number;
}

export type StorySummaryDropReason = 'names-later-entity' | 'too-long';

/** `summaries`: one per unit of the `lines` step, in order. */
export interface StorySummaryResult {
  through: StoryLinesThrough;
  /** What happens in the unit alone; null when it tells no story, or when its summary failed a check after its one rewrite. */
  text: string | null;
  /** The summary that failed a check after its one rewrite, which the guide leaves out. */
  dropped: { text: string; reason: StorySummaryDropReason } | null;
  rewritten: boolean;
}
