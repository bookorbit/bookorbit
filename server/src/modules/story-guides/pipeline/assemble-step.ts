import {
  storyGuideTieType,
  type StoryGuideAnchor,
  type StoryGuideEntityKind,
  type StoryGuideEntity,
  type StoryGuideLine,
  type StoryGuideName,
  type StoryGuidePayloadV1,
  type StoryGuideSectionInfo,
  type StoryGuideTie,
} from '@bookorbit/types';

import { StoryAnchors } from './anchors';
import type {
  PassageSpan,
  StoryCastEntity,
  StoryJoin,
  StoryLinesResult,
  StoryLinesThrough,
  StoryMergeResult,
  StoryProfilesResult,
  StoryReviewResult,
  StorySummaryResult,
  StoryTiesResult,
} from './story-guide.types';
import { shipTies, type PlacedTie } from './ties-step';
import { passageOrder } from './step-context';
import type { TextStepResult } from './text-step';

/** A tie keeps this many of its quotes; `count` says how many there were. */
export const TIE_QUOTES = 3;

/**
 * A name's key: folded like the app index's names (case, diacritics, width, curly apostrophes and a
 * possessive ending never matter), then without punctuation, words joined by hyphens.
 */
export function storyGuideKey(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\u2019\u02BC]/g, "'")
    .split(/\s+/)
    .map((word) => word.replace(/'s$|'$/u, '').replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  return words.join('-') || 'entry';
}

/** Hands out keys, adding `-2`, `-3` to a key already taken, in the order asked. */
class Keys {
  private readonly taken = new Set<string>();

  take(name: string): string {
    const base = storyGuideKey(name);
    let key = base;
    for (let n = 2; this.taken.has(key); n++) key = `${base}-${n}`;
    this.taken.add(key);
    return key;
  }
}

export interface AssembleInput {
  textKey: string;
  pipeline: string;
  builtAt: string;
  language: string;
  models: StoryGuidePayloadV1['models'];
  coverage: number;
  sections: readonly StoryGuideSectionInfo[];
  text: TextStepResult;
  /** Each story section's raw text, by spine index. */
  raw: ReadonlyMap<number, string>;
  merge: StoryMergeResult;
  review: StoryReviewResult;
  ties: Iterable<StoryTiesResult>;
  lines: Iterable<StoryLinesResult>;
  profiles: Iterable<StoryProfilesResult>;
  summaries: Iterable<StorySummaryResult>;
}

/** What assemble left out because it could not anchor it; zero unless the text and steps disagree. */
export interface AssembleDropped {
  names: number;
  entries: number;
  lines: number;
  profiles: number;
  summaries: number;
  quotes: number;
}

interface Place {
  passage: number;
  offset: number;
}

function before(a: Place, b: Place): boolean {
  return a.passage < b.passage || (a.passage === b.passage && a.offset < b.offset);
}

/** Reading order of the ends lines, profiles and summaries are stamped with. */
function throughOrder(a: { through: StoryLinesThrough }, b: { through: StoryLinesThrough }): number {
  return a.through.chapter - b.through.chapter || (a.through.part ?? 0) - (b.through.part ?? 0);
}

/**
 * The payload, format 1. A cast entity is shown as its `id`, the member whose name it took; every
 * other member joins it at its dated join, and before that is an entry of its own. A tie names a
 * member by its own key before its join and the shown entity after, so a tie never reveals a join.
 */
export function assembleStoryGuide(input: AssembleInput): { payload: StoryGuidePayloadV1; dropped: AssembleDropped } {
  const { merge, review, text } = input;
  const dropped: AssembleDropped = { names: 0, entries: 0, lines: 0, profiles: 0, summaries: 0, quotes: 0 };
  const anchors = new StoryAnchors(text, input.raw);
  const order = passageOrder(text);
  const place = (span: PassageSpan): Place => ({ passage: order.get(span.passage) ?? Number.MAX_SAFE_INTEGER, offset: span.offset });
  const compare = (a: Place, b: Place) => (before(a, b) ? -1 : before(b, a) ? 1 : 0);
  const firstSeen = (id: number): Place =>
    merge.entities[id].names
      .map((name) => place(name.at))
      .reduce((first, at) => (before(at, first) ? at : first), { passage: Number.MAX_SAFE_INTEGER, offset: Number.MAX_SAFE_INTEGER });

  const joinOf = new Map<number, StoryJoin>(review.joins.map((join) => [join.member, join]));
  const castOf = new Map<number, StoryCastEntity>();
  for (const cast of review.cast) for (const id of cast.members) castOf.set(id, cast);

  const nameLists = new Map<number, StoryGuideName[]>();
  const names = (id: number): StoryGuideName[] => {
    let out = nameLists.get(id);
    if (!out) {
      out = [];
      for (const name of merge.entities[id].names) {
        const at = anchors.span(name.at);
        if (at) out.push({ text: name.text, at });
        else dropped.names++;
      }
      nameLists.set(id, out);
    }
    return out;
  };

  // An entry is shown when it has a placeable name, and a member also needs its join placed and its
  // cast entity shown. What is not shown is left out with its lines and ties.
  const shown = new Set<number>();
  const joinAt = new Map<number, StoryGuideAnchor>();
  for (const cast of review.cast) {
    if (names(cast.id).length === 0) continue;
    shown.add(cast.id);
    for (const id of cast.members) {
      const join = joinOf.get(id);
      if (id === cast.id || !join || names(id).length === 0) continue;
      const at = anchors.span(join.at);
      if (!at) continue;
      joinAt.set(id, at);
      shown.add(id);
    }
  }
  dropped.entries = merge.entities.length - shown.size;

  // Keys in reading order of first sighting, entities and joins alike.
  const keys = new Keys();
  const keyOf = new Map<number, string>();
  for (const id of [...shown].sort((a, b) => compare(firstSeen(a), firstSeen(b)) || a - b)) keyOf.set(id, keys.take(merge.entities[id].name));

  // Lines and profiles are kept under a cast entity's id, or under a member until its join.
  const byEntity = (results: Iterable<{ through: StoryLinesResult['through']; changes: StoryLinesResult['lines'] }>, kind: 'lines' | 'profiles') => {
    const lists = new Map<number, StoryGuideLine[]>();
    const sorted = [...results].sort(throughOrder);
    for (const result of sorted) {
      const through = anchors.through(result.through);
      for (const change of result.changes) {
        if (!through || !shown.has(change.entity)) {
          dropped[kind]++;
          continue;
        }
        const list = lists.get(change.entity) ?? [];
        list.push({ through, text: change.text });
        lists.set(change.entity, list);
      }
    }
    return lists;
  };
  const lineLists = byEntity(
    [...input.lines].map((result) => ({ through: result.through, changes: result.lines })),
    'lines',
  );
  const profileLists = byEntity(
    [...input.profiles].map((result) => ({ through: result.through, changes: result.profiles })),
    'profiles',
  );

  const entities: { first: Place; entity: StoryGuideEntity }[] = [];
  for (const cast of review.cast) {
    if (!shown.has(cast.id)) continue;
    const members = cast.members.filter((id) => id !== cast.id && shown.has(id));
    const joins = members
      .map((id) => ({
        at: place(joinOf.get(id)!.at),
        join: {
          key: keyOf.get(id)!,
          name: merge.entities[id].name,
          names: names(id),
          lines: lineLists.get(id) ?? [],
          profiles: profileLists.get(id) ?? [],
          at: joinAt.get(id)!,
        },
      }))
      .sort((a, b) => compare(a.at, b.at));
    entities.push({
      first: members.map(firstSeen).reduce((first, at) => (before(at, first) ? at : first), firstSeen(cast.id)),
      entity: {
        key: keyOf.get(cast.id)!,
        name: merge.entities[cast.id].name,
        kind: cast.kind,
        names: names(cast.id),
        joins: joins.map((item) => item.join),
        lines: lineLists.get(cast.id) ?? [],
        profiles: profileLists.get(cast.id) ?? [],
        fixed: false,
      },
    });
  }
  entities.sort((a, b) => compare(a.first, b.first));

  // Ties: a side is its member's own entry before the member joins, its cast entity from then on.
  // A tie between two entries of one cast entity is the entity itself.
  const sideKey = (id: number, quote: PassageSpan): string | undefined => {
    const cast = castOf.get(id);
    if (!cast || !shown.has(id)) return undefined;
    const join = joinOf.get(id);
    return id !== cast.id && join && before(place(quote), place(join.at)) ? keyOf.get(id) : keyOf.get(cast.id);
  };
  const kindOfKey = new Map<string, StoryGuideEntityKind>();
  for (const id of shown) kindOfKey.set(keyOf.get(id)!, castOf.get(id)!.kind);
  const placed: PlacedTie[] = [];
  for (const result of input.ties) {
    for (const tie of result.kept) {
      if (castOf.get(tie.aEntity) === castOf.get(tie.bEntity)) continue;
      const a = sideKey(tie.aEntity, tie.quote);
      const b = sideKey(tie.bEntity, tie.quote);
      if (a && b) placed.push({ a, type: tie.type, b, quote: tie.quote, order: order.get(tie.quote.passage) ?? Number.MAX_SAFE_INTEGER });
    }
  }
  const ties: StoryGuideTie[] = [];
  for (const tie of shipTies(placed, (key) => kindOfKey.get(key)).kept) {
    const info = storyGuideTieType(tie.type);
    const quotes: StoryGuideAnchor[] = [];
    for (const quote of tie.quotes) {
      if (quotes.length === TIE_QUOTES) break;
      const at = anchors.span(quote);
      if (at) quotes.push(at);
      else dropped.quotes++;
    }
    if (!info || quotes.length === 0) continue;
    const key = `${tie.a}|${tie.type}|${tie.b}`;
    ties.push({ key, a: tie.a, type: tie.type, b: tie.b, label: info.label, at: quotes[0], quotes, count: tie.count, fixed: false });
  }

  // A unit whose summary was left out has none; nothing stands in for it.
  const summaries: StoryGuideLine[] = [];
  for (const result of [...input.summaries].sort(throughOrder)) {
    if (!result.text) continue;
    const through = anchors.through(result.through);
    if (through) summaries.push({ through, text: result.text });
    else dropped.summaries++;
  }

  return {
    payload: {
      format: 1,
      textKey: input.textKey,
      pipeline: input.pipeline,
      builtAt: input.builtAt,
      language: input.language,
      models: input.models,
      coverage: input.coverage,
      fixesRevision: 0,
      sections: input.sections.map(({ s, title, chars, h }) => ({ s, title, chars, h })),
      entities: entities.map((item) => item.entity),
      ties,
      summaries,
    },
    dropped,
  };
}
