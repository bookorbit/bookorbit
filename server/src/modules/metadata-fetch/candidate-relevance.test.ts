import { MetadataCandidate } from '@bookorbit/types';
import { describe, expect, it } from 'vitest';

import { filterAndRank } from './candidate-relevance';
import { MetadataSearchParams } from './providers/metadata-search-params';

function candidate(title: string, author?: string, isbn10?: string, isbn13?: string): MetadataCandidate {
  return {
    provider: 'google',
    providerId: Math.random().toString(),
    title,
    authors: author ? [author] : [],
    isbn10,
    isbn13,
  };
}

describe('candidate-relevance', () => {
  describe('filterAndRank', () => {
    it('returns first N candidates if no title/author query provided', () => {
      const candidates = [candidate('A'), candidate('B'), candidate('C')];
      const params: MetadataSearchParams = { isbn: '123' };
      const result = filterAndRank(candidates, params, 2);
      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('A');
      expect(result[1].title).toBe('B');
    });

    it('filters out study guides and summaries', () => {
      const candidates = [candidate('The Great Gatsby'), candidate('Summary: The Great Gatsby'), candidate('Study Guide for The Great Gatsby')];
      const params: MetadataSearchParams = { title: 'The Great Gatsby' };
      const result = filterAndRank(candidates, params);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('The Great Gatsby');
    });

    it('filters out derivative guides when the queried title appears first', () => {
      const candidates = [
        candidate('To Kill a Mockingbird'),
        candidate('To Kill a Mockingbird by Harper Lee | Summary & Analysis'),
        candidate('The Great Gatsby by F. Scott Fitzgerald (Book Analysis)'),
      ];

      const result = filterAndRank(candidates, { title: 'To Kill a Mockingbird' });

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('To Kill a Mockingbird');
    });

    it('always includes exact ISBN matches regardless of title', () => {
      const candidates = [candidate('Wrong Title', 'Wrong Author', '1234567890')];
      const params: MetadataSearchParams = { title: 'Right Title', isbn: '123-456-7890' }; // hyphens in query
      const result = filterAndRank(candidates, params);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Wrong Title');
    });

    it('normalizes ISBN in candidate before matching', () => {
      const candidates = [candidate('Title', 'Author', '123-456-789-0')]; // hyphens in candidate
      const params: MetadataSearchParams = { title: 'Different Title', isbn: '1234567890' };
      const result = filterAndRank(candidates, params);
      expect(result).toHaveLength(1);
    });

    it('ranks exact matches above partial matches', () => {
      const candidates = [candidate('The Lord of the Rings: The Fellowship of the Ring'), candidate('The Fellowship of the Ring')];
      const params: MetadataSearchParams = { title: 'The Fellowship of the Ring' };
      const result = filterAndRank(candidates, params);
      expect(result[0].title).toBe('The Fellowship of the Ring');
      expect(result[1].title).toBe('The Lord of the Rings: The Fellowship of the Ring');
    });

    it('handles candidates with missing titles or authors', () => {
      const candidates = [{ ...candidate('Valid'), title: undefined } as unknown as MetadataCandidate, candidate('Valid')];
      const params: MetadataSearchParams = { title: 'Valid' };
      const result = filterAndRank(candidates, params);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Valid');
    });

    it('respects the limit parameter', () => {
      const candidates = [candidate('Match 1'), candidate('Match 2'), candidate('Match 3')];
      const params: MetadataSearchParams = { title: 'Match' };
      const result = filterAndRank(candidates, params, 2);
      expect(result).toHaveLength(2);
    });

    it('boosts score with author match', () => {
      const candidates = [candidate('Project Hail Mary', 'Andy Weir'), candidate('Project Hail Mary', 'Someone Else')];
      const params: MetadataSearchParams = { title: 'Project Hail Mary', author: 'Andy Weir' };
      const result = filterAndRank(candidates, params);
      expect(result[0].authors).toContain('Andy Weir');
    });

    it('keeps only matching authors for an author-only search', () => {
      const candidates = [candidate('Dune', 'Frank Herbert'), candidate('The Hobbit', 'J.R.R. Tolkien')];

      const result = filterAndRank(candidates, { author: 'Frank Herbert' });

      expect(result.map((entry) => entry.title)).toEqual(['Dune']);
    });

    it('drops candidates with zero score', () => {
      const candidates = [candidate('Unrelated Book')];
      const params: MetadataSearchParams = { title: 'Different Title' };
      const result = filterAndRank(candidates, params);
      expect(result).toHaveLength(0);
    });

    it('drops an unrelated book that shares only stopwords with the query', () => {
      const candidates = [candidate('The Girl on the Train', 'Paula Hawkins'), candidate('The Silence of the Lambs', 'Thomas Harris')];
      const params: MetadataSearchParams = { title: 'The Hobbit', author: 'J.R.R. Tolkien' };
      expect(filterAndRank(candidates, params)).toHaveLength(0);
    });

    it('drops a book sharing a minority of the meaningful words', () => {
      const result = filterAndRank([candidate('The Way We Were')], { title: 'The Way of Kings' });
      expect(result).toHaveLength(0);
    });

    it('drops a candidate that merely contains the query inside a longer word', () => {
      expect(filterAndRank([candidate('Rubik Cube Solutions')], { title: 'Ubik' })).toHaveLength(0);
      expect(filterAndRank([candidate('Italian Cooking Basics')], { title: 'It' })).toHaveLength(0);
    });

    it('keeps a book actually titled with a stopword', () => {
      const result = filterAndRank([candidate('It', 'Stephen King')], { title: 'It', author: 'Stephen King' });
      expect(result).toHaveLength(1);
    });

    it('keeps a matching author from boosting an otherwise unrelated title', () => {
      const result = filterAndRank([candidate('The Girl on the Train', 'J.R.R. Tolkien')], { title: 'The Hobbit', author: 'J.R.R. Tolkien' });
      expect(result).toHaveLength(0);
    });

    it('keeps a candidate whose embedded subtitle was split out by its provider mapper', () => {
      const fullTitle = "Babel, or The Necessity of Violence: An Arcane History of the Oxford Translators' Revolution";
      const candidates = [candidate('A Different Book Entirely'), candidate('Babel, or The Necessity of Violence')];
      const result = filterAndRank(candidates, { title: fullTitle });
      expect(result[0].title).toBe('Babel, or The Necessity of Violence');
    });
  });

  describe("the book's medium", () => {
    const NOVEL = { ...candidate('The Faraway Paladin: The Boy in the City of the Dead', 'Kanata Yanagino'), mediaKind: 'ebook' as const };
    const MANGA = { ...candidate('The Faraway Paladin (Manga) Volume 1', 'Kanata Yanagino'), mediaKind: 'comic' as const };
    const query = { title: 'The Faraway Paladin Volume 1', author: 'Kanata Yanagino' };

    it('puts the novel first for an ebook and the manga first for a comic', () => {
      expect(filterAndRank([MANGA, NOVEL], { ...query, mediaKind: 'ebook' })[0]).toBe(NOVEL);
      expect(filterAndRank([NOVEL, MANGA], { ...query, mediaKind: 'comic' })[0]).toBe(MANGA);
    });

    it('keeps the other medium in the list, below', () => {
      expect(filterAndRank([MANGA, NOVEL], { ...query, mediaKind: 'ebook' })).toEqual([NOVEL, MANGA]);
    });

    it('lets a query that names the manga have it, even for an ebook', () => {
      const result = filterAndRank([NOVEL, MANGA], { ...query, title: 'The Faraway Paladin (Manga) Volume 1', mediaKind: 'ebook' });
      expect(result[0]).toBe(MANGA);
    });

    it('changes nothing when the book or the record has no medium', () => {
      expect(filterAndRank([MANGA, NOVEL], query)[0]).toBe(MANGA);
      const unlabelled = { ...MANGA, mediaKind: undefined };
      expect(filterAndRank([unlabelled, NOVEL], { ...query, mediaKind: 'ebook' })[0]).toBe(unlabelled);
    });

    it('never ranks an ISBN match down for its medium', () => {
      const edition = { ...MANGA, isbn13: '9781718356719' };
      expect(filterAndRank([NOVEL, edition], { ...query, isbn: '9781718356719', mediaKind: 'ebook' })[0]).toBe(edition);
    });
  });

  describe('displayTitle fallback', () => {
    it('matches a candidate via displayTitle when title alone would not match', () => {
      const candidates = [{ ...candidate('The Origin'), displayTitle: 'Batman #12.5 - The Origin' }];
      const result = filterAndRank(candidates, { title: 'Batman' });
      expect(result).toHaveLength(1);
    });

    it('still drops candidates when neither title nor displayTitle match', () => {
      const candidates = [{ ...candidate('The Origin'), displayTitle: 'Superman #1 - The Origin' }];
      const result = filterAndRank(candidates, { title: 'Batman' });
      expect(result).toHaveLength(0);
    });

    it('leaves title-only matching unaffected when displayTitle is absent', () => {
      const candidates = [candidate('Batman: Year One')];
      const result = filterAndRank(candidates, { title: 'Batman' });
      expect(result).toHaveLength(1);
    });

    it('boosts score with author match when the title signal came from displayTitle', () => {
      const candidates = [
        { ...candidate('The Origin', 'Andy Weir'), displayTitle: 'Batman #1 - The Origin' },
        { ...candidate('The Origin', 'Someone Else'), displayTitle: 'Batman #1 - The Origin' },
      ];
      const result = filterAndRank(candidates, { title: 'Batman', author: 'Andy Weir' });
      expect(result[0].authors).toContain('Andy Weir');
    });

    it('uses displayTitle exclusively when present, not the better of title and displayTitle', () => {
      const exactTitleOnly = candidate('Batman');
      const exactTitleWeakerDisplayTitle = { ...candidate('Batman'), displayTitle: 'Batman Chronicles Vol 1' };
      const result = filterAndRank([exactTitleWeakerDisplayTitle, exactTitleOnly], { title: 'Batman' });
      expect(result).toEqual([exactTitleOnly, exactTitleWeakerDisplayTitle]);
    });

    it('ranks an exact title match above a partial displayTitle-only match', () => {
      const candidates = [{ ...candidate('Something Else'), displayTitle: 'The Batman Chronicles' }, candidate('Batman')];
      const result = filterAndRank(candidates, { title: 'Batman' });
      expect(result[0].title).toBe('Batman');
    });

    it('ranks a candidate that has only a displayTitle, as an unnamed comic issue does', () => {
      const unnamedIssue: MetadataCandidate = { provider: 'comicvine', providerId: '1', displayTitle: 'Batman #7' };
      const result = filterAndRank([unnamedIssue], { title: 'Batman' });
      expect(result).toEqual([unnamedIssue]);
    });

    it('drops a candidate with neither title nor displayTitle', () => {
      const result = filterAndRank([{ provider: 'comicvine', providerId: '1' }], { title: 'Batman' });
      expect(result).toHaveLength(0);
    });

    it('applies the skip patterns to the same string it scores, so a named issue survives', () => {
      const candidates = [{ ...candidate('Guide to Gotham'), displayTitle: 'Batman #4 - Guide to Gotham' }];
      const result = filterAndRank(candidates, { title: 'Batman' });
      expect(result).toHaveLength(1);
    });

    it('still drops a genuine study guide that carries a displayTitle', () => {
      const candidates = [{ ...candidate('The Great Gatsby'), displayTitle: 'Study Guide for The Great Gatsby' }];
      const result = filterAndRank(candidates, { title: 'The Great Gatsby' });
      expect(result).toHaveLength(0);
    });
  });

  describe('ComicVine issue identity', () => {
    function comic(id: string, title: string | undefined, seriesName = 'Generation X', issueNumber = '1'): MetadataCandidate {
      return {
        provider: 'comicvine',
        providerId: id,
        title,
        displayTitle: `${seriesName} #${issueNumber}${title ? ` - ${title}` : ''}`,
        seriesName,
        seriesIndex: issueNumber,
        comicMetadata: { volumeName: seriesName, issueNumber },
      };
    }

    it.each(['Generation X #1', 'Generation X #01'])('does not penalize a named original issue for query %s', (title) => {
      const original = comic('39935', 'Third Genesis');
      const reprint = comic('325232', undefined);

      expect(filterAndRank([original, reprint], { title })).toEqual([original, reprint]);
    });

    it('uses stored series and fractional issue context when the title is only an issue name', () => {
      const match = comic('1', 'The Origin', 'Batman', '12.5');
      expect(filterAndRank([match], { title: 'The Origin', seriesName: 'Batman', seriesIndex: '12.5' })).toEqual([match]);
    });

    it('rejects a different issue even when the series name is an exact match', () => {
      expect(filterAndRank([comic('1', undefined, 'Generation X', '2')], { title: 'Generation X #1' })).toEqual([]);
    });

    it('ranks exact series ahead of collections without using the issue subtitle', () => {
      const original = comic('1', 'Third Genesis');
      const collection = comic('2', undefined, 'Counter X: Generation X: Four Days');
      expect(filterAndRank([collection, original], { title: 'Generation X #1' })).toEqual([original, collection]);
    });

    it('honors a typed series over stored series context', () => {
      const stored = comic('1', 'The Origin', 'Batman');
      const requested = comic('2', undefined, 'Superman');
      expect(filterAndRank([stored, requested], { title: 'Superman', titleIsExplicitQuery: true, seriesName: 'Batman', seriesIndex: '1' })).toEqual([
        requested,
      ]);
    });

    it('keeps issue zero and a leading article match addressable', () => {
      const match = comic('1', 'The Beginning', 'The Batman', '0');
      expect(filterAndRank([match], { title: 'Batman #000' })).toEqual([match]);
    });

    it.each(['進撃の巨人', 'Élan'])('keeps non-ASCII series identity intact for %s', (seriesName) => {
      const match = comic('1', 'Issue subtitle', seriesName);
      expect(filterAndRank([match], { title: `${seriesName} #01` })).toEqual([match]);
    });

    it('retains author evidence without preferring an unnamed issue', () => {
      const match = { ...comic('1', 'Third Genesis'), authors: ['Scott Lobdell'] };
      const other = { ...comic('2', undefined), authors: ['Someone Else'] };
      expect(filterAndRank([other, match], { title: 'Generation X #1', author: 'Scott Lobdell' })).toEqual([match, other]);
    });

    it('still matches an issue-name query without stored series context', () => {
      const match = comic('1', 'Third Genesis');
      expect(filterAndRank([match], { title: 'Third Genesis' })).toEqual([match]);
    });
  });

  describe('scoreTitle', () => {
    it('gives highest score to exact matches', () => {
      const params: MetadataSearchParams = { title: 'Foundation' };
      const result = filterAndRank([candidate('Foundation')], params);
      expect(result).toHaveLength(1);
    });

    it('supports fuzzy matching via levenshtein', () => {
      const params: MetadataSearchParams = { title: 'Foundatun' }; // typo
      const result = filterAndRank([candidate('Foundation')], params);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Foundation');
    });

    it('supports token overlap', () => {
      const params: MetadataSearchParams = { title: 'The Way of Kings' };
      const result = filterAndRank([candidate('Kings Way')], params);
      expect(result).toHaveLength(1);
    });
  });
});
