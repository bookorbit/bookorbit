import { groupDuplicatePairs, type DuplicateGroupingPair } from './book-duplicate-grouping';

const exact = (bookIdA: number, bookIdB: number): DuplicateGroupingPair => ({
  bookIdA,
  bookIdB,
  reasons: ['exact_metadata', 'fuzzy_metadata'],
  titleSimilarity: 1,
});
const fuzzy = (bookIdA: number, bookIdB: number, titleSimilarity: number): DuplicateGroupingPair => ({
  bookIdA,
  bookIdB,
  reasons: ['fuzzy_metadata'],
  titleSimilarity,
});

describe('groupDuplicatePairs', () => {
  it('chains copies that agree on series position into one group rooted at the lowest id', () => {
    const roots = groupDuplicatePairs(
      [fuzzy(4, 9, 0.9), exact(9, 12)],
      [
        { bookId: 4, seriesId: 1, seriesIndex: '1' },
        { bookId: 12, seriesId: 1, seriesIndex: '1.0' },
      ],
    );

    expect(Object.fromEntries(roots)).toEqual({ 4: 4, 9: 4, 12: 4 });
  });

  it('never lets a copy without series data bridge two volumes, keeping its strongest match', () => {
    const positions = [
      { bookId: 1, seriesId: 7, seriesIndex: '1' },
      { bookId: 2, seriesId: 7, seriesIndex: '2' },
    ];

    expect(Object.fromEntries(groupDuplicatePairs([fuzzy(2, 3, 0.91), exact(1, 3)], positions))).toEqual({ 1: 1, 3: 1 });
    expect(Object.fromEntries(groupDuplicatePairs([fuzzy(1, 3, 0.88), fuzzy(2, 3, 0.95)], positions))).toEqual({ 2: 2, 3: 2 });
  });

  it('refuses a join between groups that each already hold a different position', () => {
    const roots = groupDuplicatePairs(
      [exact(1, 2), exact(3, 4), fuzzy(2, 3, 0.9)],
      [
        { bookId: 1, seriesId: 7, seriesIndex: '4' },
        { bookId: 4, seriesId: 7, seriesIndex: '5' },
      ],
    );

    expect(Object.fromEntries(roots)).toEqual({ 1: 1, 2: 1, 3: 3, 4: 3 });
  });

  it('joins matching file hashes even when their series positions disagree', () => {
    const roots = groupDuplicatePairs(
      [{ bookIdA: 5, bookIdB: 6, reasons: ['file_hash'], titleSimilarity: null }],
      [
        { bookId: 5, seriesId: 2, seriesIndex: '1' },
        { bookId: 6, seriesId: 2, seriesIndex: '2' },
      ],
    );

    expect(Object.fromEntries(roots)).toEqual({ 5: 5, 6: 5 });
  });
});
