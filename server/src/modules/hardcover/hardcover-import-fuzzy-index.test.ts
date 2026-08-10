import { distance } from 'fastest-levenshtein';
import { describe, expect, it } from 'vitest';

import { HardcoverImportFuzzyIndex } from './hardcover-import-fuzzy-index';
import type { HardcoverImportLocalBook } from './hardcover.repository';

const ACCEPT_SCORE = 86;
const TIE_MARGIN = 5;
const MAX_MATCH_TEXT_LENGTH = 512;

interface ReferenceMatch {
  bookId: number;
  confidence: number;
}

function localBook(bookId: number, title: string | null, authors: string[]): HardcoverImportLocalBook {
  return {
    bookId,
    primaryFileId: null,
    primaryFileFormat: null,
    title,
    isbn13: null,
    isbn10: null,
    hardcoverMetadataId: null,
    authors,
    status: null,
    startedAt: null,
    finishedAt: null,
    progress: null,
  };
}

async function findMatch(index: HardcoverImportFuzzyIndex, title: string | null, authors: string[]): Promise<ReferenceMatch | null> {
  const match = await index.findMatch(title, authors);
  return match ? { bookId: match.book.bookId, confidence: match.confidence } : null;
}

describe('HardcoverImportFuzzyIndex', () => {
  it('preserves the previous fuzzy scoring decisions across representative string shapes', async () => {
    const values = ['Dune', 'Dune Messiah', 'Messiah Dune', 'Dune Mesiah', 'A', 'A B', 'The Left Hand of Darkness', 'Unrelated'];

    for (const localTitle of values) {
      for (const localAuthor of values) {
        const book = localBook(1, localTitle, [localAuthor]);
        const index = new HardcoverImportFuzzyIndex([book]);

        for (const queryTitle of values) {
          for (const queryAuthor of values) {
            const expected = referenceMatch(queryTitle, [queryAuthor], [book]);
            const actual = await findMatch(index, queryTitle, [queryAuthor]);
            expect(actual, `${queryTitle} / ${queryAuthor} -> ${localTitle} / ${localAuthor}`).toEqual(expected);
          }
        }
      }
    }
  });

  it('matches a brute-force scan over a library where candidates compete', async () => {
    const books = buildContentiousLibrary(140);
    const index = new HardcoverImportFuzzyIndex(books);

    let resolved = 0;
    for (const query of buildQueries(books)) {
      const expected = referenceMatch(query.title, query.authors, books);
      const actual = await findMatch(index, query.title, query.authors);
      expect(actual, `${String(query.title)} / ${query.authors.join(', ')}`).toEqual(expected);
      if (actual) resolved++;
    }

    expect(resolved, 'the corpus should exercise resolved matches, not only rejections').toBeGreaterThan(100);
  });

  it('finds a title that overlaps only by shared words', async () => {
    // The Hardcover title ends in a long run of characters the library has never seen, so every rare bigram and the
    // single rarest token all belong to that run. Only probing the shared words as well can reach the local book.
    const shared = 'alpha beta gamma delta epsilon zeta eta theta';
    const books = [localBook(1, `${shared} aaaa`, ['Ann Leckie'])];
    const index = new HardcoverImportFuzzyIndex(books);

    await expect(findMatch(index, `${shared} ${'qxwj'.repeat(20)}`, ['Ann Leckie'])).resolves.toEqual({ bookId: 1, confidence: 92 });
  });

  it('keeps ambiguous matches unresolved', async () => {
    const index = new HardcoverImportFuzzyIndex([localBook(1, 'Dune', ['Frank Herbert']), localBook(2, 'Dune', ['Frank Herbert'])]);

    await expect(index.findMatch('Dune', ['Frank Herbert'])).resolves.toBeNull();
  });

  // An exact title and author hit is decided by lookup, without comparing it against the rest of the library.
  // That deliberately resolves near ties the pre-index scan refused to call, which surfaces the book for review
  // instead of silently dropping the row as unmatched. Nothing is imported without the user selecting the row.
  describe('exact title and author hits skip the tie margin', () => {
    it('resolves a duplicate edition whose other copy spells the author differently', async () => {
      const books = [localBook(1, 'The Left Hand of Darkness', ['Ursula K. Le Guin']), localBook(2, 'The Left Hand of Darkness', ['Ursula Le Guin'])];
      const index = new HardcoverImportFuzzyIndex(books);

      expect(bruteForceMatch('The Left Hand of Darkness', ['Ursula K. Le Guin'], books)).toBeNull();
      await expect(findMatch(index, 'The Left Hand of Darkness', ['Ursula K. Le Guin'])).resolves.toEqual({ bookId: 1, confidence: 100 });
    });

    it('resolves the first book of a series against a later volume by the same author', async () => {
      const books = [localBook(1, 'Dune', ['Frank Herbert']), localBook(2, 'Dune Messiah', ['Frank Herbert'])];
      const index = new HardcoverImportFuzzyIndex(books);

      expect(bruteForceMatch('Dune', ['Frank Herbert'], books)).toBeNull();
      await expect(findMatch(index, 'Dune', ['Frank Herbert'])).resolves.toEqual({ bookId: 1, confidence: 100 });
    });

    it('still refuses when the exact hit is itself ambiguous', async () => {
      const books = [
        localBook(1, 'Ancillary Justice', ['Ann Leckie']),
        localBook(2, 'Ancillary Justice', ['Ann Leckie']),
        localBook(3, 'Ancillary Justice', ['Someone Else']),
      ];
      const index = new HardcoverImportFuzzyIndex(books);

      await expect(index.findMatch('Ancillary Justice', ['Ann Leckie'])).resolves.toBeNull();
    });

    it('falls back to the scored scan when only the author token order differs', async () => {
      const books = [localBook(1, 'Ubik', ['Philip K. Dick'])];
      const index = new HardcoverImportFuzzyIndex(books);

      await expect(findMatch(index, 'Ubik', ['Dick Philip'])).resolves.toEqual({ bookId: 1, confidence: 99 });
    });
  });

  it('matches a 42,000-book library without holding the event loop', { timeout: 60_000 }, async () => {
    const books = buildLargeLibrary(42_000);
    const index = new HardcoverImportFuzzyIndex(books);
    const queries = Array.from({ length: 40 }, (_, i) => {
      const book = books[(i * 349) % books.length]!;
      return i % 2 === 0
        ? { title: `${book.title!.slice(0, -1)}x`, authors: [...book.authors], expected: book.bookId }
        : { title: largeLibraryTitle(), authors: [largeLibraryAuthor()], expected: null };
    });

    let eventLoopTurns = 0;
    let running = true;
    const countTurn = (): void => {
      eventLoopTurns++;
      if (running) setImmediate(countTurn);
    };
    setImmediate(countTurn);

    const startedAt = performance.now();
    for (const query of queries) {
      const match = await index.findMatch(query.title, query.authors);
      expect(match?.book.bookId ?? null, `${query.title} / ${query.authors.join(', ')}`).toBe(query.expected);
    }
    const elapsedMs = performance.now() - startedAt;
    running = false;

    // A blocking scan cannot reach the event loop at all, so the count matters far more than the wall clock.
    expect(eventLoopTurns).toBeGreaterThan(50);
    expect(elapsedMs).toBeLessThan(30_000);
  });
});

// ---------------------------------------------------------------------------
// Reference implementation: the pre-index scan, plus the exact lookups the index resolves ahead of it.
// ---------------------------------------------------------------------------

function referenceMatch(title: string | null, authors: string[], books: HardcoverImportLocalBook[]): ReferenceMatch | null {
  const query = prepareQuery(title, authors);
  if (!query) return null;

  const candidates = books
    .filter((book) => book.title?.trim() && book.authors.length > 0)
    .map((book) => ({ book, title: normalizeTitle(book.title!), authors: book.authors.map(normalizeName).filter((author) => author.length > 0) }))
    .filter((candidate) => candidate.title.length > 0 && candidate.authors.length > 0);

  const exact = candidates.filter(
    (candidate) => candidate.title === query.title && candidate.authors.some((author) => query.authors.includes(author)),
  );
  if (exact.length > 0) return exact.length === 1 ? { bookId: exact[0]!.book.bookId, confidence: 100 } : null;

  const queryTokenKeys = query.authors.map(sortedTokenKey);
  const tokenSet = candidates.filter(
    (candidate) => candidate.title === query.title && candidate.authors.some((author) => queryTokenKeys.includes(sortedTokenKey(author))),
  );
  if (tokenSet.length > 0) return tokenSet.length === 1 ? { bookId: tokenSet[0]!.book.bookId, confidence: 99 } : null;

  return bruteForceMatch(title, authors, books);
}

function bruteForceMatch(title: string | null, authors: string[], books: HardcoverImportLocalBook[]): ReferenceMatch | null {
  if (!title?.trim() || authors.length === 0) return null;

  const scored = books
    .filter((book) => book.title?.trim() && book.authors.length > 0)
    .map((book) => {
      const titleScore = scoreTitle(title, book.title!);
      const authorScore = scoreAuthors(authors, book.authors);
      return { book, titleScore, authorScore, confidence: Math.round((titleScore * 0.7 + authorScore * 0.3) * 100) };
    })
    .filter((row) => row.titleScore >= 0.8 && row.authorScore >= 0.75 && row.confidence >= ACCEPT_SCORE)
    .sort((left, right) => right.confidence - left.confidence);

  const best = scored[0];
  if (!best) return null;
  const second = scored[1];
  if (second && best.confidence - second.confidence <= TIE_MARGIN) return null;
  return { bookId: best.book.bookId, confidence: best.confidence };
}

function prepareQuery(title: string | null, authors: string[]): { title: string; authors: string[] } | null {
  if (!title?.trim() || authors.length === 0) return null;
  const normalizedTitle = normalizeTitle(title);
  const normalizedAuthors = authors.map(normalizeName).filter((author) => author.length > 0);
  if (!normalizedTitle || normalizedAuthors.length === 0) return null;
  return { title: normalizedTitle, authors: normalizedAuthors };
}

function scoreTitle(leftValue: string, rightValue: string): number {
  const left = normalizeTitle(leftValue);
  const right = normalizeTitle(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.startsWith(right) || right.startsWith(left)) return 0.94;
  if (left.includes(right) || right.includes(left)) return 0.9;
  const tokenScore = tokenOverlap(left, right);
  const editScore = normalizedLevenshtein(left, right);
  return Math.max(tokenScore, editScore >= 0.7 ? editScore : 0);
}

function scoreAuthors(hardcoverAuthors: string[], localAuthors: string[]): number {
  let best = 0;
  for (const hardcoverAuthor of hardcoverAuthors) {
    for (const localAuthor of localAuthors) best = Math.max(best, scoreAuthor(hardcoverAuthor, localAuthor));
  }
  return best;
}

function scoreAuthor(leftValue: string, rightValue: string): number {
  const left = normalizeName(leftValue);
  const right = normalizeName(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (sortedTokenKey(left) === sortedTokenKey(right)) return 0.98;
  const overlap = tokenOverlap(left, right);
  const edit = normalizedLevenshtein(left, right);
  return Math.max(overlap, edit >= 0.76 ? edit : 0);
}

function normalizeTitle(value: string): string {
  const stripped = value.split(/:\s+| - /)[0] ?? value;
  return normalizeName(stripped);
}

function normalizeName(value: string): string {
  return value
    .slice(0, MAX_MATCH_TEXT_LENGTH)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return value.split(' ').filter((token) => token.length > 1);
}

function sortedTokenKey(value: string): string {
  return tokenize(value).sort().join('\0');
}

function tokenOverlap(leftValue: string, rightValue: string): number {
  const left = new Set(tokenize(leftValue));
  const right = new Set(tokenize(rightValue));
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap++;
  }
  return overlap / Math.max(left.size, right.size);
}

function normalizedLevenshtein(left: string, right: string): number {
  const maxLength = Math.max(left.length, right.length);
  return maxLength === 0 ? 1 : 1 - distance(left, right) / maxLength;
}

// ---------------------------------------------------------------------------
// Corpora
// ---------------------------------------------------------------------------

function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const TITLE_WORDS = ['Dune', 'Messiah', 'Shadow', 'Empire', 'of', 'the', 'Left', 'Hand', 'Darkness', 'Ancillary', 'Justice', 'Sea', 'Émile', 'II'];
const GIVEN_NAMES = ['Frank', 'Ursula', 'Ann', 'Anne', 'Jo', 'J', 'Ted', 'Émile', 'Mary', 'Marie'];
const FAMILY_NAMES = ['Herbert', 'Le Guin', 'Leckie', 'Chiang', 'Zola', 'García Márquez', 'Adams', 'Adam', 'K'];

// Titles and authors are drawn from a deliberately small pool so that near-duplicate editions, shared authors and
// tie-margin rejections all occur, which is what separates an index lookup from a full scan.
function buildContentiousLibrary(count: number): HardcoverImportLocalBook[] {
  const random = createRandom(0x5eed);
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]!;
  const makeTitle = (): string => {
    const wordCount = random() < 0.35 ? 4 + Math.floor(random() * 3) : 1 + Math.floor(random() * 3);
    const words = Array.from({ length: wordCount }, () => pick(TITLE_WORDS)).join(' ');
    if (random() < 0.15) return `${words}: ${pick(TITLE_WORDS)}`;
    if (random() < 0.2) return words.toUpperCase();
    return words;
  };
  const makeAuthor = (): string => {
    const roll = random();
    if (roll < 0.1) return `${pick(GIVEN_NAMES)}. ${pick(FAMILY_NAMES)}`;
    if (roll < 0.15) return pick(FAMILY_NAMES);
    return `${pick(GIVEN_NAMES)} ${pick(FAMILY_NAMES)}`;
  };

  const books: HardcoverImportLocalBook[] = [];
  for (let bookId = 0; bookId < count; bookId++) {
    const roll = random();
    if (roll < 0.04) books.push(localBook(bookId, makeTitle(), []));
    else if (roll < 0.07) books.push(localBook(bookId, null, [makeAuthor()]));
    else if (roll < 0.1) books.push(localBook(bookId, '   ', [makeAuthor()]));
    else if (roll < 0.14) books.push(localBook(bookId, makeTitle(), ['!!!', makeAuthor()]));
    else if (roll < 0.22 && books.length > 0) {
      const source = books[Math.floor(random() * books.length)]!;
      books.push(localBook(bookId, source.title, [...source.authors]));
    } else if (roll < 0.3) books.push(localBook(bookId, makeTitle(), [makeAuthor(), makeAuthor()]));
    else books.push(localBook(bookId, makeTitle(), [makeAuthor()]));
  }
  return books;
}

function buildQueries(books: HardcoverImportLocalBook[]): Array<{ title: string; authors: string[] }> {
  const random = createRandom(0xc0ffee);
  const perturb = (value: string): string => {
    if (value.length === 0) return value;
    const at = Math.floor(random() * value.length);
    const roll = random();
    if (roll < 0.3) return value.slice(0, at) + value.slice(at + 1);
    if (roll < 0.6) return `${value.slice(0, at)}e${value.slice(at)}`;
    if (roll < 0.85) return `${value.slice(0, at)}x${value.slice(at + 1)}`;
    return value.split(' ').reverse().join(' ');
  };
  // Edits spread across the string are what the bigram bound has to survive: a single typo leaves almost every
  // bigram intact, so only multi-edit queries prove the candidate prefix is wide enough.
  const scatterEdits = (value: string, count: number): string => {
    let result = value;
    for (let edit = 0; edit < count; edit++) {
      const at = Math.floor(((edit + 1) * result.length) / (count + 1));
      result = `${result.slice(0, at)}z${result.slice(at + 1)}`;
    }
    return result;
  };

  const queries: Array<{ title: string; authors: string[] }> = [];
  for (const book of books) {
    const title = book.title?.trim() ? book.title : 'Dune';
    const authors = book.authors.length > 0 ? book.authors : ['Frank Herbert'];
    queries.push({ title, authors: [authors[0]!] });
    queries.push({ title, authors });
    queries.push({ title: perturb(title), authors: [authors[0]!] });
    queries.push({ title, authors: [perturb(authors[0]!)] });
    queries.push({ title: `${title}: Special Edition`, authors: [authors[0]!] });
    queries.push({ title: title.split(' ')[0]!, authors: [authors[0]!] });
    queries.push({ title: title.toUpperCase(), authors: [authors[0]!.split(' ').reverse().join(' ')] });
    queries.push({ title: scatterEdits(title, 2), authors: [authors[0]!] });
    queries.push({ title: scatterEdits(title, 3), authors: [scatterEdits(authors[0]!, 2)] });
  }
  return queries;
}

const LARGE_SYLLABLES =
  'ka ro mi tel vin sar dou lem pra zin hol fer nue quas bir wen ta shi glo urn eld myr pod cav rin thu neb wor lax jem ovi dast fen gri hup jolt kres lun mab nyx opa'.split(
    ' ',
  );
const LARGE_COMMON = ['the', 'of', 'and', 'in', 'last', 'dark', 'lost', 'night', 'song', 'house'];
const largeRandom = createRandom(0xb00c);

function largeWord(): string {
  const count = 2 + Math.floor(largeRandom() * 2);
  return Array.from({ length: count }, () => LARGE_SYLLABLES[Math.floor(largeRandom() * LARGE_SYLLABLES.length)]!).join('');
}

function largeLibraryTitle(): string {
  const common = (): string => LARGE_COMMON[Math.floor(largeRandom() * LARGE_COMMON.length)]!;
  return [common(), largeWord(), common(), largeWord()].join(' ');
}

function largeLibraryAuthor(): string {
  return `${largeWord()} ${largeWord()}`;
}

function buildLargeLibrary(count: number): HardcoverImportLocalBook[] {
  return Array.from({ length: count }, (_, bookId) => localBook(bookId, largeLibraryTitle(), [largeLibraryAuthor()]));
}
