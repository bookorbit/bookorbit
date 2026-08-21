import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';
import { describe, expect, it } from 'vitest';

import { resolveCandidateAgreement } from './candidate-agreement';
import { MetadataSearchParams } from './providers/metadata-search-params';

function candidate(provider: MetadataProviderKey, data: Partial<MetadataCandidate> = {}): MetadataCandidate {
  return { provider, providerId: `${provider}-1`, ...data };
}

const providersOf = (candidates: MetadataCandidate[]) => candidates.map((c) => c.provider);

describe('resolveCandidateAgreement', () => {
  const query: MetadataSearchParams = { title: 'The Hobbit', author: 'J.R.R. Tolkien' };

  it('accepts a lone candidate without judging it', () => {
    const only = candidate(MetadataProviderKey.GOOGLE, { title: 'Something Else Entirely' });
    const result = resolveCandidateAgreement([only], query);

    expect(result.accepted).toEqual([only]);
    expect(result.rejected).toEqual([]);
    expect(result.anchor).toBe(only);
  });

  it('accepts an empty candidate list', () => {
    const result = resolveCandidateAgreement([], query);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.anchor).toBeUndefined();
  });

  it('rejects candidates describing a different book', () => {
    const right = candidate(MetadataProviderKey.GOOGLE, { title: 'The Hobbit', authors: ['J.R.R. Tolkien'] });
    const wrong = candidate(MetadataProviderKey.GOODREADS, { title: 'The Girl on the Train', authors: ['Paula Hawkins'] });
    const alsoWrong = candidate(MetadataProviderKey.AMAZON, { title: 'The Silence of the Lambs', authors: ['Thomas Harris'] });

    const result = resolveCandidateAgreement([right, wrong, alsoWrong], query);

    expect(providersOf(result.accepted)).toEqual([MetadataProviderKey.GOOGLE]);
    expect(providersOf(result.rejected)).toEqual([MetadataProviderKey.GOODREADS, MetadataProviderKey.AMAZON]);
  });

  it('accepts an edition whose subtitle extends the anchor title', () => {
    const anchor = candidate(MetadataProviderKey.GOOGLE, { title: 'The Hobbit', authors: ['J.R.R. Tolkien'] });
    const edition = candidate(MetadataProviderKey.KOBO, { title: 'The Hobbit: Or There and Back Again', authors: ['J. R. R. Tolkien'] });

    const result = resolveCandidateAgreement([anchor, edition], query);

    expect(result.rejected).toEqual([]);
    expect(providersOf(result.accepted)).toEqual([MetadataProviderKey.GOOGLE, MetadataProviderKey.KOBO]);
  });

  it('accepts a translated edition that keeps the distinctive word', () => {
    const anchor = candidate(MetadataProviderKey.GOOGLE, { title: 'The Hobbit', authors: ['J.R.R. Tolkien'] });
    const translated = candidate(MetadataProviderKey.KOBO, { title: 'Der kleine Hobbit', authors: ['J.R.R. Tolkien'] });

    const result = resolveCandidateAgreement([anchor, translated], query);

    expect(result.rejected).toEqual([]);
  });

  it('rejects a companion volume that extends the title but has a different author', () => {
    const anchor = candidate(MetadataProviderKey.GOOGLE, { title: 'The Hobbit', authors: ['J.R.R. Tolkien'] });
    const cookbook = candidate(MetadataProviderKey.AMAZON, { title: 'The Hobbit Cookbook', authors: ['Some Chef'] });

    const result = resolveCandidateAgreement([anchor, cookbook], query);

    expect(providersOf(result.rejected)).toEqual([MetadataProviderKey.AMAZON]);
  });

  it('keeps a candidate whose author is unknown, having no evidence against it', () => {
    const anchor = candidate(MetadataProviderKey.GOOGLE, { title: 'The Hobbit', authors: ['J.R.R. Tolkien'] });
    const noAuthors = candidate(MetadataProviderKey.AMAZON, { title: 'The Hobbit', authors: [] });

    const result = resolveCandidateAgreement([anchor, noAuthors], query);

    expect(result.rejected).toEqual([]);
  });

  it('keeps a candidate that has no title to judge', () => {
    const anchor = candidate(MetadataProviderKey.GOOGLE, { title: 'The Hobbit', authors: ['J.R.R. Tolkien'] });
    const untitled = candidate(MetadataProviderKey.ITUNES, { coverUrl: 'https://example.com/cover.jpg' });

    const result = resolveCandidateAgreement([anchor, untitled], query);

    expect(result.rejected).toEqual([]);
  });

  it('keeps a candidate that disagrees on title but shares the ISBN', () => {
    const anchor = candidate(MetadataProviderKey.GOOGLE, { title: 'The Hobbit', authors: ['J.R.R. Tolkien'], isbn13: '9780261102217' });
    const retitled = candidate(MetadataProviderKey.KOBO, { title: 'A Completely Different Listing', isbn13: '978-0-261-10221-7' });

    const result = resolveCandidateAgreement([anchor, retitled], query);

    expect(result.rejected).toEqual([]);
  });

  describe('anchor selection', () => {
    it('anchors on the candidate matching the queried ISBN even when it is not first', () => {
      const first = candidate(MetadataProviderKey.GOODREADS, { title: 'The Hobbit Cookbook', authors: ['Some Chef'] });
      const isbnMatch = candidate(MetadataProviderKey.GOOGLE, { title: 'The Hobbit', authors: ['J.R.R. Tolkien'], isbn13: '9780261102217' });

      const result = resolveCandidateAgreement([first, isbnMatch], { ...query, isbn: '978-0-261-10221-7' });

      expect(result.anchor).toBe(isbnMatch);
      expect(providersOf(result.rejected)).toEqual([MetadataProviderKey.GOODREADS]);
    });

    it('anchors on the strongest match to the query rather than the most trusted provider', () => {
      const trustedButWeak = candidate(MetadataProviderKey.GOODREADS, { title: 'The Hobbit Cookbook', authors: ['Some Chef'] });
      const exact = candidate(MetadataProviderKey.GOOGLE, { title: 'The Hobbit', authors: ['J.R.R. Tolkien'] });

      const result = resolveCandidateAgreement([trustedButWeak, exact], query);

      expect(result.anchor).toBe(exact);
      expect(providersOf(result.accepted)).toEqual([MetadataProviderKey.GOOGLE]);
    });

    it('falls back to trust order when the query gives no basis to score', () => {
      const first = candidate(MetadataProviderKey.GOODREADS, { title: 'Some Book' });
      const second = candidate(MetadataProviderKey.GOOGLE, { title: 'A Different Book' });

      const result = resolveCandidateAgreement([first, second], {});

      expect(result.anchor).toBe(first);
      expect(providersOf(result.rejected)).toEqual([MetadataProviderKey.GOOGLE]);
    });

    it('skips untitled candidates when choosing the anchor', () => {
      const untitled = candidate(MetadataProviderKey.ITUNES, { coverUrl: 'https://example.com/cover.jpg' });
      const titled = candidate(MetadataProviderKey.GOOGLE, { title: 'The Hobbit', authors: ['J.R.R. Tolkien'] });

      const result = resolveCandidateAgreement([untitled, titled], query);

      expect(result.anchor).toBe(titled);
      expect(result.rejected).toEqual([]);
    });

    it('accepts everything when no candidate can be scored at all', () => {
      const first = candidate(MetadataProviderKey.GOOGLE, { coverUrl: 'https://example.com/a.jpg' });
      const second = candidate(MetadataProviderKey.KOBO, { coverUrl: 'https://example.com/b.jpg' });

      const result = resolveCandidateAgreement([first, second], query);

      expect(result.anchor).toBeUndefined();
      expect(result.accepted).toEqual([first, second]);
      expect(result.rejected).toEqual([]);
    });

    it('uses displayTitle when a provider carries no plain title', () => {
      const anchor = candidate(MetadataProviderKey.COMICVINE, { displayTitle: 'Batman #7 - The Origin' });
      const agreeing = candidate(MetadataProviderKey.GOOGLE, { title: 'Batman' });
      const disagreeing = candidate(MetadataProviderKey.KOBO, { title: 'Superman Chronicles' });

      const result = resolveCandidateAgreement([anchor, agreeing, disagreeing], { title: 'Batman' });

      expect(providersOf(result.accepted)).toEqual([MetadataProviderKey.COMICVINE, MetadataProviderKey.GOOGLE]);
      expect(providersOf(result.rejected)).toEqual([MetadataProviderKey.KOBO]);
    });
  });
});
