/**
 * Decides which library books the text on a photographed cover or spine names. Pure, so the
 * scoring is tested without a database: the repository finds candidates through the trigram
 * indexes, and this pairs the recognised lines with each candidate's title and authors.
 *
 * A cover is short, loud text in no fixed order: a tagline, the title broken over several lines,
 * the author's name, sometimes a quote naming another book. So a title is compared with every run
 * of up to three adjacent lines, an author with every single line, and a title alone only counts
 * when it is long enough not to be a common word.
 *
 * A spine is shorter still: the title, often only the author's surname, a publisher's imprint, and
 * often all of it read as one line. So a title is also compared with each run of lines once that
 * book's own author is taken out of it.
 */

export interface VisualMatchCandidate {
  bookId: number;
  title: string | null;
  subtitle: string | null;
  authors: string[];
}

export interface VisualMatchScore {
  bookId: number;
  /** 0 to 1. */
  score: number;
  titleScore: number;
  authorScore: number;
  /** Letters in the main title, to prefer the more specific of two equally good titles. */
  titleLength: number;
}

/** A run of adjacent lines joined into one phrase. */
export interface CoverPhrase {
  text: string;
  /** How many lines it joins, 1 to 3. */
  span: number;
}

/** Weakest title likeness that can name a book at all. */
const MIN_TITLE_SCORE = 0.5;
/** An author agrees with the photo from this score up. */
const AUTHOR_CONFIRMED = 0.7;
/** Weakest overall score worth showing. */
const MIN_MATCH_SCORE = 0.6;
/** A result this far below the best is noise beside it. */
const RESULT_SPREAD = 0.2;
/** Longest run of lines a title is assumed to span. */
const MAX_PHRASE_SPAN = 3;

/**
 * Lowercase, accents and punctuation gone, `&` spelled out, whitespace collapsed. Apostrophes join
 * rather than split, so "Ender's" and "Enders" compare equal.
 */
export function normalizeCoverText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’‘`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Words on a cover that point at a different book: "Author of The Name of the Wind", "The sequel
 * to ...". The line carrying them is dropped, and so is the next one when the phrase ends the line,
 * because the named title usually sits on its own line beneath it.
 */
const REFERENCE_MARKER = /\b(?:author|authors|creator|writer)s? of\b|\bsequel to\b|\bfollow up to\b|\bpraise for\b|\bbestselling\b|\bbestseller\b/;
const REFERENCE_AT_END = /\b(?:of|to|for)$/;

/** Normalised lines worth comparing, in reading order, with a leading "by" taken off. */
export function coverLines(rawLines: readonly string[]): string[] {
  const lines: string[] = [];
  let skipNext = false;
  for (const raw of rawLines) {
    const line = normalizeCoverText(raw).replace(/^by /, '');
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (REFERENCE_MARKER.test(line)) {
      skipNext = REFERENCE_AT_END.test(line);
      continue;
    }
    const letters = line.replace(/[^\p{L}]/gu, '');
    if (letters.length < 2) continue;
    if (!lines.includes(line)) lines.push(line);
  }
  return lines;
}

/** Every run of one to `maxSpan` adjacent lines. */
export function coverPhrases(lines: readonly string[], maxSpan = MAX_PHRASE_SPAN): CoverPhrase[] {
  const phrases: CoverPhrase[] = [];
  const seen = new Set<string>();
  for (let start = 0; start < lines.length; start += 1) {
    for (let span = 1; span <= maxSpan && start + span <= lines.length; span += 1) {
      const text = lines.slice(start, start + span).join(' ');
      if (seen.has(text)) continue;
      seen.add(text);
      phrases.push({ text, span });
    }
  }
  return phrases;
}

function trigrams(text: string): Set<string> {
  const result = new Set<string>();
  for (const word of text.split(' ')) {
    if (!word) continue;
    const chars = Array.from(`  ${word} `);
    for (let index = 0; index + 3 <= chars.length; index += 1) {
      result.add(chars[index] + chars[index + 1] + chars[index + 2]);
    }
  }
  return result;
}

/** Shared trigrams over all trigrams, the way `pg_trgm`'s `similarity` counts them. */
export function trigramSimilarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function tokens(text: string): string[] {
  return text.split(' ').filter(Boolean);
}

/** A title of one short word ("It", "Emma", "Dune") names too many things to stand alone. */
export function isShortTitle(normalizedTitle: string): boolean {
  const words = tokens(normalizedTitle);
  return words.length <= 1 && normalizedTitle.length <= 5;
}

/** Small words a misread may lose without changing which title is meant. */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'to',
  'in',
  'on',
  'for',
  'at',
  'by',
  'or',
  'with',
  'from',
  'de',
  'la',
  'le',
  'les',
  'el',
  'der',
  'die',
  'das',
]);

/** Digits OCR reads in place of letters, undone in words that mix the two ("PR0JECT"). */
const DIGIT_LOOKALIKES: Record<string, string> = { '0': 'o', '1': 'i', '5': 's', '8': 'b' };

function foldLookalikes(word: string): string {
  if (!/\p{L}/u.test(word) || !/\d/.test(word)) return word;
  return word.replace(/[0158]/g, (digit) => DIGIT_LOOKALIKES[digit] ?? digit);
}

/** 1 minus the edit distance over the longer word's length. */
export function wordSimilarity(left: string, right: string): number {
  const a = Array.from(foldLookalikes(left));
  const b = Array.from(foldLookalikes(right));
  if (a.length === 0 || b.length === 0) return 0;
  if (a.join('') === b.join('')) return 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

/** A word counts as read from this likeness up: one wrong letter in four. */
const WORD_READ = 0.75;

interface WordAgreement {
  /** Share of `part`, weighted by word length, found among `whole`'s words. */
  coverage: number;
  /** Every word of `part` that is not a small word was found. */
  complete: boolean;
}

function wordAgreement(part: readonly string[], whole: readonly string[]): WordAgreement {
  let found = 0;
  let total = 0;
  let complete = true;
  for (const word of part) {
    let best = 0;
    for (const other of whole) {
      best = Math.max(best, wordSimilarity(word, other));
      if (best === 1) break;
    }
    total += word.length;
    if (best >= WORD_READ) found += best * word.length;
    else if (!STOP_WORDS.has(word)) complete = false;
  }
  return { coverage: total === 0 ? 0 : found / total, complete };
}

/** A note in brackets closing a stored title, which a cover or spine leaves off: "(Heron Harbor Book 2)". */
const TRAILING_NOTE = /\s*[([][^()[\]]*[)\]]\s*$/;

/**
 * The forms a cover may print: the main title, the full title, and the title with its subtitle.
 * The main title without a closing note in brackets is one more, unless that leaves a short title,
 * which must keep needing its author.
 */
function titleForms(candidate: VisualMatchCandidate): string[] {
  const title = candidate.title ?? '';
  const main = title.split(/\s*[:\u2014\u2013]\s+|\s+-\s+/)[0] ?? title;
  const bare = normalizeCoverText(main.replace(TRAILING_NOTE, ''));
  const forms = [main, title, candidate.subtitle ? `${title} ${candidate.subtitle}` : ''].map(normalizeCoverText).filter(Boolean);
  if (bare && !isShortTitle(bare)) forms.push(bare);
  return [...new Set(forms)];
}

/**
 * How well one run of lines reads as one form of a title. Trigrams catch a title read whole; words
 * catch one with a misread letter or two, as long as no real word of it is missing; and a run that
 * holds every word of a title of some length scores high even with extra words around it, such as
 * a series name on the same line.
 */
function formScore(form: string, phrase: string): number {
  const trigram = trigramSimilarity(form, phrase);
  if (trigram >= 1) return 1;
  const formWords = tokens(form);
  const phraseWords = tokens(phrase);
  const agreement = wordAgreement(formWords, phraseWords);
  if (!agreement.complete) return trigram;
  const formLength = formWords.join('').length;
  const phraseLength = phraseWords.join('').length;
  const equal = (agreement.coverage * formLength) / Math.max(formLength, phraseLength);
  const contained =
    !isShortTitle(form) && agreement.coverage >= 0.85 ? 0.92 * agreement.coverage * Math.min(1, 0.7 + (0.3 * form.length) / phrase.length) : 0;
  return Math.max(trigram, equal, contained);
}

/** The words of a book's own author names, initials aside. */
function authorWords(authors: readonly string[]): string[] {
  return [...new Set(authors.flatMap((author) => tokens(normalizeCoverText(author)).filter((word) => word.length > 1)))];
}

/**
 * The phrase without the words that read as one of `names`, or null when it holds none of them or
 * nothing else. A spine read as one line runs title and author together ("dune frank herbert"), and
 * a short title is never found inside a longer line, so it is compared with what is left once that
 * book's own author is taken out. Only the candidate's authors are taken out, never other words.
 */
function withoutAuthorWords(phrase: string, names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const words = tokens(phrase);
  const kept = words.filter((word) => !names.some((name) => wordSimilarity(word, name) >= WORD_READ));
  return kept.length === 0 || kept.length === words.length ? null : kept.join(' ');
}

/** How well the best run of lines, with or without the book's own author in it, reads as this title. */
export function titleScore(candidate: VisualMatchCandidate, phrases: readonly CoverPhrase[]): number {
  const names = authorWords(candidate.authors);
  const texts = new Set<string>();
  for (const phrase of phrases) {
    texts.add(phrase.text);
    const titleOnly = withoutAuthorWords(phrase.text, names);
    if (titleOnly) texts.add(titleOnly);
  }
  let best = 0;
  for (const form of titleForms(candidate)) {
    for (const text of texts) {
      best = Math.max(best, formScore(form, text));
      if (best >= 1) return 1;
    }
  }
  return best;
}

/**
 * How well any single line reads as one of the book's authors. A spine often prints only the
 * surname, so a surname of four letters or more on a line counts for most of a match.
 */
export function authorScore(authors: readonly string[], lines: readonly string[]): number {
  let best = 0;
  for (const author of authors) {
    const name = normalizeCoverText(author);
    if (!name) continue;
    const nameWords = tokens(name).filter((word) => word.length > 1);
    const surname = nameWords.at(-1);
    for (const line of lines) {
      const lineWords = tokens(line);
      let score = trigramSimilarity(name, line);
      if (nameWords.length >= 2) {
        const agreement = wordAgreement(nameWords, lineWords);
        if (agreement.complete && agreement.coverage >= WORD_READ) score = Math.max(score, 0.95 * agreement.coverage);
      }
      if (surname && surname.length >= 4) {
        const surnameRead = Math.max(0, ...lineWords.map((word) => wordSimilarity(surname, word)));
        if (surnameRead >= 0.8) score = Math.max(score, 0.75 * surnameRead);
      }
      best = Math.max(best, score);
    }
  }
  return Math.min(1, best);
}

/**
 * Lines that are only a number, at least two digits long. `coverLines` drops them, because on a
 * cover or spine a number is a year, a price or a series number far more often than a title, but a
 * few titles are one ("1984", "11/22/63").
 */
export function numberLines(rawLines: readonly string[]): string[] {
  const numbers = new Set<string>();
  for (const raw of rawLines) {
    const line = normalizeCoverText(raw);
    if (/^\d[\d ]*$/.test(line) && line.replace(/ /g, '').length >= 2) numbers.add(line);
  }
  return [...numbers];
}

/**
 * One candidate against the photo, or null when it cannot be the book shown. A line holding only
 * the candidate's numeric title counts as the title read in full, but only beside its author.
 */
export function scoreCandidate(
  candidate: VisualMatchCandidate,
  lines: readonly string[],
  phrases: readonly CoverPhrase[],
  numbers: readonly string[] = [],
): VisualMatchScore | null {
  const forms = titleForms(candidate);
  if (forms.length === 0) return null;
  const numbered = numbers.length > 0 && forms.some((form) => numbers.includes(form));
  let title = titleScore(candidate, phrases);
  if (title < MIN_TITLE_SCORE && !numbered) return null;
  const author = authorScore(candidate.authors, lines);
  const confirmed = author >= AUTHOR_CONFIRMED;
  if (numbered && confirmed) title = 1;
  if (title < MIN_TITLE_SCORE) return null;
  if (!confirmed && isShortTitle(forms[0])) return null;
  const score = confirmed ? 0.7 * title + 0.3 * author : 0.85 * title;
  if (score < MIN_MATCH_SCORE) return null;
  return { bookId: candidate.bookId, score, titleScore: title, authorScore: author, titleLength: forms[0].length };
}

/**
 * The candidates the photo shows, best first, at most `limit`. Of two equal scores the longer title
 * goes first: "Resident Evil 4" read in full beats "Resident Evil" read from part of it. Remaining
 * ties keep the candidates' order, and anything well below the best is left out so one clear match
 * is not followed by guesses.
 */
export function rankCandidates(candidates: readonly VisualMatchCandidate[], rawLines: readonly string[], limit: number): VisualMatchScore[] {
  const lines = coverLines(rawLines);
  if (lines.length === 0) return [];
  const phrases = coverPhrases(lines);
  const numbers = numberLines(rawLines);
  const scored = candidates
    .map((candidate) => scoreCandidate(candidate, lines, phrases, numbers))
    .filter((score): score is VisualMatchScore => score !== null)
    .sort((a, b) => b.score - a.score || b.titleLength - a.titleLength);
  const best = scored[0]?.score ?? 0;
  return scored.filter((score) => score.score >= best - RESULT_SPREAD).slice(0, limit);
}

/** The known author a line names most clearly, if any names one well. */
export function bestAuthorName(names: readonly string[], rawLines: readonly string[]): string | null {
  const lines = coverLines(rawLines);
  let best: { name: string; score: number } | null = null;
  for (const name of new Set(names)) {
    const score = authorScore([name], lines);
    if (score >= 0.8 && (!best || score > best.score)) best = { name, score };
  }
  return best?.name ?? null;
}

/** Digits of an ISBN-10 or ISBN-13 as printed, or null. The check digit is not verified here. */
export function normalizeIsbn(value: string | null | undefined): { isbn10: string | null; isbn13: string | null } | null {
  const digits = (value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (digits.length === 13 && /^\d{13}$/.test(digits)) {
    return { isbn13: digits, isbn10: digits.startsWith('978') ? isbn13To10(digits) : null };
  }
  if (digits.length === 10 && /^\d{9}[\dX]$/.test(digits)) {
    return { isbn10: digits, isbn13: isbn10To13(digits) };
  }
  return null;
}

function isbn10To13(isbn10: string): string {
  const body = `978${isbn10.slice(0, 9)}`;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) sum += Number(body[index]) * (index % 2 === 0 ? 1 : 3);
  return body + String((10 - (sum % 10)) % 10);
}

function isbn13To10(isbn13: string): string {
  const body = isbn13.slice(3, 12);
  let sum = 0;
  for (let index = 0; index < 9; index += 1) sum += Number(body[index]) * (10 - index);
  const check = (11 - (sum % 11)) % 11;
  return body + (check === 10 ? 'X' : String(check));
}
