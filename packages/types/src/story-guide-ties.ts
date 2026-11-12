/**
 * The kinds of a story guide's entities and the fixed tie types between them. The server's checks
 * and the apps read the same registry; the apps keep a copy of it as JSON
 * (`server/src/modules/story-guides/test-fixtures/tie-types.json`), which a server test keeps equal.
 */

/** A client that does not know a kind shows it under Terms. */
export const STORY_GUIDE_ENTITY_KINDS = ["character", "place", "group", "event", "object", "idea"] as const;
export type StoryGuideEntityKind = (typeof STORY_GUIDE_ENTITY_KINDS)[number];

/** Where the apps show a tie, in this order. */
export const STORY_GUIDE_TIE_GROUPS = [
  { group: "family", label: "Family" },
  { group: "love", label: "Love" },
  { group: "bonds", label: "Bonds" },
  { group: "friends-and-enemies", label: "Friends and enemies" },
  { group: "work-and-study", label: "Work and study" },
  { group: "belongs-to", label: "Belongs to" },
  { group: "owns", label: "Owns" },
  { group: "lives-at", label: "Lives at" },
] as const;
export type StoryGuideTieGroup = (typeof STORY_GUIDE_TIE_GROUPS)[number]["group"];

export interface StoryGuideTieTypeInfo {
  type: string;
  /** "a <type> b" says the same as "b <type> a"; such a tie's key orders a and b. */
  symmetric: boolean;
  group: StoryGuideTieGroup;
  /** Kinds a may have. */
  from: readonly StoryGuideEntityKind[];
  /** Kinds b may have. */
  to: readonly StoryGuideEntityKind[];
  /** English fallback, read as "a <label> b", for a type a client does not know. */
  label: string;
}

const PERSON = ["character"] as const;
const PERSON_OR_GROUP = ["character", "group"] as const;

export const STORY_GUIDE_TIE_TYPES = [
  { type: "parent_of", symmetric: false, group: "family", from: PERSON, to: PERSON, label: "parent of" },
  { type: "grandparent_of", symmetric: false, group: "family", from: PERSON, to: PERSON, label: "grandparent of" },
  { type: "aunt_or_uncle_of", symmetric: false, group: "family", from: PERSON, to: PERSON, label: "aunt or uncle of" },
  { type: "sibling_of", symmetric: true, group: "family", from: PERSON, to: PERSON, label: "sibling of" },
  { type: "spouse_of", symmetric: true, group: "family", from: PERSON, to: PERSON, label: "spouse of" },
  { type: "betrothed_to", symmetric: true, group: "family", from: PERSON, to: PERSON, label: "betrothed to" },
  { type: "cousin_of", symmetric: true, group: "family", from: PERSON, to: PERSON, label: "cousin of" },
  { type: "relative_of", symmetric: true, group: "family", from: PERSON, to: PERSON, label: "relative of" },
  { type: "loves", symmetric: false, group: "love", from: PERSON, to: PERSON, label: "loves" },
  { type: "bonded_to", symmetric: true, group: "bonds", from: PERSON, to: PERSON, label: "bonded to" },
  { type: "friend_of", symmetric: true, group: "friends-and-enemies", from: PERSON_OR_GROUP, to: PERSON_OR_GROUP, label: "friend of" },
  { type: "enemy_of", symmetric: true, group: "friends-and-enemies", from: PERSON_OR_GROUP, to: PERSON_OR_GROUP, label: "enemy of" },
  { type: "rival_of", symmetric: true, group: "friends-and-enemies", from: PERSON_OR_GROUP, to: PERSON_OR_GROUP, label: "rival of" },
  { type: "teaches", symmetric: false, group: "work-and-study", from: PERSON, to: ["character", "group", "place"], label: "teaches" },
  { type: "works_for", symmetric: false, group: "work-and-study", from: PERSON, to: ["character", "group", "place"], label: "works for" },
  { type: "studies_at", symmetric: false, group: "work-and-study", from: PERSON, to: ["character", "group", "place"], label: "studies at" },
  { type: "member_of", symmetric: false, group: "belongs-to", from: PERSON_OR_GROUP, to: ["group"], label: "member of" },
  { type: "owns", symmetric: false, group: "owns", from: PERSON_OR_GROUP, to: STORY_GUIDE_ENTITY_KINDS, label: "owns" },
  { type: "lives_at", symmetric: false, group: "lives-at", from: PERSON_OR_GROUP, to: ["place", "character"], label: "lives at" },
] as const satisfies readonly StoryGuideTieTypeInfo[];

export type StoryGuideTieType = (typeof STORY_GUIDE_TIE_TYPES)[number]["type"];

const TIE_TYPES_BY_NAME: ReadonlyMap<string, StoryGuideTieTypeInfo> = new Map(STORY_GUIDE_TIE_TYPES.map((info) => [info.type, info]));

/** The registry entry for a type, or undefined for one this version does not know. */
export function storyGuideTieType(type: string): StoryGuideTieTypeInfo | undefined {
  return TIE_TYPES_BY_NAME.get(type);
}
