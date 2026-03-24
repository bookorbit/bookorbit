import { MetadataCandidate } from '@projectx/types';
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

    it('always includes exact ISBN matches regardless of title', () => {
      const candidates = [candidate('Wrong Title', 'Wrong Author', '1234567890')];
      const params: MetadataSearchParams = { title: 'Right Title', isbn: '123-456-7890' }; // hyphens in query
      const result = filterAndRank(candidates, params);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Wrong Title');
    });

    it('normalizes ISBN in candidate before matching', () => {
      const candidates = [candidate('Title', 'Author', '123-456-789-0')]; // hyphens in candidate
      const params: MetadataSearchParams = { isbn: '1234567890' };
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

    it('drops candidates with zero score', () => {
      const candidates = [candidate('Unrelated Book')];
      const params: MetadataSearchParams = { title: 'Different Title' };
      const result = filterAndRank(candidates, params);
      expect(result).toHaveLength(0);
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
