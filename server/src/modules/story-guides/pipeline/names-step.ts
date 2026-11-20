import { STORY_GUIDE_ENTITY_KINDS, type StoryGuideEntityKind } from '@bookorbit/types';

import type { AiStep, AiStepRequest } from '../../ai-jobs/ai-feature';
import { hashOf } from '../../ai-jobs/ai-fingerprint';
import { splitWhileTooLong } from '../../ai-jobs/ai-split';
import { askForJson } from './json-reply';
import { locateName, splitWords, startsUpper, stripChars } from './name-text';
import { ENGLISH_STORY_LEXICON, storyLexicon, type StoryLexicon } from './story-lexicon';
import type { StoryGuideSubject } from './story-guide-subject';
import { passageById, textResult } from './step-context';
import type { PassageSpan, StoryNameEntry, StoryNamesResult } from './story-guide.types';
import type { StoryPassage } from './text-step';

/**
 * The reference pipeline's v8 prompt, plus the narrator and the rule to describe from this chapter only,
 * institutions as groups and a narrator's names in one entry. Any change to it bumps the step's version.
 */
export const NAMES_SYSTEM =
  'You build the cast list for one chapter of a novel: every proper name in it, grouped by who or what it refers to.\n\n' +
  'Work in two steps.\n' +
  '1. "found": go through the chapter from start to end and write down every proper name it uses, exactly as printed, each spelling once: ' +
  'people, creatures, families, groups, companies, places (including towns and countries mentioned only in passing), events, named objects ' +
  'and named ideas. A name mentioned only once still counts. A name used only as an example, a comparison or a figure of speech is not a name ' +
  "in the story. Leave out the book's title, the author, chapter headings, days of the week, months, and words capitalised only because they " +
  'start a sentence.\n' +
  '2. "entries": group the names from step 1, one entry per person or thing. Put its fullest name in "name" and every other name from step 1 ' +
  'that refers to the same one in "aliases". Rules for aliases:\n' +
  '- An alias is a proper name from step 1, written with a capital. Never a description, a pronoun or a role such as "the boy", "the cat", ' +
  '"sir" or "his aunt".\n' +
  '- Each name from step 1 goes in exactly one entry. Never give the same alias to two entries.\n' +
  '- A surname with Mr., Mrs., Miss or Professor belongs to the person with that surname whom the chapter means. A bare surname shared by a ' +
  'family goes to the family member the chapter most often means by it.\n' +
  '- Only join two names when the chapter shows they are the same one. Relatives are different people.\n' +
  '- A title, nickname or epithet the chapter uses for a named person or creature is an alias of that one, not a separate entry. Two creatures ' +
  'of the same colour or kind are different ones unless the chapter shows they are the same.\n\n' +
  'For each entry give who or what it is in this chapter in at most eight words, and its kind:\n' +
  'character: one person, god, animal, creature or machine that acts in the story, or a family named as one. Never a bank, school, shop, ' +
  'company or other institution, and never a place.\n' +
  'group: a people, nation, tribe, order, army, team or organisation, including an institution such as a bank, school, ministry or company.\n' +
  'place: a world, country, city, town, street, building, room, ship or landmark.\n' +
  'event: a festival, holiday, game, contest, war, ceremony or time.\n' +
  'object: a weapon, tool, vehicle, garment, food or other thing.\n' +
  'idea: a language, species, title, rank, school subject, power or other idea.\n\n' +
  'After the chapter comes a checklist of capitalised words and phrases found in it. Use it so that no name is missed: every checklist item ' +
  'that is a proper name must be in "found". Many items are not names (sentence openers, headings, the title or author); leave those out. ' +
  "Never add a name the chapter does not use. The book's title and its author are given before the chapter: neither is ever an entry, and " +
  'neither is a day, a month or a person the narrator only addresses.\n\n' +
  'Also give "narrator": the name, exactly as in your entries, of the character who tells this chapter as "I", or null when it is told in ' +
  'the third person or the chapter does not show who "I" is. The narrator is one entry: when the chapter calls them by a full name, a ' +
  'nickname and a pet name, put every one of those names in that entry.\n\n' +
  'Describe each entry only from what this chapter states. Never use what you know about the book or its series, and never give a role, ' +
  'rank, bond or fact the chapter does not state: someone who is a child or a candidate here is described as that, not as what they become ' +
  'later.';

export const NAMES_SHAPE =
  '\n\nAnswer with JSON only, in this shape: {"narrator": "... or null", "found": ["..."], "entries": [{"name": "...", "aliases": ["..."], ' +
  '"what": "...", "kind": "character, group, place, event, object or idea"}]}';

/** Room for the reply and the model's reasoning; the client doubles it once when a reply is cut short. */
export const NAMES_MAX_OUTPUT_TOKENS = 8000;

/** What the names step needs to know about the book. */
export interface NamesBook {
  title: string;
  authors: readonly string[];
}

/** An entry as the model wrote it, with its fields made strings. */
export interface RawNameEntry {
  name: string;
  aliases: string[];
  kind: string;
  what: string;
}

export interface NamesAnswer {
  narrator: string | null;
  entries: RawNameEntry[];
}

/**
 * The checklist sent with a passage: capitalised runs, kept when one appears mid-sentence, or twice
 * and not as an everyday word. A run that opens a sentence with an everyday word ("The Strand") also
 * lists its tail ("Strand").
 */
export function nameCandidates(text: string, lexicon: StoryLexicon = ENGLISH_STORY_LEXICON): string[] {
  const runs = new Map<string, [number, number]>();
  for (const paragraph of text.split('\n\n')) {
    for (const match of paragraph.matchAll(lexicon.run)) {
      const run = match[0].replace(/[’']s?$/u, '').trim();
      if (lexicon.pronounRuns.has(run)) continue;
      const start = lexicon.sentenceStart.test(paragraph.slice(0, match.index));
      let seen = runs.get(run);
      if (!seen) runs.set(run, (seen = [0, 0]));
      seen[0] += 1;
      seen[1] += start ? 0 : 1;
    }
  }
  const lower = new Set(text.match(lexicon.lowerWord) ?? []);
  for (const [run, seen] of [...runs.entries()]) {
    const [count, mid] = seen;
    const words = splitWords(run);
    if (!mid && words.length >= 2 && lower.has(words[0].toLowerCase())) {
      const tail = words.slice(1).join(' ');
      let tailSeen = runs.get(tail);
      if (!tailSeen) runs.set(tail, (tailSeen = [0, 0]));
      tailSeen[0] += count;
      tailSeen[1] += words.length >= 3 ? 1 : 0;
    }
  }
  const keep: string[] = [];
  for (const [run, [count, mid]] of runs) {
    const first = splitWords(run)[0].toLowerCase().replace(/\.+$/u, '');
    if (mid || (count >= 2 && !lower.has(first))) keep.push(run);
  }
  return keep;
}

/**
 * Whether the narration, outside dialogue, is told as "I": first-person pronouns at least 30% of its
 * personal pronouns. The model names a narrator in third-person books too, and a narrator lets "I"
 * stand for a name in the ties check.
 */
export function toldInFirstPerson(text: string, lexicon: StoryLexicon = ENGLISH_STORY_LEXICON): boolean {
  const narration = text.replace(lexicon.dialogue, ' ');
  const first = narration.match(lexicon.firstPerson)?.length ?? 0;
  const third = narration.match(lexicon.thirdPerson)?.length ?? 0;
  return first >= 3 && first >= 0.3 * (first + third);
}

/** The request for one passage, or one piece of it after a reply was cut short. */
export function namesRequest(book: NamesBook, text: string, lexicon: StoryLexicon = ENGLISH_STORY_LEXICON): AiStepRequest {
  const by = book.authors.filter((author) => author.trim()).join(' and ');
  const user =
    `Book: ${book.title}${by ? `, by ${by}` : ''}\n\nChapter:\n` + text + '\n\nChecklist:\n' + nameCandidates(text, lexicon).join('\n') + NAMES_SHAPE;
  return { system: NAMES_SYSTEM, user, maxOutputTokens: NAMES_MAX_OUTPUT_TOKENS, effort: 'medium' };
}

/** The answer's narrator and entries, or null when it has no list of entries. */
export function readNamesAnswer(answer: Record<string, unknown>): NamesAnswer | null {
  if (!Array.isArray(answer.entries)) return null;
  const entries = answer.entries.flatMap((item): RawNameEntry[] => {
    if (item === null || typeof item !== 'object') return [];
    const entry = item as Record<string, unknown>;
    return [
      {
        name: text(entry.name),
        aliases: Array.isArray(entry.aliases) ? entry.aliases.filter((alias): alias is string => typeof alias === 'string') : [],
        kind: text(entry.kind),
        what: text(entry.what),
      },
    ];
  });
  return { narrator: typeof answer.narrator === 'string' ? answer.narrator : null, entries };
}

/**
 * The code checks on a passage's answer: aliases the passage never writes, descriptions, role words
 * and Mr./Mrs. forms of another surname dropped; an entry that is an alias of an earlier one folded
 * into it; an alias two entries claim given to neither.
 */
export function validateEntries(
  entries: readonly RawNameEntry[],
  passageText: string,
  lexicon: StoryLexicon = ENGLISH_STORY_LEXICON,
): RawNameEntry[] {
  const inText = passageText.replace(/’/g, "'");
  const present = (name: string) => inText.includes(name.replace(/’/g, "'"));
  const checked: RawNameEntry[] = [];
  for (const source of entries) {
    const entry = { ...source, aliases: [...source.aliases] };
    const kept: string[] = [];
    for (const alias of entry.aliases) {
      const parts = splitWords(alias);
      if (!startsUpper(alias) || !present(alias)) continue;
      if (parts.every((word) => lexicon.familyAndRoleWords.has(stripChars(word.toLowerCase(), ".’'")))) continue;
      if (parts.length === 2 && lexicon.honorifics.has(stripChars(parts[0].toLowerCase(), '.'))) {
        const nameWords = new Set(splitWords(entry.name).map((word) => stripChars(word.toLowerCase(), '.')));
        const others = new Set(
          entry.aliases.filter((other) => other !== alias).flatMap((other) => splitWords(other).map((word) => stripChars(word.toLowerCase(), '.'))),
        );
        const surname = parts[1].toLowerCase();
        if (!nameWords.has(surname) && !others.has(surname)) continue;
      }
      kept.push(alias);
    }
    entry.aliases = kept;
    if (!present(entry.name)) {
      if (kept.length === 0) continue;
      entry.name = longest(kept);
      entry.aliases = kept.filter((alias) => alias !== entry.name);
    }
    if (entry.name) checked.push(entry);
  }

  const key = (name: string) => name.replace(/’/g, "'").replace(/\./g, '').toLowerCase().trim();
  const merged: RawNameEntry[] = [];
  for (const entry of checked) {
    const home = merged.find((other) => other.aliases.some((alias) => key(alias) === key(entry.name)));
    if (home) {
      const known = new Set(home.aliases.map(key));
      home.aliases.push(...entry.aliases.filter((alias) => !known.has(key(alias))));
    } else merged.push(entry);
  }
  const claims = new Map<string, number>();
  for (const entry of merged) for (const alias of new Set(entry.aliases.map(key))) claims.set(alias, (claims.get(alias) ?? 0) + 1);
  for (const entry of merged) entry.aliases = entry.aliases.filter((alias) => claims.get(key(alias)) === 1 && key(alias) !== key(entry.name));
  return merged;
}

const WORDS = /[\p{L}\p{N}_']+/gu;

/** Lowercase words, straight apostrophes, single spaces: how the book's title is compared. */
export function plainWords(text: string): string {
  return (text.replace(/’/g, "'").toLowerCase().match(WORDS) ?? []).join(' ');
}

/** The book's author and its whole title are never entries, nor are days and months or a name the model calls none. */
export function bookFilter(entries: readonly RawNameEntry[], book: NamesBook, lexicon: StoryLexicon = ENGLISH_STORY_LEXICON): RawNameEntry[] {
  const authorWords = new Set(['by', ...book.authors.flatMap((author) => plainWords(author).split(' ').filter(Boolean))]);
  const title = plainWords(book.title);
  return entries.filter((entry) => {
    if (entry.kind === 'none') return false;
    const words = new Set(entry.name.replace(/’/g, "'").toLowerCase().match(WORDS) ?? []);
    if (words.size > 0 && [...words].every((word) => authorWords.has(word))) return false;
    if (words.size > 0 && [...words].every((word) => lexicon.connectives.has(word)) && entry.kind !== 'character') return false;
    if (words.size > 0 && [...words].every((word) => lexicon.calendar.has(word))) return false;
    return !title || plainWords(entry.name) !== title;
  });
}

/** An entry named only by a family or role word ("Mom") takes its real alias as its name, or is dropped. */
export function dropRoleNames(entries: readonly RawNameEntry[], lexicon: StoryLexicon = ENGLISH_STORY_LEXICON): RawNameEntry[] {
  const roleOnly = (name: string) => splitWords(name).every((word) => lexicon.roleOnly.has(stripChars(word, ".’'").toLowerCase()));
  return entries.flatMap((entry) => {
    if (!roleOnly(entry.name)) return [entry];
    const real = entry.aliases.filter((alias) => !roleOnly(alias));
    if (real.length === 0) return [];
    const name = longest(real);
    return [{ ...entry, name, aliases: real.filter((alias) => alias !== name) }];
  });
}

const KINDS: ReadonlySet<string> = new Set(STORY_GUIDE_ENTITY_KINDS);

/** One of the six kinds; an answer outside them is filed as an idea, which the apps list under Terms. */
export function entryKind(kind: string): StoryGuideEntityKind {
  const plain = kind.trim().toLowerCase();
  return KINDS.has(plain) ? (plain as StoryGuideEntityKind) : 'idea';
}

/** Every code check on one passage's answer, and where each kept name first occurs in it. */
export function checkNames(
  answer: NamesAnswer,
  passage: StoryPassage,
  book: NamesBook,
  lexicon: StoryLexicon = ENGLISH_STORY_LEXICON,
): StoryNamesResult {
  const kept = dropRoleNames(bookFilter(validateEntries(answer.entries, passage.text, lexicon), book, lexicon), lexicon);
  const entries = kept.flatMap((entry): StoryNameEntry[] => {
    const at: Record<string, PassageSpan> = {};
    for (const name of [entry.name, ...entry.aliases]) {
      const found = locateName(passage.text, name);
      if (found) at[name] = { passage: passage.id, offset: found.offset, text: found.text };
    }
    if (!at[entry.name]) return [];
    return [{ name: entry.name, aliases: entry.aliases.filter((alias) => at[alias]), kind: entryKind(entry.kind), what: entry.what, at }];
  });
  const byName = new Map<string, string>();
  for (const entry of entries) for (const name of [entry.name, ...entry.aliases]) byName.set(plainWords(name), entry.name);
  const narrator = toldInFirstPerson(passage.text, lexicon) ? (byName.get(plainWords(answer.narrator ?? '')) ?? null) : null;
  return { passage: passage.id, chapter: passage.chapter, part: passage.part, narrator, entries };
}

function bookOf(subject: StoryGuideSubject): NamesBook {
  return { title: subject.title, authors: subject.authors };
}

/** `names`: each passage's cast, on the fast slot, passages in parallel. */
export function namesAiStep(): AiStep<StoryGuideSubject> {
  return {
    id: 'names',
    version: 2,
    slot: 'fast',
    dependsOn: ['text'],
    units: (ctx) => textResult(ctx).passages.map((passage) => ({ id: passage.id })),
    fingerprint: (ctx, unit) => {
      const request = namesRequest(bookOf(ctx.subject), passageById(textResult(ctx), unit.id).text, storyLexicon(ctx.subject.text.language));
      return hashOf('names', request.system, request.user);
    },
    async run(ctx, unit) {
      const book = bookOf(ctx.subject);
      const lexicon = storyLexicon(ctx.subject.text.language);
      const passage = passageById(textResult(ctx), unit.id);
      const answers = await splitWhileTooLong(passage.text, (part) => askForJson(ctx, namesRequest(book, part, lexicon), readNamesAnswer));
      const combined: NamesAnswer = {
        narrator: answers.find((answer) => answer.narrator)?.narrator ?? null,
        entries: answers.flatMap((answer) => answer.entries),
      };
      return checkNames(combined, passage, book, lexicon);
    },
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function longest(names: readonly string[]): string {
  return names.reduce((best, name) => (name.length > best.length ? name : best));
}
