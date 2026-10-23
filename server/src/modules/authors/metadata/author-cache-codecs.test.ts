import type { AuthorMetadataCandidate } from '@bookorbit/types';

import { AUTHOR_CANDIDATE_FIELDS, authorLookupCodec, authorSearchCodec } from './author-cache-codecs';

const FULL: AuthorMetadataCandidate = {
  provider: 'goodreads',
  providerId: '42',
  name: 'Jane Doe',
  description: 'Bio',
  imageUrl: 'https://img.example/jane.jpg',
  sourceUrl: 'https://www.goodreads.com/author/show/42',
  birthDate: '1929-10-21',
  birthYear: 1929,
  deathDate: '2018-01-22',
  deathYear: 2018,
  website: 'https://jane.example',
  genres: ['Fantasy'],
  influences: ['Someone'],
};

describe('author cache codecs', () => {
  it('allow-lists every candidate field', () => {
    expect(Object.keys(AUTHOR_CANDIDATE_FIELDS).sort()).toEqual(Object.keys(FULL).sort());
  });

  describe('search codec', () => {
    it('keeps every known field and drops unknown ones', () => {
      const withExtra = { ...FULL, cache: { fetchedAt: 'x', stale: false }, secret: 'nope' } as AuthorMetadataCandidate;

      expect(authorSearchCodec.sanitize([withExtra])).toEqual([FULL]);
    });

    it('round-trips through JSON', () => {
      const stored = JSON.parse(JSON.stringify(authorSearchCodec.sanitize([FULL]))) as unknown;

      expect(authorSearchCodec.parse(stored)).toEqual([FULL]);
    });

    it('rejects payloads that do not have the candidate shape', () => {
      expect(authorSearchCodec.parse(null)).toBeUndefined();
      expect(authorSearchCodec.parse({})).toBeUndefined();
      expect(authorSearchCodec.parse(['x'])).toBeUndefined();
      expect(authorSearchCodec.parse([{ provider: 'goodreads', providerId: '42' }])).toBeUndefined();
      expect(authorSearchCodec.parse([{ provider: 'goodreads', providerId: 42, name: 'Jane' }])).toBeUndefined();
      expect(authorSearchCodec.parse([{ provider: 1, providerId: '42', name: 'Jane' }])).toBeUndefined();
      expect(authorSearchCodec.parse([FULL, { provider: 'goodreads' }])).toBeUndefined();
    });

    it('drops unknown fields while parsing', () => {
      expect(authorSearchCodec.parse([{ provider: 'audnexus', providerId: 'A1', name: 'Jane', extra: true }])).toEqual([
        { provider: 'audnexus', providerId: 'A1', name: 'Jane' },
      ]);
    });

    it('rejects known fields of the wrong type and reads null as absent', () => {
      expect(authorSearchCodec.parse([{ ...FULL, genres: 'Fantasy' }])).toBeUndefined();
      expect(authorSearchCodec.parse([{ ...FULL, birthYear: '1929' }])).toBeUndefined();
      expect(authorSearchCodec.parse([{ ...FULL, website: null }])?.[0]).not.toHaveProperty('website');
    });

    it('treats an empty list as empty and slices to the cap', () => {
      const second = { ...FULL, providerId: '43' };

      expect(authorSearchCodec.isEmpty([])).toBe(true);
      expect(authorSearchCodec.isEmpty([FULL])).toBe(false);
      expect(authorSearchCodec.slice([FULL, second], 1)).toEqual([FULL]);
      expect(authorSearchCodec.publishedDates([FULL])).toEqual([]);
    });
  });

  describe('lookup codec', () => {
    it('handles a found and a missing candidate', () => {
      expect(authorLookupCodec.isEmpty(null)).toBe(true);
      expect(authorLookupCodec.isEmpty(FULL)).toBe(false);
      expect(authorLookupCodec.sanitize(null)).toBeNull();
      expect(authorLookupCodec.sanitize({ ...FULL, extra: 1 } as AuthorMetadataCandidate)).toEqual(FULL);
      expect(authorLookupCodec.parse(JSON.parse(JSON.stringify(FULL)))).toEqual(FULL);
      expect(authorLookupCodec.parse({ provider: 'goodreads' })).toBeUndefined();
      expect(authorLookupCodec.slice(FULL, 0)).toBe(FULL);
      expect(authorLookupCodec.publishedDates(FULL)).toEqual([]);
    });
  });
});
