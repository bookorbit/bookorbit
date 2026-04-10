import {
  buildContributorValues,
  buildMetadataPatch,
  buildSourceFileTargetMap,
  clampNonNegative,
  clampPercent,
  emptyCounters,
  getSourceContributors,
  hasErrorCode,
  normalizeReadStatus,
  pruneUndefined,
  toDate,
  truncateNullableText,
  truncateText,
  uniqueNumbers,
} from './executor-utils';

describe('migration executor utils', () => {
  it('returns zeroed stage counters and unique finite numbers', () => {
    expect(emptyCounters()).toEqual({ processed: 0, imported: 0, skipped: 0, unresolved: 0, failed: 0 });
    expect(uniqueNumbers([1, 2, 2, Number.NaN, Infinity, 3])).toEqual([1, 2, 3]);
  });

  it('maps source files to target file ids using unique hash and mapped path fallback', () => {
    const planned = {
      execution: {
        sourceData: {
          books: [
            {
              sourceBookId: 's1',
              files: [
                { sourceFileId: 'f-hash', fileHash: 'hash-1', filePath: '/source/hash.epub' },
                { sourceFileId: 'f-path', fileHash: null, filePath: '/source/path.epub' },
                { sourceFileId: 'f-ambiguous', fileHash: 'hash-ambiguous', filePath: '/source/amb.epub' },
              ],
            },
          ],
        },
        matchedBooks: [{ sourceBookId: 's1', targetBookId: 11 }],
      },
      plan: {
        pathMappings: [{ sourcePrefix: '/source', targetPrefix: '/target' }],
      },
    };

    const targetFilesByBookId = new Map([
      [
        11,
        [
          { id: 101, hash: 'hash-1', absolutePath: '/target/hash.epub' },
          { id: 102, hash: null, absolutePath: '/target/path.epub' },
          { id: 201, hash: 'hash-ambiguous', absolutePath: '/target/other.epub' },
          { id: 202, hash: 'hash-ambiguous', absolutePath: '/target/second.epub' },
          { id: 103, hash: null, absolutePath: '/target/amb.epub' },
        ],
      ],
    ]);

    const map = buildSourceFileTargetMap(planned as never, targetFilesByBookId);

    expect(map.get('f-hash')).toBe(101);
    expect(map.get('f-path')).toBe(102);
    expect(map.get('f-ambiguous')).toBe(103);
  });

  it('sanitizes metadata patch values and honors presentFields', () => {
    const patch = buildMetadataPatch({
      title: 'A',
      subtitle: 'B',
      isbn10: '1234567890',
      isbn13: '1234567890123',
      description: 'desc',
      publisher: 'publisher',
      publishedYear: 2600,
      language: 'english',
      pageCount: -1,
      seriesName: 'Series',
      seriesIndex: 1.4,
      rating: 11,
      googleBooksId: 'g',
      goodreadsId: 'gr',
      amazonId: 'amz',
      hardcoverId: 'hc',
      audibleId: 'aud',
      comicvineId: 'cv',
      durationSeconds: 3601.7,
      abridged: null,
      presentFields: ['title', 'subtitle', 'publishedYear', 'pageCount', 'durationSeconds', 'abridged'],
    });

    expect(patch).toEqual({
      title: 'A',
      subtitle: 'B',
      publishedYear: null,
      pageCount: null,
      durationSeconds: 3602,
      abridged: false,
    });
  });

  it('builds contributor values with truncation and defaulted sort name', () => {
    const values = buildContributorValues({
      name: 'Name',
      sortName: null,
      description: 'Bio',
    });

    expect(values).toEqual({
      name: 'Name',
      sortName: 'Name',
      description: 'Bio',
    });
  });

  it('derives source contributors from structured data then falls back to parsed legacy names', () => {
    const structured = getSourceContributors(
      [
        { name: ' B ', sortName: 'Bee', description: null, displayOrder: 2 },
        { name: 'A', sortName: null, description: 'Bio', displayOrder: 1 },
        { name: 'a', sortName: null, description: null, displayOrder: 3 },
      ],
      null,
    );

    expect(structured).toEqual([
      { name: 'A', sortName: null, description: 'Bio' },
      { name: 'B', sortName: 'Bee', description: null },
    ]);

    const legacy = getSourceContributors(undefined, '["Ann", "Bob", "ann"]');
    expect(legacy).toEqual([
      { name: 'Ann', sortName: 'Ann', description: null },
      { name: 'Bob', sortName: 'Bob', description: null },
    ]);
  });

  it('prunes undefined keys and recognizes error codes', () => {
    expect(pruneUndefined({ a: 1, b: undefined, c: null })).toEqual({ a: 1, c: null });
    expect(hasErrorCode({ code: '23505' }, '23505')).toBe(true);
    expect(hasErrorCode({ code: 'x' }, '23505')).toBe(false);
    expect(hasErrorCode(null, 'x')).toBe(false);
  });

  it('parses dates and clamps progress percentages', () => {
    expect(toDate('2026-01-01T00:00:00.000Z')).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(toDate('bad-date')).toBeNull();
    expect(toDate(null)).toBeNull();

    expect(clampPercent(null)).toBe(0);
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(12.5)).toBe(12.5);
    expect(clampPercent(150)).toBe(100);

    expect(clampNonNegative(null)).toBe(0);
    expect(clampNonNegative(-2)).toBe(0);
    expect(clampNonNegative(9)).toBe(9);
  });

  it('truncates text helpers and normalizes read status from status/percentage', () => {
    expect(truncateText('abcdef', 4)).toBe('abcd');
    expect(truncateText('abc', 4)).toBe('abc');
    expect(truncateNullableText(undefined, 2)).toBeUndefined();
    expect(truncateNullableText(null, 2)).toBeNull();
    expect(truncateNullableText('abcd', 3)).toBe('abc');

    expect(normalizeReadStatus('completed', null)).toBe('read');
    expect(normalizeReadStatus('in_progress', null)).toBe('reading');
    expect(normalizeReadStatus('paused', null)).toBe('on_hold');
    expect(normalizeReadStatus('wishlist', null)).toBe('want_to_read');
    expect(normalizeReadStatus('unknown', 99)).toBe('read');
    expect(normalizeReadStatus('unknown', 10)).toBe('reading');
    expect(normalizeReadStatus('unknown', 0)).toBe('unread');
  });
});
