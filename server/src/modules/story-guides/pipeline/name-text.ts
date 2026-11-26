import type { StoryLexicon } from './story-lexicon';

/**
 * Text helpers the story guide steps share. They port the reference pipeline's Python: `\w` there is
 * Unicode-aware, so word characters here are letters, digits and underscore in any script, and its
 * word boundaries are built from them.
 */

export const WORD_CHAR = '[\\p{L}\\p{N}_]';
/** Python's `\b`, which JavaScript's `\b` only matches for ASCII words. */
export const WORD_EDGE = `(?:(?<=${WORD_CHAR})(?!${WORD_CHAR})|(?<!${WORD_CHAR})(?=${WORD_CHAR}))`;

/** Words that make a name a title or honorific: "Mr", "Lady", "House", "the". */
export const TITLES: ReadonlySet<string> = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'dr',
  'professor',
  'madam',
  'sir',
  'dame',
  'lady',
  'lord',
  'aunt',
  'aunty',
  'uncle',
  'king',
  'queen',
  'prince',
  'princess',
  'duke',
  'duchess',
  'baron',
  'baroness',
  'count',
  'countess',
  'earl',
  'house',
  'general',
  'colonel',
  'captain',
  'commander',
  'master',
  'mistress',
  'herald',
  'cousin',
  'father',
  'mother',
  'brother',
  'sister',
  'the',
  'young',
  'old',
  'great',
]);

/** Role words that come before a name without being part of it ("Detective Vick", "Inspector Gregson"). */
export const NAME_PREFIX_WORDS: ReadonlySet<string> = new Set([
  'detective',
  'doctor',
  'reverend',
  'officer',
  'nurse',
  'signor',
  'signora',
  'don',
  'donna',
  'maestro',
  'maestra',
  'president',
  'mayor',
  'senator',
  'judge',
  'chief',
  'sergeant',
  'inspector',
  'head',
  'emperor',
  'padishah',
  'our',
  'sublime',
  'beast',
  'saint',
  'st',
  'rev',
  'sheriff',
  'deputy',
  'agent',
  'coach',
  'lil',
  'little',
  'big',
]);

/** Words that, alone, address someone rather than name them ("Ladyship", "the Watch"). */
export const HONORIFIC_ONLY: ReadonlySet<string> = new Set([
  'ladyship',
  'lordship',
  'majesty',
  'highness',
  'grace',
  'his',
  'her',
  'your',
  'their',
  'sire',
  'milady',
  'milord',
  'guildmaster',
  'guild',
  'watch',
  'guard',
  'guards',
  'fair',
  'gift',
]);

/** Titles the names step reads before a surname ("Mr. Drebber"). */
export const HONORIFICS: ReadonlySet<string> = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'dr',
  'professor',
  'madam',
  'sir',
  'lady',
  'lord',
  'aunt',
  'uncle',
]);

/** A name made only of these is a role or family word, not a name ("Father", "Da", "Herald"). */
export const FAMILY_AND_ROLE_WORDS: ReadonlySet<string> = new Set([
  'father',
  'mother',
  'da',
  'dad',
  'pa',
  'ma',
  'mom',
  'mum',
  'papa',
  'mama',
  'sir',
  'madam',
  'lord',
  'lady',
  'king',
  'queen',
  'prince',
  'princess',
  'herald',
  'professor',
  'general',
  'colonel',
  'doctor',
  'captain',
  'master',
  'aunt',
  'uncle',
  'grandma',
  'grandpa',
  'son',
  'daughter',
  'brother',
  'sister',
]);

const OWN_WORDS_EN = { titles: TITLES, namePrefixWords: NAME_PREFIX_WORDS };

/** Python's `str.split()`: whitespace runs, no empty pieces. */
export function splitWords(text: string): string[] {
  return text.split(/\s+/u).filter((word) => word.length > 0);
}

/** Python's `str.strip(chars)`. */
export function stripChars(text: string, chars: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start])) start++;
  while (end > start && chars.includes(text[end - 1])) end--;
  return text.slice(start, end);
}

/** Python's `s[:1].isupper()`. */
export function startsUpper(text: string): boolean {
  const first = text.slice(0, 1);
  return first.length > 0 && first !== first.toLowerCase() && first === first.toUpperCase();
}

/** Curly quotes to straight ones, one character for one, so offsets stay put. */
export function straight(text: string): string {
  return text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
}

/** How names are compared: lowercase, no full stops, straight apostrophes, single spaces. */
export function nameKey(name: string): string {
  return splitWords(name.replace(/’/g, "'").replace(/\./g, '').toLowerCase()).join(' ');
}

/** A name's own words, without titles and role words ("Inspector Gregson" is "gregson"). */
export function ownWords(
  name: string,
  lexicon: Pick<StoryLexicon, 'titles' | 'namePrefixWords'> & Partial<Pick<StoryLexicon, 'nameFold'>> = OWN_WORDS_EN,
): string[] {
  const words = nameKey(name)
    .split(' ')
    .filter((word) => word.length > 0 && !lexicon.titles.has(word) && !lexicon.namePrefixWords.has(word));
  return lexicon.nameFold ? words.map(lexicon.nameFold) : words;
}

function variants(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a) || (a.length >= 4 && a.slice(0, 4) === b.slice(0, 4));
}

/**
 * Two names' own words name two people: neither holds the other, and the first names differ.
 * Variants of one first name ("Pat" and "Patrick") and a middle name used as the first count as one.
 * Where a book writes names in either order ("Boka János", "Sherlock Holmes"), no word is known to be
 * the first name: the words the two do not share must then be variants of one name.
 */
export function namesConflict(a: readonly string[], b: readonly string[], eitherOrder = false): boolean {
  if (a.every((word) => b.includes(word)) || b.every((word) => a.includes(word))) return false;
  if (eitherOrder) {
    const onlyB = b.filter((word) => !a.includes(word));
    return !a.some((word) => !b.includes(word) && onlyB.some((other) => variants(word, other)));
  }
  const sameFirst = variants(a[0], b[0]) || b.includes(a[0]) || a.includes(b[0]);
  return !sameFirst;
}

/** The words a person can be called by alone: the first name, or either end of a name written in either order. */
export function callingWords(words: readonly string[], eitherOrder: boolean): string[] {
  return eitherOrder ? [...new Set([words[0], words[words.length - 1]])] : [words[0]];
}

/** What sets a person apart from others called by `calledBy`: the surname, or every other word where names come in either order. */
export function familyPart(words: readonly string[], calledBy: string, eitherOrder: boolean): string | undefined {
  return eitherOrder ? words.filter((word) => word !== calledBy).join(' ') : words.at(-1);
}

const NUMBER_WORDS =
  'zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred';
export const NUMBER_ONLY = new RegExp(`^(?:\\d+|(?:${NUMBER_WORDS})(?:[- ](?:${NUMBER_WORDS}))*)$`, 'iu');

/** A name made only of numbers ("One", "12") would mark every "one" in the text. */
export function isNumberOnly(name: string, numberOnly: RegExp = NUMBER_ONLY): boolean {
  return numberOnly.test(stripChars(name, " .,'’"));
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

type NameInflection = StoryLexicon['nameInflection'];

/**
 * A name as a whole word, apostrophes folded, with the case endings it can take in a language
 * whose names inflect.
 */
export function namePattern(name: string, inflection: NameInflection = null, flags = 'gu'): RegExp {
  const escaped = escapeRegExp(name.replace(/’/g, "'"));
  return new RegExp(`(?<!${WORD_CHAR})${inflection ? inflection(escaped) : escaped}(?!${WORD_CHAR})`, flags);
}

/**
 * Where a name first occurs in a text, comparing apostrophes as one: the first whole-word
 * occurrence, else the first anywhere, else, where names inflect, the first with an ending that
 * changes the name itself ("Boká" in "Bokát"). Null when the text does not hold it.
 */
export function locateName(text: string, name: string, inflection: NameInflection = null): { offset: number; text: string } | null {
  const target = name.replace(/’/g, "'");
  if (!target) return null;
  const folded = text.replace(/’/g, "'");
  const bounded = namePattern(target, null, 'u').exec(folded);
  let offset = bounded ? bounded.index : folded.indexOf(target);
  if (offset < 0 && inflection) offset = namePattern(target, inflection, 'u').exec(folded)?.index ?? -1;
  return offset < 0 ? null : { offset, text: text.slice(offset, offset + target.length) };
}

/** The most common value, ties going to the one seen first. */
export function mostCommon<T>(values: readonly T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | undefined;
  let top = 0;
  for (const [value, count] of counts) {
    if (count > top) {
      best = value;
      top = count;
    }
  }
  return best;
}
