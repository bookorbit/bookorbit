import type { AiStep, AiStepRequest } from '../../ai-jobs/ai-feature';
import { hashOf } from '../../ai-jobs/ai-fingerprint';
import { askForJson } from './json-reply';
import { entityKind } from './merge-step';
import {
  HONORIFIC_ONLY,
  NAME_PREFIX_WORDS,
  TITLES,
  WORD_CHAR,
  escapeRegExp,
  isNumberOnly,
  mostCommon,
  nameKey,
  namesConflict,
  ownWords,
  splitWords,
} from './name-text';
import { mergeResult, passageOrder, textResult } from './step-context';
import type { StoryGuideSubject } from './story-guide-subject';
import type {
  PassageSpan,
  StoryCastEntity,
  StoryJoin,
  StoryMergedEntity,
  StoryMergeResult,
  StoryReviewBlockReason,
  StoryReviewGroup,
  StoryReviewResult,
} from './story-guide.types';
import type { TextStepResult } from './text-step';

export const REVIEW_SYSTEM =
  'Below is the cast of one novel, found chapter by chapter, so the same person or thing can appear as several entries. Each line is: ' +
  'id | name | other names | kind | chapters it appears in | what it is where it first appears.\n' +
  'Group the entries that are the same person or thing. Join two entries only when their names or descriptions show it: a first name and ' +
  'a full name, a title and a surname, a nickname the descriptions tie to someone. A title and surname ("Lady Kaltar") can be the person a ' +
  'later chapter names with a title and first name ("Lady Porthia") when the descriptions agree, for example the same husband, house or ' +
  'role. A title and surname can also be the father, mother or spouse of someone with that surname; never join a parent with a son or ' +
  'daughter. A common noun, honorific or bare title used as a name ("House", "Fair", "Gift", "Ladyship", "Guildmaster", "the Watch") can ' +
  'mean different things in different chapters: never join it with a named entry, and never join two different groups or offices that ' +
  'share a word. Relatives are different people. A family and its members are different entries. A person is never the same entry as a ' +
  'house, family, group, office, title or idea, even when the person leads it or is called by it. Two people who share a first name or a ' +
  'surname are different people (a father and son, a grandfather and grandson, two cousins) unless the descriptions say they are one. Do ' +
  'not use what you know about the book from elsewhere; use only these lines.\n' +
  'For each group give its ids and "from": the chapter in which the book first shows they are the same, never earlier than the chapter ' +
  'where the later entry first appears. When the book reveals that someone was known by another name or was someone else all along, ' +
  '"from" is the chapter of the reveal.\n' +
  'A line that ends with "narrator" names someone the book shows telling a passage as "I". One narrator can appear as several entries ' +
  '(a full name, a nickname, a pet name): join the marked lines whose names or descriptions fit one person, and keep apart narrators who ' +
  'are different people. The mark alone never joins two lines.\n' +
  'Answer with JSON only, in this shape: {"groups": [{"ids": [1, 2], "from": 3}]}';

export const REVIEW_MAX_OUTPUT_TOKENS = 16000;
/** The Careful model's context when the model list does not say; the step cannot see the list. */
export const REVIEW_CONTEXT_TOKENS = 100_000;
/** A cautious estimate, so a batch never overflows the context. */
const CHARS_PER_TOKEN = 3;
/** A reveal's quote, like any anchor's, is at most this many words. */
export const QUOTE_WORDS = 12;

/** One line of the cast list: id | name | other names | kind | chapters | what it is where it first appears, then "narrator" for who tells passages as "I". */
export function reviewLine(entity: StoryMergedEntity, chapterOf: ReadonlyMap<string, number>): string {
  const others = entity.names.filter((name) => name.key !== nameKey(entity.name)).map((name) => name.text);
  const chapters = [...new Set(entity.passages.map((passage) => chapterOf.get(passage)!))].sort((a, b) => a - b);
  const fields = [entity.id, entity.name, others.slice(0, 6).join(', '), entityKind(entity), chapters.join(','), entity.what[0]?.text ?? ''];
  return (entity.narrated ? [...fields, 'narrator'] : fields).join(' | ');
}

/**
 * The cast in batches that each fit the context, or one batch when the whole cast does. Entities
 * that share a name word go in one batch where they can; an entity with two such words can land in
 * two batches, and a word shared by more than a batch holds is cut with an overlap, so a join across
 * batches is still seen together somewhere.
 */
export function reviewBatches(entities: readonly StoryMergedEntity[], lines: readonly string[], budgetChars: number): number[][] {
  const size = (id: number) => lines[id].length + 1;
  if (entities.reduce((sum, entity) => sum + size(entity.id), 0) <= budgetChars) return [entities.map((entity) => entity.id)];

  const buckets = new Map<string, number[]>();
  for (const entity of entities) {
    for (const word of new Set(entity.names.flatMap((name) => ownWords(name.text)).filter((word) => word.length >= 3))) {
      const bucket = buckets.get(word);
      if (bucket) bucket.push(entity.id);
      else buckets.set(word, [entity.id]);
    }
  }
  const sharedBuckets = [...buckets.values()].filter((ids) => ids.length >= 2).sort((a, b) => b.length - a.length || a[0] - b[0]);
  const batches: number[][] = [];
  let current = new Set<number>();
  let used = 0;
  const flush = () => {
    if (current.size > 0) batches.push([...current].sort((a, b) => a - b));
    current = new Set();
    used = 0;
  };
  const place = (ids: readonly number[]) => {
    const fresh = ids.filter((id) => !current.has(id));
    const needed = fresh.reduce((sum, id) => sum + size(id), 0);
    if (used + needed > budgetChars) flush();
    for (const id of ids) {
      if (current.has(id)) continue;
      current.add(id);
      used += size(id);
    }
  };
  const placed = new Set<number>();
  for (const ids of sharedBuckets) {
    for (const chunk of overlappingChunks(ids, size, budgetChars)) {
      place(chunk);
      chunk.forEach((id) => placed.add(id));
    }
  }
  for (const entity of entities) if (!placed.has(entity.id)) place([entity.id]);
  flush();
  return batches;
}

/** A word's entities in pieces of at most half a batch, each repeating the last quarter of the one before. */
function overlappingChunks(ids: readonly number[], size: (id: number) => number, budgetChars: number): number[][] {
  const total = ids.reduce((sum, id) => sum + size(id), 0);
  if (total <= budgetChars / 2) return [[...ids]];
  const chunks: number[][] = [];
  let start = 0;
  while (start < ids.length) {
    let end = start;
    let used = 0;
    while (end < ids.length && (end === start || used + size(ids[end]) <= budgetChars / 2)) used += size(ids[end++]);
    chunks.push(ids.slice(start, end));
    if (end >= ids.length) break;
    start = Math.max(start + 1, end - Math.max(1, Math.floor((end - start) / 4)));
  }
  return chunks;
}

/** The requests that review the cast, one per batch. */
export function reviewRequests(
  merge: StoryMergeResult,
  text: Pick<TextStepResult, 'passages'>,
  contextTokens = REVIEW_CONTEXT_TOKENS,
): AiStepRequest[] {
  const chapterOf = new Map(text.passages.map((passage) => [passage.id, passage.chapter]));
  const lines = merge.entities.map((entity) => reviewLine(entity, chapterOf));
  const budget = (contextTokens - REVIEW_MAX_OUTPUT_TOKENS) * CHARS_PER_TOKEN - REVIEW_SYSTEM.length;
  return reviewBatches(merge.entities, lines, budget).map((ids) => ({
    system: REVIEW_SYSTEM,
    user: ids.map((id) => lines[id]).join('\n'),
    maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS,
    effort: 'medium',
  }));
}

/** The answer's groups, or null when it has no list of them. An empty list is an answer. */
export function readReviewAnswer(answer: Record<string, unknown>): unknown[] | null {
  return Array.isArray(answer.groups) ? answer.groups : null;
}

/** The answered groups with ids that exist, at least two each, dated no earlier than the later member's first chapter. */
export function reviewGroups(answered: readonly unknown[], merge: StoryMergeResult, text: Pick<TextStepResult, 'passages'>): StoryReviewGroup[] {
  const chapterOf = new Map(text.passages.map((passage) => [passage.id, passage.chapter]));
  const firstChapter = (id: number) => chapterOf.get(merge.entities[id].first)!;
  return answered.flatMap((item): StoryReviewGroup[] => {
    if (item === null || typeof item !== 'object') return [];
    const group = item as Record<string, unknown>;
    const raw = Array.isArray(group.ids) ? group.ids : [];
    const ids = [...new Set(raw.filter((id): id is number => Number.isInteger(id) && id >= 0 && id < merge.entities.length))];
    if (ids.length < 2) return [];
    const earliest = Math.max(...ids.map(firstChapter));
    const modelFrom = chapterNumber(group.from);
    return [{ ids, from: Math.max(modelFrom || earliest, earliest), modelFrom }];
  });
}

function chapterNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

interface Link {
  members: number[];
  at: PassageSpan;
  chapter: number;
  reveal: boolean;
}

/**
 * Applies the review's groups. Code keeps out of a group: names made only of titles, honorifics,
 * role words or numbers; a one-word surname two or more people carry; members of another kind than
 * most; and a full name that conflicts with every kept one, with the bare names of who left.
 *
 * The review sees no text, so code dates each join. A group whose members all appeared before the
 * chapter the review gave is a reveal: each member joins at the first quote of at most 12 words, from
 * that chapter on, naming it and another member, and stays apart when there is none. Any other group
 * joins at the first appearance of its later member. A member joins its entity, the member with the
 * most passages, once a chain of joins reaches it; before that it is its own entry.
 */
export function applyReview(groups: readonly StoryReviewGroup[], merge: StoryMergeResult, text: TextStepResult): StoryReviewResult {
  const entities = merge.entities;
  const order = passageOrder(text);
  const chapterOf = new Map(text.passages.map((passage) => [passage.id, passage.chapter]));
  const firstChapter = (id: number) => chapterOf.get(entities[id].first)!;
  const kind = (id: number) => entityKind(entities[id]);
  const fullName = (id: number) => {
    const words = nameKey(entities[id].name)
      .split(' ')
      .filter((word) => word && !TITLES.has(word) && !NAME_PREFIX_WORDS.has(word));
    return kind(id) === 'character' && words.length >= 2 ? words : null;
  };
  const bareWords = (id: number) =>
    nameKey(entities[id].name)
      .split(' ')
      .filter((word) => word && !TITLES.has(word) && !NAME_PREFIX_WORDS.has(word));

  // A one-word name that is the surname of two or more people ("Drebber") never joins anyone. People
  // are counted by review group, and only names with a personal name before the surname count.
  const personal = (entity: StoryMergedEntity) =>
    splitWords(entity.name)
      .slice(0, -1)
      .some((word) => !TITLES.has(word.replace(/^\.+|\.+$/g, '').toLowerCase()));
  const groupOf = new Map<number, number>();
  groups.forEach((group, index) => group.ids.forEach((id) => groupOf.has(id) || groupOf.set(id, index)));
  const surnamePeople = new Map<string, Set<string>>();
  for (const entity of entities) {
    if (kind(entity.id) !== 'character' || splitWords(entity.name).length <= 1 || !personal(entity)) continue;
    const surname = splitWords(entity.name).at(-1)!.toLowerCase();
    const people = surnamePeople.get(surname) ?? new Set<string>();
    people.add(groupOf.has(entity.id) ? `group ${groupOf.get(entity.id)}` : `alone ${entity.id}`);
    surnamePeople.set(surname, people);
  }
  const shared = (id: number) => {
    const entity = entities[id];
    const surname = entity.name.toLowerCase();
    if (splitWords(entity.name).length !== 1 || (surnamePeople.get(surname)?.size ?? 0) < 2) return false;
    return entity.names.every((name) => {
      const words = nameKey(name.key).split(' ');
      return words.at(-1) === surname && words.slice(0, -1).every((word) => TITLES.has(word));
    });
  };
  const honorific = (id: number) =>
    splitWords(entities[id].name).every((word) => {
      const plain = word.replace(/^\.+|\.+$/g, '').toLowerCase();
      return TITLES.has(plain) || HONORIFIC_ONLY.has(plain) || NAME_PREFIX_WORDS.has(plain);
    }) || isNumberOnly(entities[id].name);

  const blocked = new Map<string, { id: number; reason: StoryReviewBlockReason }>();
  const block = (id: number, reason: StoryReviewBlockReason) => blocked.set(`${id} ${reason}`, { id, reason });
  const links: Link[] = [];

  for (const group of groups) {
    group.ids.filter(honorific).forEach((id) => block(id, 'honorific'));
    const ids = group.ids.filter((id) => !honorific(id));
    if (ids.length < 2) continue;
    const mainKind = mostCommon(ids.map(kind));
    ids.filter(shared).forEach((id) => block(id, 'shared-surname'));
    const candidates = ids.filter((id) => kind(id) === mainKind && !shared(id));

    let kept: number[] = [];
    const left: number[] = [];
    for (const id of [...candidates].sort((a, b) => entities[b].passages.length - entities[a].passages.length)) {
      const mine = fullName(id);
      const theirs = kept.map(fullName).filter((name): name is string[] => name !== null);
      if (mine && theirs.length > 0 && theirs.every((name) => namesConflict(mine, name))) left.push(id);
      else kept.push(id);
    }
    const staySurnames = new Set(kept.flatMap((id) => fullName(id)?.slice(-1) ?? []));
    const gone = new Set([
      ...left.map((id) => fullName(id)![0]),
      ...left.map((id) => fullName(id)!.at(-1)!).filter((surname) => !staySurnames.has(surname)),
    ]);
    left.push(...kept.filter((id) => bareWords(id).length === 1 && gone.has(bareWords(id)[0])));
    kept = kept.filter((id) => !left.includes(id));
    left.forEach((id) => block(id, 'another-person'));
    if (kept.length < 2) continue;
    ids.filter((id) => kind(id) !== mainKind).forEach((id) => block(id, 'other-kind'));

    const members = [...kept].sort((a, b) => order.get(entities[a].first)! - order.get(entities[b].first)! || a - b);
    const latest = members[members.length - 1];
    if (group.modelFrom !== null && group.modelFrom > firstChapter(latest)) {
      for (const id of members) {
        const quote = revealQuote(
          entities,
          id,
          members.filter((other) => other !== id),
          text,
          group.modelFrom,
        );
        if (quote) links.push({ members: [id, quote.partner], at: quote.at, chapter: chapterOf.get(quote.at.passage)!, reveal: true });
        else block(id, 'reveal-without-quote');
      }
    } else {
      links.push({ members, at: firstSighting(entities[latest], order), chapter: firstChapter(latest), reveal: false });
    }
  }

  const { cast, joins } = castFromLinks(entities, links, order);
  return { groups: [...groups], joins, blocked: [...blocked.values()], cast };
}

/** Where an entity's first name occurs. */
export function firstSighting(entity: StoryMergedEntity, order: ReadonlyMap<string, number>): PassageSpan {
  return entity.names.reduce((best, name) =>
    order.get(name.at.passage)! < order.get(best.at.passage)! || (name.at.passage === best.at.passage && name.at.offset < best.at.offset)
      ? name
      : best,
  ).at;
}

/** The first quote, in a chapter from `fromChapter` on, that names `id` and one of `partners`. */
function revealQuote(
  entities: readonly StoryMergedEntity[],
  id: number,
  partners: readonly number[],
  text: TextStepResult,
  fromChapter: number,
): { at: PassageSpan; partner: number } | null {
  const mine = entities[id].names.map((name) => name.text);
  const theirs = partners.flatMap((partner) => entities[partner].names.map((name) => ({ text: name.text, partner })));
  for (const passage of text.passages) {
    if (passage.chapter < fromChapter) continue;
    let best: { start: number; end: number; partner: number } | null = null;
    let lineStart = 0;
    for (const line of passage.text.split('\n')) {
      const own = occurrences(line, mine);
      const other = theirs.flatMap(({ text: name, partner }) => occurrences(line, [name]).map((found) => ({ ...found, partner })));
      for (const a of own) {
        for (const b of other) {
          if (a.start < b.end && b.start < a.end) continue;
          const start = Math.min(a.start, b.start);
          const end = Math.max(a.end, b.end);
          if (splitWords(line.slice(start, end)).length > QUOTE_WORDS) continue;
          if (!best || lineStart + start < best.start || (lineStart + start === best.start && lineStart + end < best.end)) {
            best = { start: lineStart + start, end: lineStart + end, partner: b.partner };
          }
        }
      }
      lineStart += line.length + 1;
    }
    if (best) {
      return { at: { passage: passage.id, offset: best.start, text: passage.text.slice(best.start, best.end) }, partner: best.partner };
    }
  }
  return null;
}

/** Whole-word occurrences of any of the names, comparing apostrophes as one. */
function occurrences(line: string, names: readonly string[]): { start: number; end: number }[] {
  const folded = line.replace(/’/g, "'");
  return names.flatMap((name) => {
    const target = name.replace(/’/g, "'");
    if (!target) return [];
    const pattern = new RegExp(`(?<!${WORD_CHAR})${escapeRegExp(target)}(?!${WORD_CHAR})`, 'gu');
    return [...folded.matchAll(pattern)].map((match) => ({ start: match.index, end: match.index + target.length }));
  });
}

/**
 * The cast from the links: each connected set of entities is one cast entity, named by its member
 * with the most passages. A member joins it at the first link that connects the two.
 */
function castFromLinks(
  entities: readonly StoryMergedEntity[],
  links: readonly Link[],
  order: ReadonlyMap<string, number>,
): { cast: StoryCastEntity[]; joins: StoryJoin[] } {
  const all = unionFind(entities.length);
  for (const link of links) for (const id of link.members.slice(1)) all.union(link.members[0], id);
  const components = new Map<number, number[]>();
  for (const entity of entities) {
    const root = all.find(entity.id);
    const members = components.get(root) ?? [];
    members.push(entity.id);
    components.set(root, members);
  }
  const head = new Map<number, number>();
  for (const members of components.values()) {
    const canonical = members.reduce((best, id) => (entities[id].passages.length > entities[best].passages.length ? id : best));
    for (const id of members) head.set(id, canonical);
  }

  const sorted = [...links].sort((a, b) => order.get(a.at.passage)! - order.get(b.at.passage)! || a.at.offset - b.at.offset);
  const sofar = unionFind(entities.length);
  const joins = new Map<number, StoryJoin>();
  for (const link of sorted) {
    for (const id of link.members.slice(1)) sofar.union(link.members[0], id);
    const canonical = head.get(link.members[0])!;
    for (const id of components.get(all.find(canonical))!) {
      if (id === canonical || joins.has(id) || sofar.find(id) !== sofar.find(canonical)) continue;
      joins.set(id, { member: id, into: canonical, chapter: link.chapter, at: link.at, reveal: link.reveal });
    }
  }

  const firstOrder = (id: number) => order.get(entities[id].first)!;
  const cast = [...components.values()]
    .map((members): StoryCastEntity => {
      const canonical = head.get(members[0])!;
      const others = members.filter((id) => id !== canonical).sort((a, b) => firstOrder(a) - firstOrder(b) || a - b);
      return { id: canonical, name: entities[canonical].name, kind: entityKind(entities[canonical]), members: [canonical, ...others] };
    })
    .sort((a, b) => Math.min(...a.members.map(firstOrder)) - Math.min(...b.members.map(firstOrder)) || a.id - b.id);
  const joinList = [...joins.values()].sort(
    (a, b) => order.get(a.at.passage)! - order.get(b.at.passage)! || a.at.offset - b.at.offset || a.member - b.member,
  );
  return { cast, joins: joinList };
}

function unionFind(size: number): { find(id: number): number; union(a: number, b: number): void } {
  const parent = Array.from({ length: size }, (_, index) => index);
  const find = (id: number): number => {
    while (parent[id] !== id) {
      parent[id] = parent[parent[id]];
      id = parent[id];
    }
    return id;
  };
  return {
    find,
    union(a, b) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    },
  };
}

/** `review`: one call over the cast list (in batches when it is too large), on the careful slot. */
export function reviewAiStep(): AiStep<StoryGuideSubject> {
  return {
    id: 'review',
    version: 2,
    slot: 'careful',
    dependsOn: ['text', 'merge'],
    units: () => [{ id: 'cast' }],
    fingerprint: (ctx) =>
      hashOf(
        'review',
        reviewRequests(mergeResult(ctx), textResult(ctx)).map((request) => [request.system, request.user]),
      ),
    async run(ctx) {
      const merge = mergeResult(ctx);
      const text = textResult(ctx);
      const answered: unknown[] = [];
      for (const request of reviewRequests(merge, text)) answered.push(...(await askForJson(ctx, request, readReviewAnswer)));
      return applyReview(reviewGroups(answered, merge, text), merge, text);
    },
  };
}
