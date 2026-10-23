import { describe, expect, it } from 'vitest';

import { buildPatternTokens, patternReferencesToken } from './pattern-tokens.utils';

describe('pattern-tokens.utils', () => {
  describe('buildPatternTokens', () => {
    it('uses either ISBN for the naming token and prefers ISBN-13', () => {
      const input = { authors: [], originalStem: 'book', format: 'mobi' };
      expect(buildPatternTokens({ ...input, metadata: { isbn10: '097522980X' } }).isbn).toBe('097522980X');
      expect(buildPatternTokens({ ...input, metadata: { isbn10: '0306406152', isbn13: '9780306406157' } }).isbn).toBe('9780306406157');
      expect(buildPatternTokens({ ...input, metadata: { isbn10: '0306406152', isbn13: ' ' } }).isbn).toBe('0306406152');
    });

    const metadata = {
      title: 'Dune',
      subtitle: 'A Novel',
      publisher: 'Ace',
      language: 'en',
      isbn13: '9780441172719',
      publishedYear: 1965,
      seriesName: 'Dune Chronicles',
      seriesIndex: '1',
    };

    it('builds all tokens from full metadata', () => {
      const tokens = buildPatternTokens({ metadata, authors: ['Frank Herbert'], originalStem: 'dune', format: 'epub' });

      expect(tokens).toEqual({
        originalFilename: 'dune',
        extension: 'epub',
        title: 'Dune',
        subtitle: 'A Novel',
        publisher: 'Ace',
        language: 'en',
        isbn: '9780441172719',
        year: '1965',
        series: 'Dune Chronicles',
        seriesIndex: '01',
        authors: 'Frank Herbert',
      });
    });

    it('joins multiple authors with comma', () => {
      const tokens = buildPatternTokens({ metadata, authors: ['Author A', 'Author B'], originalStem: 'book', format: 'pdf' });
      expect(tokens['authors']).toBe('Author A, Author B');
    });

    it('joins multiple narrators with comma', () => {
      const tokens = buildPatternTokens({ metadata, narrators: ['Simon Vance', 'Scott Brick'], originalStem: 'dune', format: 'm4b' });
      expect(tokens['narrators']).toBe('Simon Vance, Scott Brick');
    });

    it('omits narrators when none are given', () => {
      expect(buildPatternTokens({ metadata, originalStem: 'dune', format: 'epub' })['narrators']).toBeUndefined();
      expect(buildPatternTokens({ metadata, narrators: [], originalStem: 'dune', format: 'epub' })['narrators']).toBeUndefined();
    });

    it('includes the library token when a library name is given', () => {
      const tokens = buildPatternTokens({ metadata, originalStem: 'dune', format: 'epub', libraryName: 'Science Fiction' });
      expect(tokens['library']).toBe('Science Fiction');
    });

    it('omits the library token when no library name is given', () => {
      expect(buildPatternTokens({ metadata, originalStem: 'dune', format: 'epub' })['library']).toBeUndefined();
      expect(buildPatternTokens({ metadata, originalStem: 'dune', format: 'epub', libraryName: '' })['library']).toBeUndefined();
    });

    it('omits tokens for null metadata fields', () => {
      const tokens = buildPatternTokens({
        metadata: {
          title: null,
          subtitle: null,
          publisher: null,
          language: null,
          isbn13: null,
          publishedYear: null,
          seriesName: null,
          seriesIndex: null,
        },
        originalStem: 'file',
        format: 'epub',
      });

      expect(tokens).toEqual({ originalFilename: 'file', extension: 'epub' });
    });

    it('includes only non-null fields', () => {
      const tokens = buildPatternTokens({
        metadata: { title: 'Test', publishedYear: 2023 },
        originalStem: 'test',
        format: 'pdf',
      });

      expect(Object.keys(tokens).sort()).toEqual(['extension', 'originalFilename', 'title', 'year'].sort());
    });

    it('formats decimal series index tokens without precision artifacts', () => {
      const tokens = buildPatternTokens({ metadata: { ...metadata, seriesIndex: '5.02' }, originalStem: 'book', format: 'epub' });

      expect(tokens['seriesIndex']).toBe('05.02');
    });

    it('normalizes legacy numeric series indexes and omits malformed runtime values', () => {
      const legacy = buildPatternTokens({
        metadata: { ...metadata, seriesIndex: 3 } as never,
        originalStem: 'book',
        format: 'epub',
      });
      const malformed = buildPatternTokens({
        metadata: { ...metadata, seriesIndex: 'volume-three' } as never,
        originalStem: 'book',
        format: 'epub',
      });

      expect(legacy['seriesIndex']).toBe('03');
      expect(malformed['seriesIndex']).toBeUndefined();
    });

    it('emits readaloud only for an EPUB with media overlays', () => {
      expect(buildPatternTokens({ metadata, originalStem: 'book', format: 'epub', mediaOverlayAvailable: true })['readaloud']).toBe('readaloud');
      expect(buildPatternTokens({ metadata, originalStem: 'book', format: 'EPUB', mediaOverlayAvailable: true })['readaloud']).toBe('readaloud');
      expect(buildPatternTokens({ metadata, originalStem: 'book', format: 'epub', mediaOverlayAvailable: false })['readaloud']).toBeUndefined();
      expect(buildPatternTokens({ metadata, originalStem: 'book', format: 'm4b', mediaOverlayAvailable: true })['readaloud']).toBeUndefined();
    });
  });

  describe('patternReferencesToken', () => {
    it('matches a token with or without a modifier', () => {
      expect(patternReferencesToken('{title}< ({readaloud})>', 'readaloud')).toBe(true);
      expect(patternReferencesToken('{readaloud:upper}', 'readaloud')).toBe(true);
    });

    it('does not match a prefix, literal text, or another token', () => {
      expect(patternReferencesToken('{readaloudEdition}', 'readaloud')).toBe(false);
      expect(patternReferencesToken('readaloud {title}', 'readaloud')).toBe(false);
      expect(patternReferencesToken('{title}', 'readaloud')).toBe(false);
    });
  });
});
