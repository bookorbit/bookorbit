/**
 * Finds where a photographed page sits in a book. Text recognised by a camera is noisy: dropped or
 * misread letters, ligatures, words hyphenated across lines, running heads and page numbers. So the
 * page is not searched for as a whole. Both sides are cut into words, the page into overlapping
 * groups of words, and the stretch of the book that shares the most distinct groups with the page
 * wins. A misread word only spoils the few groups that contain it.
 */

/** Words per group. Four keeps common phrases from matching everywhere while tolerating misreads. */
export const LOCATE_SHINGLE_SIZE = 4;
/** A page with fewer words than this is too little to place reliably. */
export const LOCATE_MIN_QUERY_WORDS = 8;
const MIN_DISTINCT_SHINGLES = 3;
/** Share of the page's word groups a place must contain before it counts as found. */
const MIN_SHINGLE_SHARE = 0.12;

export interface WordSequence {
  words: string[];
  /** Code point offset of each word's first character in the source text. */
  starts: number[];
  /** Code point offset just past each word's last character. */
  ends: number[];
}

export interface LocateChapterText {
  chapterIndex: number;
  text: string;
}

export interface LocateBookIndex {
  words: string[];
  starts: Int32Array;
  ends: Int32Array;
  /** The first word of each indexed chapter, in reading order. */
  chapters: Array<{ chapterIndex: number; firstWord: number }>;
  /** True when the book was longer than the word limit and its end was left out. */
  truncated: boolean;
}

export interface LocateCandidate {
  firstWord: number;
  lastWord: number;
  distinct: number;
  share: number;
}

export interface LocatedRange {
  chapterIndex: number;
  startCp: number;
  endCp: number;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
/** Marks, soft hyphens, zero-width characters and apostrophes stay inside a word without adding to it. */
const IN_WORD_SKIP = /[\p{M}\p{Cf}'’ʼ]/u;
const COMBINING_MARK = /\p{M}/gu;
const LINE_BREAK_HYPHEN = /(\p{L})[-­‐‑]\s*\n\s*(?=\p{Ll})/gu;

/**
 * Joins words a typesetter split across lines ("remem-" then "bered"). Only a lowercase
 * continuation joins, so a line that ends a hyphenated name before a capitalised word stays apart.
 */
export function prepareRecognisedText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(LINE_BREAK_HYPHEN, '$1');
}

/**
 * Cuts text into lowercase words with accents and compatibility forms folded away, so "ﬁnal",
 * "Final" and "fínal" are the same word. Offsets count code points, matching the collapsed text of
 * `ChapterTextIndex`.
 */
export function tokenizeWords(text: string): WordSequence {
  const words: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let current = '';
  let start = -1;
  let end = -1;
  let cp = 0;

  const flush = () => {
    if (current) {
      words.push(current);
      starts.push(start);
      ends.push(end);
    }
    current = '';
    start = -1;
  };

  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x80) {
      const isDigit = code >= 0x30 && code <= 0x39;
      const isUpper = code >= 0x41 && code <= 0x5a;
      const isLower = code >= 0x61 && code <= 0x7a;
      if (isDigit || isUpper || isLower) {
        if (start < 0) start = cp;
        current += isUpper ? String.fromCharCode(code + 0x20) : ch;
        end = cp + 1;
      } else if (!(start >= 0 && code === 0x27)) {
        flush();
      }
    } else if (WORD_CHAR.test(ch)) {
      if (start < 0) start = cp;
      current += ch.normalize('NFKD').replace(COMBINING_MARK, '').toLowerCase();
      end = cp + 1;
    } else if (!(start >= 0 && IN_WORD_SKIP.test(ch))) {
      flush();
    }
    cp += 1;
  }
  flush();
  return { words, starts, ends };
}

/** Builds the searchable word list of a book, stopping at `maxWords` to bound memory. */
export function buildLocateIndex(chapters: LocateChapterText[], maxWords: number): LocateBookIndex {
  const words: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const chapterStarts: LocateBookIndex['chapters'] = [];
  let truncated = false;

  for (const chapter of chapters) {
    const sequence = tokenizeWords(chapter.text);
    if (sequence.words.length === 0) continue;
    const room = maxWords - words.length;
    if (room <= 0) {
      truncated = true;
      break;
    }
    const take = Math.min(room, sequence.words.length);
    chapterStarts.push({ chapterIndex: chapter.chapterIndex, firstWord: words.length });
    for (let i = 0; i < take; i += 1) {
      words.push(sequence.words[i]);
      starts.push(sequence.starts[i]);
      ends.push(sequence.ends[i]);
    }
    if (take < sequence.words.length) {
      truncated = true;
      break;
    }
  }

  return { words, starts: Int32Array.from(starts), ends: Int32Array.from(ends), chapters: chapterStarts, truncated };
}

/**
 * Returns the stretch of `book` that shares the most distinct word groups with `query`, or null
 * when no stretch shares enough to be the same text.
 */
export function findDensestMatch(book: readonly string[], query: readonly string[], shingleSize = LOCATE_SHINGLE_SIZE): LocateCandidate | null {
  if (query.length < Math.max(LOCATE_MIN_QUERY_WORDS, shingleSize) || book.length < shingleSize) return null;

  const shinglePositions = new Map<string, number[]>();
  const firstWords = new Set<string>();
  const totalShingles = query.length - shingleSize + 1;
  for (let j = 0; j < totalShingles; j += 1) {
    const key = query.slice(j, j + shingleSize).join(' ');
    const positions = shinglePositions.get(key);
    if (positions) positions.push(j);
    else shinglePositions.set(key, [j]);
    firstWords.add(query[j]);
  }

  const hitWord: number[] = [];
  const hitShingle: number[] = [];
  for (let i = 0; i + shingleSize <= book.length; i += 1) {
    if (!firstWords.has(book[i])) continue;
    const positions = shinglePositions.get(book.slice(i, i + shingleSize).join(' '));
    if (!positions) continue;
    for (const j of positions) {
      hitWord.push(i);
      hitShingle.push(j);
    }
  }
  if (hitWord.length === 0) return null;

  // The page may have dropped or gained words against the book, so the window is wider than it.
  const window = query.length + Math.max(8, Math.ceil(query.length / 2));
  const counts = new Map<number, number>();
  let distinct = 0;
  let left = 0;
  let best: { left: number; right: number; distinct: number } | null = null;

  for (let right = 0; right < hitWord.length; right += 1) {
    const added = hitShingle[right];
    const count = counts.get(added) ?? 0;
    counts.set(added, count + 1);
    if (count === 0) distinct += 1;

    while (hitWord[right] - hitWord[left] > window) {
      const removed = hitShingle[left];
      const remaining = (counts.get(removed) ?? 1) - 1;
      if (remaining === 0) {
        counts.delete(removed);
        distinct -= 1;
      } else {
        counts.set(removed, remaining);
      }
      left += 1;
    }

    if (!best || distinct > best.distinct) best = { left, right, distinct };
  }

  if (!best) return null;
  const required = Math.max(MIN_DISTINCT_SHINGLES, Math.ceil(totalShingles * MIN_SHINGLE_SHARE));
  if (best.distinct < required) return null;

  // A common phrase from the page can also occur just before or after the real place. Hits that
  // belong to the page share one alignment between page and book, so stray ones are dropped by it.
  const offsets: number[] = [];
  for (let k = best.left; k <= best.right; k += 1) offsets.push(hitWord[k] - hitShingle[k]);
  const alignment = [...offsets].sort((a, b) => a - b)[offsets.length >> 1];
  const tolerance = Math.max(6, Math.ceil(query.length * 0.15));
  let firstWord = Number.POSITIVE_INFINITY;
  let lastHit = -1;
  for (let k = best.left; k <= best.right; k += 1) {
    if (Math.abs(offsets[k - best.left] - alignment) > tolerance) continue;
    firstWord = Math.min(firstWord, hitWord[k]);
    lastHit = Math.max(lastHit, hitWord[k]);
  }

  return {
    firstWord,
    lastWord: Math.min(book.length - 1, lastHit + shingleSize - 1),
    distinct: best.distinct,
    share: Math.min(1, best.distinct / totalShingles),
  };
}

/**
 * Maps a candidate back to a chapter and its collapsed code point range. A match that runs over a
 * chapter's end is cut at that end, so the range always lies within one chapter document.
 */
export function resolveLocatedRange(index: LocateBookIndex, candidate: LocateCandidate): LocatedRange | null {
  let chapterSlot = -1;
  let low = 0;
  let high = index.chapters.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (index.chapters[mid].firstWord <= candidate.firstWord) {
      chapterSlot = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (chapterSlot < 0) return null;

  const nextChapterFirstWord = index.chapters[chapterSlot + 1]?.firstWord ?? index.words.length;
  const lastWord = Math.min(candidate.lastWord, nextChapterFirstWord - 1);
  if (lastWord < candidate.firstWord) return null;

  return {
    chapterIndex: index.chapters[chapterSlot].chapterIndex,
    startCp: index.starts[candidate.firstWord],
    endCp: index.ends[lastWord],
  };
}
