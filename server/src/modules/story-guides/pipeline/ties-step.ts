import { storyGuideTieType, type StoryGuideEntityKind, type StoryGuideTieType } from '@bookorbit/types';

import type { AiStep, AiStepRequest } from '../../ai-jobs/ai-feature';
import { hashOf } from '../../ai-jobs/ai-fingerprint';
import { splitWhileTooLong } from '../../ai-jobs/ai-split';
import { askForJson } from './json-reply';
import { WORD_EDGE, escapeRegExp, nameKey, splitWords, straight, stripChars } from './name-text';
import { toldInFirstPerson } from './names-step';
import { mergeResult, namesResults, passageById, reviewResult, textResult } from './step-context';
import { ENGLISH_STORY_LEXICON, storyLexicon, type StoryLexicon } from './story-lexicon';
import type { StoryGuideSubject } from './story-guide-subject';
import type {
  PassageSpan,
  StoryDroppedTie,
  StoryMergeResult,
  StoryNamesResult,
  StoryReviewResult,
  StoryTie,
  StoryTieDropReason,
  StoryTiesResult,
} from './story-guide.types';
import type { StoryPassage, TextStepResult } from './text-step';

export const TIES_SYSTEM =
  'You read one passage of a novel and list the lasting relationships it states between the names listed after it.\n' +
  'Use only these types (read as "a <type> b"):\n' +
  '- family: parent_of, grandparent_of, sibling_of, spouse_of (married), betrothed_to (promised or engaged to marry, not yet married), ' +
  'aunt_or_uncle_of, cousin_of, relative_of (any other family tie)\n' +
  '- teaches (a teaches b: a pupil, a class or a subject), studies_at (a is a pupil at b), works_for (a works for or at b, or serves b), ' +
  'member_of (a belongs to the group, house, team or order b), owns (a owns or keeps b: a pet, creature, object or business), lives_at (a ' +
  'lives at b), bonded_to (a and b share a lasting bond: a rider and their dragon, a witch and their familiar, sworn or magical partners; ' +
  'never a romance or a friendship)\n' +
  '- friend_of, enemy_of, rival_of, loves: only when the passage says so in plain words, never from how they act in one scene. loves is ' +
  'romantic love only, never love for family or friends. Words used as a comparison ("like a brother") state no tie.\n' +
  'Rules:\n' +
  '- A relationship is a lasting tie, not something that happens in one scene. Handing over a letter, shouting at, sitting with, visiting ' +
  'or helping once are not relationships.\n' +
  '- The passage must state it or make it plain. Never use what you know about the book from elsewhere and never guess what comes later.\n' +
  '- Read each type exactly. works_for is a job or service, never loyalty, an office the person holds ("is the King\'s Own"), being sent ' +
  'somewhere or one errand. studies_at is a school the person attends now: a house, class or subject is not a school, and someone who has ' +
  'left or is only going to go does not study there. lives_at is where someone lives now, never a place visited or left, and never a ' +
  'person. member_of points at a group, house, team, order or lineage ("Descended from the X Line"), never a title, office or single ' +
  'person. owns is owning or keeping: lent, borrowed or touched is not owning, and a rider and their dragon are bonded_to. teaches needs ' +
  'lasting teaching, not one tip; a is the teacher.\n' +
  '- Rumours, disguises, cover stories and comparisons state no tie, and neither does one person\'s mistaken view. "X\'s friends" ties X ' +
  'to those friends, not to anyone else in the sentence.\n' +
  '- A family named as a whole ("the Harpers") is not a person: it is never a side of parent_of, grandparent_of, aunt_or_uncle_of, ' +
  'sibling_of, spouse_of, betrothed_to, cousin_of or relative_of. Tie the people it names instead, and when the passage names none, give no ' +
  'family tie.\n' +
  '- Strong words a character says or thinks in anger, fear, sleep or a vision ("my brother is my enemy" in a dream), a prophecy, a threat ' +
  'or an insult state no tie. enemy_of, rival_of and friend_of need the narration or a plain statement of a lasting bond, and relatives ' +
  'stay relatives.\n' +
  '- "Aunt", "Aunty", "Uncle", "Cousin", "Gran" or "Granny" in front of a name is often a title of respect, not family. File a family tie ' +
  'only when the quote states it in words other than the name ("his aunt", "her nephew").\n' +
  '- Use the names exactly as listed; both must be on the list and must be different.\n' +
  '- quote: the shortest exact words from the passage that show the tie, at most twenty, copied character for character.\n' +
  'Answer with JSON only: {"relations": [{"a": "...", "type": "...", "b": "...", "quote": "..."}]}. An empty list is a good answer when ' +
  'the passage states no lasting tie.';

export const TIES_MAX_OUTPUT_TOKENS = 6000;

/** One side may be named in the quote's paragraph and the other this many characters before it ("His aunt and uncle"). */
export const TIE_WINDOW = 1500;

/** The narrator a first-person passage with none of its own takes from its chapter or the book. */
export interface FilledNarrator {
  name: string;
  names: string[];
  /** The cast entity. */
  entity: number;
}

/** The passage's cast as the ties step reads it. */
export interface TiesCast {
  /** Name key to the entry name it belongs to. */
  lookup: Map<string, string>;
  /** Entry name to all its names. */
  namesOf: Map<string, string[]>;
  /** The "Names" list sent with the passage. */
  lines: string[];
  narrator: string | null;
  /** The entity of a narrator filled in from the cast, which the passage's placement does not hold. */
  filled: FilledNarrator | null;
  /** The book's lexicon; English when absent. */
  lexicon?: StoryLexicon;
}

export function tiesCast(
  names: StoryNamesResult,
  passageText: string,
  fill: FilledNarrator | undefined,
  lexicon: StoryLexicon = ENGLISH_STORY_LEXICON,
): TiesCast {
  const lookup = new Map<string, string>();
  const namesOf = new Map<string, string[]>();
  const lines: string[] = [];
  for (const entry of names.entries) {
    const all = [entry.name, ...entry.aliases];
    namesOf.set(entry.name, all);
    for (const name of all) if (!lookup.has(nameKey(name))) lookup.set(nameKey(name), entry.name);
    lines.push(`${entry.name} (${entry.kind})` + (entry.aliases.length > 0 ? `, also ${entry.aliases.join(', ')}` : ''));
  }
  let narrator = names.narrator && toldInFirstPerson(passageText, lexicon) ? names.narrator : null;
  let filled: FilledNarrator | null = null;
  if (!narrator && fill) {
    narrator = fill.name;
    filled = fill;
    if (!namesOf.has(fill.name)) {
      namesOf.set(fill.name, fill.names);
      for (const name of fill.names) if (!lookup.has(nameKey(name))) lookup.set(nameKey(name), fill.name);
      lines.push(`${fill.name} (character)`);
    }
  }
  return { lookup, namesOf, lines, narrator, filled, lexicon };
}

export function tiesRequest(passageText: string, cast: Pick<TiesCast, 'lines' | 'narrator'>): AiStepRequest {
  const told = cast.narrator ? `\n\nThis passage is told by ${cast.narrator} as "I".` : '';
  return {
    system: TIES_SYSTEM,
    user: 'Passage:\n' + passageText + told + '\n\nNames:\n' + cast.lines.join('\n'),
    maxOutputTokens: TIES_MAX_OUTPUT_TOKENS,
    effort: 'medium',
  };
}

/** The answer's relations, or null when it has no list of them. An empty list is an answer. */
export function readTiesAnswer(answer: Record<string, unknown>): unknown[] | null {
  return Array.isArray(answer.relations) ? answer.relations : null;
}

/**
 * Who tells each first-person passage that names no narrator: its chapter's narrator, or the book's
 * when every named narrator is one cast entity. A first-person passage that never names its narrator
 * otherwise gets no ties from "my sister".
 */
export function narratorFill(
  passages: readonly StoryPassage[],
  names: ReadonlyMap<string, StoryNamesResult>,
  merge: StoryMergeResult,
  review: StoryReviewResult,
  lexicon: StoryLexicon = ENGLISH_STORY_LEXICON,
): Map<string, FilledNarrator> {
  const entityOf = new Map<string, number>();
  const namesOfCast = new Map<number, string[]>();
  for (const entity of review.cast) {
    const keys = entity.members.flatMap((id) => merge.entities[id].names.map((name) => name.key));
    namesOfCast.set(entity.id, [entity.name, ...keys.filter((key) => key !== nameKey(entity.name))]);
    for (const key of [nameKey(entity.name), ...keys]) if (!entityOf.has(key)) entityOf.set(key, entity.id);
  }
  const nameOfCast = new Map(review.cast.map((entity) => [entity.id, entity.name]));
  const named = new Map<string, number>();
  for (const passage of passages) {
    const narrator = names.get(passage.id)?.narrator;
    const entity = narrator ? entityOf.get(nameKey(narrator)) : undefined;
    if (entity !== undefined) named.set(passage.id, entity);
  }
  const byChapter = new Map<number, Set<number>>();
  for (const passage of passages) {
    const entity = named.get(passage.id);
    if (entity === undefined) continue;
    const set = byChapter.get(passage.chapter) ?? new Set<number>();
    set.add(entity);
    byChapter.set(passage.chapter, set);
  }
  const bookWide = new Set(named.values());
  const fill = new Map<string, FilledNarrator>();
  for (const passage of passages) {
    if (names.get(passage.id)?.narrator || !toldInFirstPerson(passage.text, lexicon)) continue;
    const chapter = byChapter.get(passage.chapter);
    const pick = chapter && chapter.size > 0 ? chapter : bookWide;
    if (pick.size !== 1) continue;
    const entity = [...pick][0];
    fill.set(passage.id, { name: nameOfCast.get(entity)!, names: namesOfCast.get(entity)!, entity });
  }
  return fill;
}

/** The tokens a side's names give: words of three letters or more, without titles and role words. */
export function nameTokens(names: readonly string[], lexicon: StoryLexicon = ENGLISH_STORY_LEXICON): Set<string> {
  const tokens = new Set<string>();
  for (const name of names) {
    for (const match of straight(name).matchAll(lexicon.nameToken)) {
      const word = match[0].toLowerCase().replace(/'s$/u, '');
      if (word.length >= 3 && !lexicon.tieStop.has(word)) tokens.add(word);
    }
  }
  return tokens;
}

function textWords(text: string): Set<string> {
  return new Set(
    (
      straight(text)
        .toLowerCase()
        .match(/[\p{L}\p{N}_']+/gu) ?? []
    ).map((word) => word.replace(/'s$/u, '')),
  );
}

/** The quote in the passage, matched word by word whatever the punctuation and case between; null when absent. */
export function findQuote(quote: string, passageText: string, lexicon: StoryLexicon = ENGLISH_STORY_LEXICON): [number, number] | null {
  const parts = splitWords(straight(quote))
    .map((word) => stripChars(word, lexicon.quoteEdgeChars))
    .filter(Boolean);
  if (parts.length < 2) return null;
  const match = new RegExp(parts.map(escapeRegExp).join(`[^\\p{L}\\p{N}_]+`), 'iu').exec(straight(passageText));
  return match ? [match.index, match.index + match[0].length] : null;
}

function withoutNames(quote: string, names: readonly string[]): string {
  let text = straight(quote);
  const unique = [...new Set(names.map(straight))].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  for (const name of unique) text = text.replace(new RegExp(`${WORD_EDGE}${escapeRegExp(name)}(?:'s)?${WORD_EDGE}`, 'giu'), ' ');
  return text;
}

function cleanName(value: unknown): string {
  const name = typeof value === 'string' ? value : value == null ? '' : String(value as string | number);
  return name
    .replace(/\s*\([^)]*\)/gu, '')
    .replace(new RegExp(`,\\s*also${WORD_EDGE}.*$`, 'u'), '')
    .trim();
}

/** Python's `str.rfind(sub, 0, end)` for one character. */
function lastBefore(text: string, char: string, end: number): number {
  return end <= 0 ? -1 : text.lastIndexOf(char, end - 1);
}

/**
 * The code checks on one passage's relations: a type on the list, both names in the passage's cast
 * and different, the quote really in the passage, and both sides named in the quote, in its
 * paragraph or the one before, or one there and the other within `TIE_WINDOW` characters before it.
 * In a first-person passage, "I" and "my" name its narrator. A family tie whose quote uses a kin
 * title needs a family word besides the names, or a possessive before the title.
 */
export function checkTies(
  relations: readonly unknown[],
  passage: Pick<StoryPassage, 'id' | 'text'>,
  cast: TiesCast,
  placement: Readonly<Record<string, number>>,
): StoryTiesResult {
  const text = passage.text;
  const lexicon = cast.lexicon ?? ENGLISH_STORY_LEXICON;
  const kept: StoryTie[] = [];
  const dropped: StoryDroppedTie[] = [];
  for (const item of relations) {
    const relation = item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    let a = cast.lookup.get(nameKey(cleanName(relation.a)));
    let b = cast.lookup.get(nameKey(cleanName(relation.b)));
    const type = (typeof relation.type === 'string' ? relation.type : relation.type == null ? '' : String(relation.type as string))
      .split(':')
      .at(-1)!
      .trim()
      .toLowerCase();
    const quote = typeof relation.quote === 'string' ? relation.quote : '';
    const span = findQuote(quote, text, lexicon);
    let reason: StoryTieDropReason | null = null;
    let evidence: StoryTie['evidence'] | null = null;
    if (!storyGuideTieType(type)) reason = 'type not on the list';
    else if (!a || !b) reason = 'name not in the cast';
    else if (a === b) reason = 'points at itself';
    else if (!span) reason = 'quote not in the passage';
    else {
      const quoteWords = textWords(text.slice(span[0], span[1]));
      const p0 = lastBefore(text, '\n', Math.max(0, lastBefore(text, '\n', span[0]))) + 1;
      const p1 = text.indexOf('\n', span[1]);
      const paragraphEnd = p1 >= 0 ? p1 : text.length;
      const paragraphWords = textWords(text.slice(p0, paragraphEnd));
      let ta = nameTokens(cast.namesOf.get(a)!, lexicon);
      let tb = nameTokens(cast.namesOf.get(b)!, lexicon);
      const me = cast.narrator && cast.namesOf.has(cast.narrator) ? nameTokens(cast.namesOf.get(cast.narrator)!, lexicon) : new Set<string>();
      if (me.size > 0 && overlaps(me, ta)) ta = new Set([...ta, ...lexicon.firstPersonWords]);
      if (me.size > 0 && overlaps(me, tb)) tb = new Set([...tb, ...lexicon.firstPersonWords]);
      const wideWords = textWords(text.slice(Math.max(0, span[0] - TIE_WINDOW), paragraphEnd));
      if (overlaps(ta, quoteWords) && overlaps(tb, quoteWords)) evidence = 'quote';
      else if (overlaps(ta, paragraphWords) && overlaps(tb, paragraphWords)) evidence = 'paragraph';
      else if ((overlaps(ta, paragraphWords) && overlaps(tb, wideWords)) || (overlaps(tb, paragraphWords) && overlaps(ta, wideWords)))
        evidence = 'nearby';
      else reason = 'a side is not named near the quote';
      const shown = straight(text.slice(span[0], span[1]));
      if (
        !reason &&
        storyGuideTieType(type)!.group === 'family' &&
        lexicon.kinTitle.test(shown) &&
        !lexicon.familyWords.test(withoutNames(text.slice(span[0], span[1]), [...cast.namesOf.get(a)!, ...cast.namesOf.get(b)!])) &&
        !lexicon.possessiveKin.test(shown)
      ) {
        reason = 'family only by a title';
      }
    }
    const elder = lexicon.elderTitle[type as StoryGuideTieType];
    if (
      !reason &&
      a &&
      b &&
      elder &&
      cast.namesOf.get(b)!.some((name) => elder.test(name)) &&
      !cast.namesOf.get(a)!.some((name) => elder.test(name))
    ) {
      [a, b] = [b, a];
    }
    if (reason || !a || !b || !span || !evidence) {
      dropped.push({ a: a ?? cleanName(relation.a), type, b: b ?? cleanName(relation.b), quote, reason: reason ?? 'name not in the cast' });
      continue;
    }
    const at: PassageSpan = { passage: passage.id, offset: span[0], text: text.slice(span[0], span[1]) };
    kept.push({
      a,
      type: type as StoryGuideTieType,
      b,
      aEntity: entityOf(a, cast, placement),
      bEntity: entityOf(b, cast, placement),
      quote: at,
      evidence,
    });
  }
  return { passage: passage.id, narrator: cast.narrator, kept, dropped };
}

function entityOf(name: string, cast: TiesCast, placement: Readonly<Record<string, number>>): number {
  return placement[nameKey(name)] ?? cast.filled!.entity;
}

function overlaps(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const item of a) if (b.has(item)) return true;
  return false;
}

/** A tie placed on the cast: `a` and `b` are the keys a payload names. */
export interface PlacedTie {
  a: string;
  type: StoryGuideTieType;
  b: string;
  quote: PassageSpan;
  /** Reading order of the quote's passage. */
  order: number;
}

export interface ShippedTie {
  a: string;
  type: StoryGuideTieType;
  b: string;
  /** The first quote, then every other in reading order. */
  quotes: PassageSpan[];
  count: number;
}

export type TieShipDropReason = 'reversed family link' | 'kind' | 'vague duplicate of a family tie';

const DIRECTED_FAMILY: ReadonlySet<string> = new Set(['parent_of', 'grandparent_of', 'aunt_or_uncle_of']);
const SPECIFIC_FAMILY: ReadonlySet<string> = new Set([...DIRECTED_FAMILY, 'sibling_of', 'spouse_of', 'betrothed_to', 'cousin_of']);

/**
 * The book's ties from every passage's, for assemble: one per (a, type, b), the sides of a symmetric
 * type in key order, with its quotes and count. Dropped: a directed family tie also found the other
 * way at least as often, sides of kinds the type does not allow, and a `relative_of` beside a more
 * specific family tie between the same two.
 */
export function shipTies(
  ties: readonly PlacedTie[],
  kindOf: (key: string) => StoryGuideEntityKind | undefined,
): { kept: ShippedTie[]; dropped: (ShippedTie & { reason: TieShipDropReason })[] } {
  const byKey = new Map<string, ShippedTie>();
  for (const tie of [...ties].sort((x, y) => x.order - y.order || x.quote.offset - y.quote.offset)) {
    let { a, b } = tie;
    if (a === b) continue;
    if (storyGuideTieType(tie.type)?.symmetric && a > b) [a, b] = [b, a];
    const key = `${a}|${tie.type}|${b}`;
    const found = byKey.get(key);
    if (found) {
      found.quotes.push(tie.quote);
      found.count++;
    } else byKey.set(key, { a, type: tie.type, b, quotes: [tie.quote], count: 1 });
  }
  const has = (a: string, type: string, b: string) => byKey.get(`${a}|${type}|${b}`);
  const kept: ShippedTie[] = [];
  const dropped: (ShippedTie & { reason: TieShipDropReason })[] = [];
  for (const tie of byKey.values()) {
    const info = storyGuideTieType(tie.type)!;
    const reverse = DIRECTED_FAMILY.has(tie.type) ? has(tie.b, tie.type, tie.a) : undefined;
    const kindA = kindOf(tie.a);
    const kindB = kindOf(tie.b);
    let reason: TieShipDropReason | null = null;
    if (reverse && reverse.count >= tie.count) reason = 'reversed family link';
    else if (!kindA || !kindB || !info.from.includes(kindA) || !info.to.includes(kindB)) reason = 'kind';
    else if (tie.type === 'relative_of' && [...SPECIFIC_FAMILY].some((type) => has(tie.a, type, tie.b) || has(tie.b, type, tie.a))) {
      reason = 'vague duplicate of a family tie';
    }
    if (reason) dropped.push({ ...tie, reason });
    else kept.push(tie);
  }
  return { kept, dropped };
}

/** `ties`: each passage's typed ties with quotes, on the fast slot, passages in parallel. */
export function tiesAiStep(): AiStep<StoryGuideSubject> {
  // Every unit reads the same fill; work it out once per review result.
  const fills = new WeakMap<object, Map<string, FilledNarrator>>();
  const prepare = (ctx: Parameters<AiStep<StoryGuideSubject>['fingerprint']>[0], id: string) => {
    const text = textResult(ctx);
    const passage = passageById(text, id);
    const names = namesResults(ctx);
    const merge = mergeResult(ctx);
    const review = reviewResult(ctx);
    let fill = fills.get(review);
    const lexicon = storyLexicon(ctx.subject.text.language);
    if (!fill) fills.set(review, (fill = narratorFill(text.passages, names, merge, review, lexicon)));
    const own = names.get(id) ?? { passage: id, chapter: passage.chapter, part: passage.part, narrator: null, entries: [] };
    return { passage, cast: tiesCast(own, passage.text, fill.get(id), lexicon), placement: merge.placement[id] ?? {} };
  };
  return {
    id: 'ties',
    version: 2,
    slot: 'fast',
    dependsOn: ['text', 'names', 'merge', 'review'],
    units: (ctx) => passagesWithCast(textResult(ctx), namesResults(ctx)).map((passage) => ({ id: passage.id })),
    fingerprint: (ctx, unit) => {
      const { passage, cast } = prepare(ctx, unit.id);
      const request = tiesRequest(passage.text, cast);
      return hashOf('ties', request.system, request.user);
    },
    async run(ctx, unit) {
      const { passage, cast, placement } = prepare(ctx, unit.id);
      const answers = await splitWhileTooLong(passage.text, (part) => askForJson(ctx, tiesRequest(part, cast), readTiesAnswer));
      return checkTies(answers.flat(), passage, cast, placement);
    },
  };
}

/** Passages whose names step finished; one left out has no cast to tie. */
function passagesWithCast(text: TextStepResult, names: ReadonlyMap<string, StoryNamesResult>): StoryPassage[] {
  return text.passages.filter((passage) => names.has(passage.id));
}
