import { DEFAULT_METADATA_SCORE_WEIGHTS, type MetadataScoreWeights } from '@projectx/types';

import { MetadataScoreScorer, type ScoreData } from './metadata-score.scorer';

function makeData(overrides: Partial<ScoreData> = {}): ScoreData {
  return {
    title: null,
    subtitle: null,
    description: null,
    isbn10: null,
    isbn13: null,
    publisher: null,
    publishedYear: null,
    language: null,
    pageCount: null,
    seriesName: null,
    seriesIndex: null,
    rating: null,
    coverSource: null,
    googleBooksId: null,
    goodreadsId: null,
    amazonId: null,
    hardcoverId: null,
    openLibraryId: null,
    itunesId: null,
    authorCount: 0,
    genreCount: 0,
    tagCount: 0,
    ...overrides,
  };
}

describe('MetadataScoreScorer', () => {
  const scorer = new MetadataScoreScorer();

  it('returns 0 when total weight is zero', () => {
    const zeroWeights = Object.fromEntries(Object.keys(DEFAULT_METADATA_SCORE_WEIGHTS).map((key) => [key, 0])) as MetadataScoreWeights;

    expect(scorer.compute(makeData({ title: 'Dune' }), zeroWeights)).toBe(0);
  });

  it('treats whitespace-only strings as missing values', () => {
    const data = makeData({ title: '   ' });

    expect(scorer.compute(data, DEFAULT_METADATA_SCORE_WEIGHTS)).toBe(0);
  });

  it('awards points for counts and positive numeric values only', () => {
    const data = makeData({
      authorCount: 1,
      genreCount: 2,
      tagCount: 3,
      publishedYear: 2020,
      pageCount: 450,
      rating: 4.5,
      seriesIndex: 1,
    });
    const weights: MetadataScoreWeights = {
      ...DEFAULT_METADATA_SCORE_WEIGHTS,
      authors: 10,
      genres: 10,
      tags: 10,
      publishedYear: 10,
      pageCount: 10,
      rating: 10,
      seriesIndex: 10,
      title: 0,
      subtitle: 0,
      description: 0,
      coverSource: 0,
      isbn13: 0,
      publisher: 0,
      language: 0,
      isbn10: 0,
      seriesName: 0,
      googleBooksId: 0,
      goodreadsId: 0,
      amazonId: 0,
      hardcoverId: 0,
      openLibraryId: 0,
      itunesId: 0,
    };

    expect(scorer.compute(data, weights)).toBe(100);
    expect(scorer.compute(makeData({ publishedYear: 0, pageCount: -1, rating: 0 }), weights)).toBe(0);
  });

  it('ignores non-finite and non-positive weights while computing total', () => {
    const weights: MetadataScoreWeights = {
      ...DEFAULT_METADATA_SCORE_WEIGHTS,
      title: Number.NaN,
      authors: -5,
      coverSource: 10,
      description: 0,
      subtitle: 0,
      genres: 0,
      isbn13: 0,
      publisher: 0,
      publishedYear: 0,
      language: 0,
      isbn10: 0,
      pageCount: 0,
      rating: 0,
      seriesName: 0,
      seriesIndex: 0,
      tags: 0,
      googleBooksId: 0,
      goodreadsId: 0,
      amazonId: 0,
      hardcoverId: 0,
      openLibraryId: 0,
      itunesId: 0,
    };

    expect(scorer.compute(makeData({ title: 'Dune', coverSource: 'extracted', authorCount: 10 }), weights)).toBe(100);
  });
});
