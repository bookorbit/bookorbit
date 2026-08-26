import { Injectable } from '@nestjs/common';
import { bookRequestWorkKey, canonicalizeBookRequestIsbn, normalizeWorkToken } from '@bookorbit/types';
import type { BookRequestAvailability, BookRequestAvailabilityQuery, BookRequestMediaKind, BookRequestMetadataSource } from '@bookorbit/types';

import { BookRequestRepository, type OwnedTitleMatch } from './book-request.repository';

export interface WorkIdentity {
  title: string;
  authors?: string[] | null;
  isbn13?: string | null;
  providerKey?: string | null;
  providerId?: string | null;
  metadataSources?: BookRequestMetadataSource[] | null;
  mediaKind: BookRequestMediaKind;
}

export function normalizeIsbn(value: string | null | undefined): string | null {
  const normalized = (value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
  return normalized.length === 13 || normalized.length === 10 ? normalized : null;
}

/** Matches the `lower(title)` expression index on `book_metadata`; see the repository. */
export function lowerTitleKey(title: string): string {
  return title.trim().toLowerCase();
}

/** Re-exported so the dedupe rules read from one place; the implementation is shared with the client. */
export const normalizeToken = normalizeWorkToken;

/**
 * Every key this work could have been filed under, most specific first.
 *
 * Deriving only the preferred key is not enough. Two people can reach the same book through
 * different providers, one result carrying an ISBN13 and the other not, and their preferred keys
 * would never collide - so the second request would be created rather than folded in, and on a
 * private tracker that is two grabs of one torrent. Callers probe all of these.
 */
export function dedupeKeyCandidates(work: WorkIdentity): string[] {
  const isbnKeys: string[] = [];
  const isbn13 = normalizeIsbn(work.isbn13);
  if (isbn13 && isbn13.length === 13) isbnKeys.push(`isbn13:${isbn13}:${work.mediaKind}`);
  for (const source of work.metadataSources ?? []) {
    const canonical = canonicalizeBookRequestIsbn(source.isbn10, source.isbn13);
    if (canonical) isbnKeys.push(`isbn13:${canonical}:${work.mediaKind}`);
  }

  const providerKeys: string[] = [];
  if (work.providerKey && work.providerId) {
    providerKeys.push(`provider:${work.providerKey}:${work.providerId}:${work.mediaKind}`);
  }
  for (const source of work.metadataSources ?? []) {
    providerKeys.push(`provider:${source.providerKey}:${source.providerId}:${work.mediaKind}`);
  }

  // Any title at all produces a work key. Testing the normalized token instead used to leave every
  // non-Latin title with no key here while `primaryDedupeKey` filed the row under a constant, so
  // the probe found nothing, the insert collided with an unrelated request and the submitter got a
  // 500. The two have to agree about what a work is called, whatever alphabet it is called it in.
  const workKeys: string[] = [];
  if (work.title.trim()) {
    workKeys.push(bookRequestWorkKey(work.title, work.authors?.[0], work.mediaKind));
  }

  return [...new Set([...isbnKeys, ...providerKeys, ...workKeys])];
}

/**
 * The key a new request is stored under: the most specific one available.
 *
 * The last resort is the work key rather than a constant. A constant would be one key shared by
 * every request the candidate list came back empty for, and since the probe never looks a request
 * up under a key it was not given, the second such submission of a medium would collide on the
 * partial unique index and reach the submitter as an unexplained 500.
 */
export function primaryDedupeKey(work: WorkIdentity): string {
  const candidates = dedupeKeyCandidates(work);
  const fallback = bookRequestWorkKey(work.title, work.authors?.[0], work.mediaKind);

  const isbnKeys = candidates.filter((key) => key.startsWith('isbn13:'));
  if (isbnKeys.length <= 1) return candidates[0] ?? fallback;

  return candidates.find((key) => key.startsWith('work:')) ?? candidates[0] ?? fallback;
}

/**
 * A shared title is not a shared book. When the candidate names an author, only a book that
 * agrees on it counts as owned; a candidate with no author at all has nothing better to go on,
 * so the title match stands.
 */
export function matchOwnedByTitle(matches: OwnedTitleMatch[] | undefined, author: string | null | undefined): number | null {
  if (!matches?.length) return null;

  const wanted = normalizeToken(author ?? '');
  if (!wanted) return matches[0].bookId;

  const agreed = matches.find((match) => match.authorNames.some((name) => normalizeToken(name) === wanted));
  return agreed?.bookId ?? null;
}

@Injectable()
export class BookRequestDedupeService {
  constructor(private readonly repo: BookRequestRepository) {}

  /**
   * Annotates a batch of search candidates with "already in your library" and "already
   * requested". Three queries total regardless of batch size.
   */
  async checkAvailability(
    queries: BookRequestAvailabilityQuery[],
    userId: number,
    accessibleLibraryIds: number[] | null,
  ): Promise<BookRequestAvailability[]> {
    if (queries.length === 0) return [];

    const perQueryKeys = queries.map((query) =>
      dedupeKeyCandidates({
        title: query.title,
        authors: query.author ? [query.author] : [],
        isbn13: query.isbn13,
        providerKey: query.providerKey,
        providerId: query.providerId,
        mediaKind: query.mediaKind,
      }),
    );

    const isbn13s = [...new Set(queries.map((q) => normalizeIsbn(q.isbn13)).filter((v): v is string => v !== null && v.length === 13))];
    const lowerTitles = [...new Set(queries.map((q) => lowerTitleKey(q.title)).filter(Boolean))];
    const allKeys = [...new Set(perQueryKeys.flat())];

    const [owned, activeRequests] = await Promise.all([
      this.repo.findOwnedMatches(isbn13s, lowerTitles, accessibleLibraryIds),
      this.repo.findActiveByDedupeKeys(allKeys),
    ]);

    const matchedRequestIds = [...new Set([...activeRequests.values()].map((row) => row.id))];
    const subscribedIds = await this.repo.findSubscribedRequestIds(userId, matchedRequestIds);

    return queries.map((query, index) => {
      const isbn13 = normalizeIsbn(query.isbn13);
      const ownedByIsbn = isbn13 !== null && isbn13.length === 13 ? owned.byIsbn13.get(isbn13) : undefined;
      const ownedBookId = ownedByIsbn ?? matchOwnedByTitle(owned.byTitle.get(lowerTitleKey(query.title)), query.author);

      const existing = perQueryKeys[index].map((key) => activeRequests.get(key)).find((row) => row !== undefined);

      return {
        ownedBookId,
        existingRequestId: existing?.id ?? null,
        existingRequestStatus: existing ? (existing.status as BookRequestAvailability['existingRequestStatus']) : null,
        alreadySubscribed: existing ? existing.userId === userId || subscribedIds.has(existing.id) : false,
      };
    });
  }

  /** Single-work form used on submit, where all three key shapes still have to be probed. */
  async findActiveRequestFor(work: WorkIdentity) {
    const keys = dedupeKeyCandidates(work);
    const matches = await this.repo.findActiveByDedupeKeys(keys);
    for (const key of keys) {
      const row = matches.get(key);
      if (row) return row;
    }
    return undefined;
  }
}
