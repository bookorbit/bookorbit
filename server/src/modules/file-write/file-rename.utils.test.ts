import { buildTokens, formatSeriesIndex } from './file-rename.utils';

describe('file-rename.utils', () => {
  describe('formatSeriesIndex', () => {
    it('returns null for null input', () => {
      expect(formatSeriesIndex(null)).toBeNull();
    });

    it('formats whole number with zero-padding', () => {
      expect(formatSeriesIndex(1)).toBe('01');
      expect(formatSeriesIndex(5)).toBe('05');
      expect(formatSeriesIndex(12)).toBe('12');
    });

    it('formats fractional index correctly', () => {
      expect(formatSeriesIndex(1.5)).toBe('01.5');
      expect(formatSeriesIndex(3.25)).toBe('03.25');
      expect(formatSeriesIndex(5.02)).toBe('05.02');
      expect(formatSeriesIndex(5.08)).toBe('05.08');
      expect(formatSeriesIndex(5.09)).toBe('05.09');
      expect(formatSeriesIndex(5.1)).toBe('05.1');
      expect(formatSeriesIndex(5.11)).toBe('05.11');
    });

    it('formats zero correctly', () => {
      expect(formatSeriesIndex(0)).toBe('00');
    });

    it('formats large numbers', () => {
      expect(formatSeriesIndex(100)).toBe('100');
    });
  });

  describe('buildTokens', () => {
    const fullMetadata = {
      title: 'Dune',
      subtitle: 'A Novel',
      publisher: 'Ace',
      language: 'en',
      isbn13: '9780441172719',
      publishedYear: 1965,
      seriesName: 'Dune Chronicles',
      seriesIndex: 1,
    };

    it('builds all tokens from full metadata', () => {
      const tokens = buildTokens(fullMetadata, ['Frank Herbert'], 'dune', 'epub');

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
      const tokens = buildTokens(fullMetadata, ['Author A', 'Author B'], 'book', 'pdf');
      expect(tokens['authors']).toBe('Author A, Author B');
    });

    it('omits tokens for null metadata fields', () => {
      const emptyMetadata = {
        title: null,
        subtitle: null,
        publisher: null,
        language: null,
        isbn13: null,
        publishedYear: null,
        seriesName: null,
        seriesIndex: null,
      };

      const tokens = buildTokens(emptyMetadata, [], 'file', 'epub');
      expect(tokens).toEqual({ originalFilename: 'file', extension: 'epub' });
    });

    it('omits authors when array is empty', () => {
      const tokens = buildTokens(fullMetadata, [], 'book', 'epub');
      expect(tokens['authors']).toBeUndefined();
    });

    it('includes only non-null fields', () => {
      const partialMetadata = {
        title: 'Test',
        subtitle: null,
        publisher: null,
        language: null,
        isbn13: null,
        publishedYear: 2023,
        seriesName: null,
        seriesIndex: null,
      };

      const tokens = buildTokens(partialMetadata, [], 'test', 'pdf');
      expect(Object.keys(tokens).sort()).toEqual(['extension', 'originalFilename', 'title', 'year'].sort());
    });

    it('formats decimal series index tokens without precision artifacts', () => {
      const tokens = buildTokens({ ...fullMetadata, seriesIndex: 5.02 }, [], 'book', 'epub');

      expect(tokens['seriesIndex']).toBe('05.02');
    });
  });
});
