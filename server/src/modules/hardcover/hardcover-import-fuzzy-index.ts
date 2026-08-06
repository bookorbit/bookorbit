import { distance } from 'fastest-levenshtein';

import type { HardcoverImportLocalBook } from './hardcover.repository';

const TITLE_AUTHOR_ACCEPT_SCORE = 86;
const TITLE_AUTHOR_TIE_MARGIN = 5;
const MATCH_YIELD_INTERVAL_MS = 8;
const MATCH_YIELD_CHECK_SIZE = 128;
const MAX_MATCH_TEXT_LENGTH = 512;

interface PreparedText {
  normalized: string;
  tokens: string[];
  sortedTokenKey: string;
}

// Every comparison puts the Hardcover book on the left and a library book on the right, so the left side is
// prepared once per query while the right side stays lean enough to hold for the whole library.
interface PreparedQueryText extends PreparedText {
  tokenSet: Set<string>;
  bigramCounts: Map<string, number>;
}

interface IndexedBook {
  book: HardcoverImportLocalBook;
  title: PreparedText;
  authors: PreparedText[];
}

export interface HardcoverImportFuzzyMatch {
  book: HardcoverImportLocalBook;
  confidence: number;
}

interface ExactLookupResult {
  resolved: boolean;
  match: HardcoverImportFuzzyMatch | null;
}

// One budget for the whole index, not one per matching step: a preview scores every Hardcover book against the
// same index, and a per-step budget lets short steps and cheap rows accumulate into a long unbroken block.
class YieldBudget {
  private deadline = performance.now() + MATCH_YIELD_INTERVAL_MS;
  private processed = 0;

  isExhausted(): boolean {
    if (++this.processed < MATCH_YIELD_CHECK_SIZE) return false;
    this.processed = 0;
    return performance.now() >= this.deadline;
  }

  async yield(): Promise<void> {
    await yieldToEventLoop();
    this.deadline = performance.now() + MATCH_YIELD_INTERVAL_MS;
  }
}

export class HardcoverImportFuzzyIndex {
  private readonly yieldBudget = new YieldBudget();
  private readonly books: IndexedBook[] = [];
  private readonly titleBigrams = new Map<string, number[]>();
  private readonly titleCharacters = new Map<string, number[]>();
  private readonly titlesByNormalizedName = new Map<string, number[]>();
  private readonly titleTokens = new Map<string, number[]>();
  private readonly authorBigrams = new Map<string, number[]>();
  private readonly authorsByNormalizedName = new Map<string, number[]>();
  private readonly authorsByTokenKey = new Map<string, number[]>();
  private readonly authorTokens = new Map<string, number[]>();
  private readonly tokenlessAuthors = new Set<number>();
  private readonly exactTitleAuthors = new Map<string, number[]>();
  private readonly tokenSetTitleAuthors = new Map<string, number[]>();

  constructor(books: HardcoverImportLocalBook[]) {
    for (const book of books) {
      if (!book.title?.trim() || book.authors.length === 0) continue;

      const title = prepareText(normalizeTitle(book.title));
      const authors = book.authors.map((author) => prepareText(normalizeName(author))).filter((author) => author.normalized.length > 0);
      if (!title.normalized || authors.length === 0) continue;

      const bookIndex = this.books.length;
      this.books.push({ book, title, authors });

      addPostings(this.titleBigrams, bigramOccurrenceTokens(title.normalized), bookIndex);
      addPostings(this.titleCharacters, new Set(title.normalized), bookIndex);
      addPosting(this.titlesByNormalizedName, title.normalized, bookIndex);
      addPostings(this.titleTokens, new Set(title.tokens), bookIndex);

      const authorBigrams = new Set<string>();
      const normalizedAuthorNames = new Set<string>();
      const authorTokenKeys = new Set<string>();
      const authorTokens = new Set<string>();
      for (const author of authors) {
        for (const bigram of bigramOccurrenceTokens(author.normalized)) authorBigrams.add(bigram);
        normalizedAuthorNames.add(author.normalized);
        authorTokenKeys.add(author.sortedTokenKey);
        for (const token of author.tokens) authorTokens.add(token);
        if (author.tokens.length === 0) this.tokenlessAuthors.add(bookIndex);
        addPosting(this.exactTitleAuthors, pairKey(title.normalized, author.normalized), bookIndex);
        addPosting(this.tokenSetTitleAuthors, pairKey(title.normalized, author.sortedTokenKey), bookIndex);
      }
      addPostings(this.authorBigrams, authorBigrams, bookIndex);
      addPostings(this.authorsByNormalizedName, normalizedAuthorNames, bookIndex);
      addPostings(this.authorsByTokenKey, authorTokenKeys, bookIndex);
      addPostings(this.authorTokens, authorTokens, bookIndex);
    }
  }

  async findMatch(title: string | null, authors: string[]): Promise<HardcoverImportFuzzyMatch | null> {
    if (!title?.trim() || authors.length === 0) return null;

    const preparedTitle = prepareQueryText(normalizeTitle(title));
    const preparedAuthors = authors.map((author) => prepareQueryText(normalizeName(author))).filter((author) => author.normalized.length > 0);
    if (!preparedTitle.normalized || preparedAuthors.length === 0) return null;

    const exact = this.findExactMatch(preparedTitle, preparedAuthors);
    if (exact.resolved) return exact.match;

    const titleCandidates = await this.findTitleCandidates(preparedTitle);
    if (titleCandidates.size === 0) return null;
    const authorCandidates = await this.findAuthorCandidates(preparedAuthors);
    if (authorCandidates.size === 0) return null;

    const candidateIndexes = await this.narrowCandidates(titleCandidates, authorCandidates, preparedTitle, preparedAuthors);

    let best: HardcoverImportFuzzyMatch | null = null;
    let secondConfidence: number | null = null;

    for (let index = 0; index < candidateIndexes.length; index++) {
      if (this.yieldBudget.isExhausted()) await this.yieldBudget.yield();

      const indexedBook = this.books[candidateIndexes[index]!]!;
      const titleScore = scoreTitle(preparedTitle, indexedBook.title);
      const authorScore = scoreAuthors(preparedAuthors, indexedBook.authors);
      const confidence = Math.round((titleScore * 0.7 + authorScore * 0.3) * 100);
      if (titleScore < 0.8 || authorScore < 0.75 || confidence < TITLE_AUTHOR_ACCEPT_SCORE) continue;

      if (!best || confidence > best.confidence) {
        secondConfidence = best?.confidence ?? secondConfidence;
        best = { book: indexedBook.book, confidence };
      } else if (secondConfidence == null || confidence > secondConfidence) {
        secondConfidence = confidence;
      }
    }

    if (!best) return null;
    if (secondConfidence != null && best.confidence - secondConfidence <= TITLE_AUTHOR_TIE_MARGIN) return null;
    return best;
  }

  private findExactMatch(title: PreparedText, authors: PreparedText[]): ExactLookupResult {
    const exactCandidate = findUniqueCandidate(
      authors.map((author) => this.exactTitleAuthors.get(pairKey(title.normalized, author.normalized)) ?? []),
    );
    if (exactCandidate.resolved) {
      return {
        resolved: true,
        match: exactCandidate.bookIndex == null ? null : { book: this.books[exactCandidate.bookIndex]!.book, confidence: 100 },
      };
    }

    const tokenSetCandidate = findUniqueCandidate(
      authors.map((author) => this.tokenSetTitleAuthors.get(pairKey(title.normalized, author.sortedTokenKey)) ?? []),
    );
    if (tokenSetCandidate.resolved) {
      return {
        resolved: true,
        match: tokenSetCandidate.bookIndex == null ? null : { book: this.books[tokenSetCandidate.bookIndex]!.book, confidence: 99 },
      };
    }
    return { resolved: false, match: null };
  }

  private async findTitleCandidates(title: PreparedQueryText): Promise<Set<number>> {
    const candidates = new Set<number>();
    if (title.normalized.length === 1) {
      await addPostingsToSetYielding(candidates, this.titleCharacters, [title.normalized], this.yieldBudget);
      return candidates;
    }

    const bigramKeys = bigramOccurrenceTokens(title.normalized);
    const editPrefixSize = Math.min(bigramKeys.length, maxEditPrefixSize(title.normalized.length, 0.8));
    await addPostingsToSetYielding(candidates, this.titleBigrams, selectRarestKeys(this.titleBigrams, bigramKeys, editPrefixSize), this.yieldBudget);

    const tokenPrefixSize = maxTokenPrefixSize(title.tokenSet.size, 0.8);
    const tokenKeys = selectRarestKeys(this.titleTokens, title.tokenSet, tokenPrefixSize);
    await addPostingsToSetYielding(candidates, this.titleTokens, tokenKeys, this.yieldBudget);
    await addContainedTitles(candidates, this.titlesByNormalizedName, title.normalized, this.yieldBudget);
    return candidates;
  }

  private async findAuthorCandidates(authors: PreparedQueryText[]): Promise<Set<number>> {
    const candidates = new Set<number>();
    for (const author of authors) {
      await addPostingsToSetYielding(candidates, this.authorsByNormalizedName, [author.normalized], this.yieldBudget);
      await addPostingsToSetYielding(candidates, this.authorsByTokenKey, [author.sortedTokenKey], this.yieldBudget);

      const bigramKeys = bigramOccurrenceTokens(author.normalized);
      const editPrefixSize = Math.min(bigramKeys.length, maxEditPrefixSize(author.normalized.length, 0.76));
      const rarestBigrams = selectRarestKeys(this.authorBigrams, bigramKeys, editPrefixSize);
      await addPostingsToSetYielding(candidates, this.authorBigrams, rarestBigrams, this.yieldBudget);

      const tokenPrefixSize = maxTokenPrefixSize(author.tokenSet.size, 0.75);
      const tokenKeys = selectRarestKeys(this.authorTokens, author.tokenSet, tokenPrefixSize);
      await addPostingsToSetYielding(candidates, this.authorTokens, tokenKeys, this.yieldBudget);
      if (author.tokens.length === 0) {
        await addIndexesToSetYielding(candidates, this.tokenlessAuthors, this.yieldBudget);
      }
    }
    return candidates;
  }

  // Only the intersection can ever be scored, so both postings lists are narrowed together. Testing each side
  // separately would run the verification work over every title candidate plus every author candidate instead.
  private async narrowCandidates(
    titleCandidates: Set<number>,
    authorCandidates: Set<number>,
    title: PreparedQueryText,
    authors: PreparedQueryText[],
  ): Promise<number[]> {
    const smaller = titleCandidates.size <= authorCandidates.size ? titleCandidates : authorCandidates;
    const larger = smaller === titleCandidates ? authorCandidates : titleCandidates;

    const candidateIndexes: number[] = [];
    for (const bookIndex of smaller) {
      if (this.yieldBudget.isExhausted()) await this.yieldBudget.yield();
      if (!larger.has(bookIndex)) continue;

      const indexedBook = this.books[bookIndex]!;
      if (!isPossibleTitleMatch(title, indexedBook.title)) continue;
      if (!authors.some((author) => indexedBook.authors.some((localAuthor) => isPossibleAuthorMatch(author, localAuthor)))) continue;
      candidateIndexes.push(bookIndex);
    }
    return candidateIndexes.sort((left, right) => left - right);
  }
}

function addPostings(map: Map<string, number[]>, keys: Iterable<string>, bookIndex: number): void {
  for (const key of keys) addPosting(map, key, bookIndex);
}

function addPosting(map: Map<string, number[]>, key: string, bookIndex: number): void {
  const postings = map.get(key);
  if (postings) postings.push(bookIndex);
  else map.set(key, [bookIndex]);
}

function pairKey(left: string, right: string): string {
  return `${left}\0${right}`;
}

function findUniqueCandidate(postingLists: number[][]): { resolved: boolean; bookIndex: number | null } {
  let candidate: number | null = null;
  for (const postings of postingLists) {
    for (const bookIndex of postings) {
      if (candidate == null) candidate = bookIndex;
      else if (candidate !== bookIndex) return { resolved: true, bookIndex: null };
    }
  }
  return candidate == null ? { resolved: false, bookIndex: null } : { resolved: true, bookIndex: candidate };
}

async function addPostingsToSetYielding(result: Set<number>, map: Map<string, number[]>, keys: Iterable<string>, budget: YieldBudget): Promise<void> {
  for (const key of keys) {
    for (const bookIndex of map.get(key) ?? []) {
      result.add(bookIndex);
      if (budget.isExhausted()) await budget.yield();
    }
  }
}

async function addIndexesToSetYielding(result: Set<number>, indexes: Iterable<number>, budget: YieldBudget): Promise<void> {
  for (const bookIndex of indexes) {
    result.add(bookIndex);
    if (budget.isExhausted()) await budget.yield();
  }
}

function selectRarestKeys(map: Map<string, number[]>, keys: Iterable<string>, limit: number): string[] {
  if (limit <= 0) return [];
  return [...keys].sort((left, right) => (map.get(left)?.length ?? 0) - (map.get(right)?.length ?? 0)).slice(0, limit);
}

function bigramOccurrenceTokens(value: string): string[] {
  const result: string[] = [];
  const occurrences = new Map<string, number>();
  for (let index = 0; index < value.length - 1; index++) {
    const bigram = value.slice(index, index + 2);
    const occurrence = occurrences.get(bigram) ?? 0;
    result.push(`${bigram}\0${occurrence}`);
    occurrences.set(bigram, occurrence + 1);
  }
  return result;
}

function maxEditPrefixSize(queryLength: number, threshold: number): number {
  if (queryLength < 2) return 0;
  // One edit changes at most two bigrams. Searching this many rare query bigrams guarantees that every candidate within the threshold shares one.
  const maxDistance = Math.ceil(((1 - threshold) * queryLength) / threshold);
  return maxDistance * 2 + 1;
}

function maxTokenPrefixSize(queryTokenCount: number, threshold: number): number {
  if (queryTokenCount === 0) return 0;
  // A candidate meeting the overlap threshold cannot avoid every token in this rare-token prefix.
  return queryTokenCount - Math.ceil(threshold * queryTokenCount) + 1;
}

async function addContainedTitles(
  result: Set<number>,
  titlesByNormalizedName: Map<string, number[]>,
  query: string,
  budget: YieldBudget,
): Promise<void> {
  for (let start = 0; start < query.length; start++) {
    for (let end = start + 1; end <= query.length; end++) {
      if (budget.isExhausted()) await budget.yield();
      const postings = titlesByNormalizedName.get(query.slice(start, end));
      if (postings) await addIndexesToSetYielding(result, postings, budget);
    }
  }
}

function prepareText(normalized: string): PreparedText {
  const tokens = tokenize(normalized);
  return {
    normalized,
    tokens,
    sortedTokenKey: [...tokens].sort().join('\0'),
  };
}

function prepareQueryText(normalized: string): PreparedQueryText {
  const prepared = prepareText(normalized);
  return {
    ...prepared,
    tokenSet: new Set(prepared.tokens),
    bigramCounts: countBigrams(normalized),
  };
}

function countBigrams(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index < value.length - 1; index++) {
    const bigram = value.slice(index, index + 2);
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }
  return counts;
}

function isPossibleTitleMatch(left: PreparedQueryText, right: PreparedText): boolean {
  if (left.normalized.startsWith(right.normalized) || right.normalized.startsWith(left.normalized)) return true;
  if (left.normalized.includes(right.normalized) || right.normalized.includes(left.normalized)) return true;
  if (tokenOverlap(left, right) >= 0.8) return true;
  return canReachEditSimilarity(left, right, 0.8);
}

function isPossibleAuthorMatch(left: PreparedQueryText, right: PreparedText): boolean {
  if (left.normalized === right.normalized) return true;
  if (left.tokens.length === right.tokens.length && left.sortedTokenKey === right.sortedTokenKey) return true;
  if (tokenOverlap(left, right) >= 0.75) return true;
  return canReachEditSimilarity(left, right, 0.76);
}

function canReachEditSimilarity(left: PreparedQueryText, right: PreparedText, threshold: number): boolean {
  const maxLength = Math.max(left.normalized.length, right.normalized.length);
  const maxDistance = Math.floor((1 - threshold) * maxLength + Number.EPSILON * maxLength);
  if (Math.abs(left.normalized.length - right.normalized.length) > maxDistance) return false;

  const requiredSharedBigrams = Math.max(0, maxLength - 1 - maxDistance * 2);
  return countSharedBigrams(left.bigramCounts, right.normalized) >= requiredSharedBigrams;
}

function countSharedBigrams(left: Map<string, number>, rightValue: string): number {
  const right = countBigrams(rightValue);
  const smaller = left.size <= right.size ? left : right;
  const larger = smaller === left ? right : left;
  let shared = 0;
  for (const [bigram, count] of smaller) shared += Math.min(count, larger.get(bigram) ?? 0);
  return shared;
}

function scoreTitle(left: PreparedQueryText, right: PreparedText): number {
  if (!left.normalized || !right.normalized) return 0;
  if (left.normalized === right.normalized) return 1;
  if (left.normalized.startsWith(right.normalized) || right.normalized.startsWith(left.normalized)) return 0.94;
  if (left.normalized.includes(right.normalized) || right.normalized.includes(left.normalized)) return 0.9;

  const tokenScore = tokenOverlap(left, right);
  const editScore = normalizedLevenshtein(left.normalized, right.normalized);
  return Math.max(tokenScore, editScore >= 0.7 ? editScore : 0);
}

function scoreAuthors(hardcoverAuthors: PreparedQueryText[], localAuthors: PreparedText[]): number {
  let best = 0;
  for (const hardcoverAuthor of hardcoverAuthors) {
    for (const localAuthor of localAuthors) best = Math.max(best, scoreAuthor(hardcoverAuthor, localAuthor));
  }
  return best;
}

function scoreAuthor(left: PreparedQueryText, right: PreparedText): number {
  if (!left.normalized || !right.normalized) return 0;
  if (left.normalized === right.normalized) return 1;
  if (left.tokens.length === right.tokens.length && left.sortedTokenKey === right.sortedTokenKey) return 0.98;
  const overlap = tokenOverlap(left, right);
  const edit = normalizedLevenshtein(left.normalized, right.normalized);
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
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return value.split(' ').filter((token) => token.length > 1);
}

function tokenOverlap(left: PreparedQueryText, right: PreparedText): number {
  const rightTokenSet = new Set(right.tokens);
  if (left.tokenSet.size === 0 || rightTokenSet.size === 0) return 0;
  let overlap = 0;
  for (const token of left.tokenSet) {
    if (rightTokenSet.has(token)) overlap++;
  }
  return overlap / Math.max(left.tokenSet.size, rightTokenSet.size);
}

function normalizedLevenshtein(left: string, right: string): number {
  const maxLength = Math.max(left.length, right.length);
  return maxLength === 0 ? 1 : 1 - distance(left, right) / maxLength;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
