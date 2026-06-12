import { BadRequestException } from '@nestjs/common';

import { BookQueryPipe } from './book-query.pipe';

describe('BookQueryPipe', () => {
  let pipe: BookQueryPipe;

  beforeEach(() => {
    pipe = new BookQueryPipe();
  });

  it('returns defaults for null input', () => {
    const result = pipe.transform(null);
    expect(result.sort).toEqual([]);
    expect(result.pagination).toEqual({ page: 0, size: 50 });
    expect(result.filter).toBeUndefined();
  });

  it('returns defaults for undefined input', () => {
    const result = pipe.transform(undefined);
    expect(result.pagination.page).toBe(0);
    expect(result.pagination.size).toBe(50);
  });

  it('returns defaults for empty object input', () => {
    const result = pipe.transform({});
    expect(result.sort).toEqual([]);
    expect(result.pagination).toEqual({ page: 0, size: 50 });
  });

  it('accepts valid sort with direction', () => {
    const result = pipe.transform({ sort: [{ field: 'title', dir: 'asc' }] });
    expect(result.sort).toEqual([{ field: 'title', dir: 'asc' }]);
  });

  it('accepts valid pagination overrides', () => {
    const result = pipe.transform({ pagination: { page: 2, size: 100 } });
    expect(result.pagination.page).toBe(2);
    expect(result.pagination.size).toBe(100);
  });

  it('accepts a valid filter group rule', () => {
    const result = pipe.transform({
      filter: {
        type: 'group',
        join: 'AND',
        rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }],
      },
    });
    expect(result.filter).toBeDefined();
  });

  it('throws BadRequestException for invalid sort field', () => {
    expect(() => pipe.transform({ sort: [{ field: 'unknownField', dir: 'asc' }] })).toThrow(BadRequestException);
  });

  it('throws BadRequestException for invalid sort direction', () => {
    expect(() => pipe.transform({ sort: [{ field: 'title', dir: 'sideways' }] })).toThrow(BadRequestException);
  });

  it('accepts readStatus as a valid sort field', () => {
    const result = pipe.transform({ sort: [{ field: 'readStatus', dir: 'asc' }] });
    expect(result.sort).toEqual([{ field: 'readStatus', dir: 'asc' }]);
  });

  it('accepts format as a valid sort field', () => {
    const result = pipe.transform({ sort: [{ field: 'format', dir: 'desc' }] });
    expect(result.sort).toEqual([{ field: 'format', dir: 'desc' }]);
  });

  it('throws BadRequestException for more than 5 sort entries', () => {
    const sort = ['title', 'author', 'series', 'addedAt', 'publishedYear', 'pageCount'].map((field) => ({ field, dir: 'asc' }));
    expect(() => pipe.transform({ sort })).toThrow(BadRequestException);
  });

  it('throws BadRequestException for page size below 1', () => {
    expect(() => pipe.transform({ pagination: { page: 0, size: 0 } })).toThrow(BadRequestException);
  });

  it('throws BadRequestException for page size above 200', () => {
    expect(() => pipe.transform({ pagination: { page: 0, size: 201 } })).toThrow(BadRequestException);
  });

  it('throws BadRequestException for negative page number', () => {
    expect(() => pipe.transform({ pagination: { page: -1, size: 50 } })).toThrow(BadRequestException);
  });

  it('throws BadRequestException for invalid filter structure', () => {
    expect(() =>
      pipe.transform({
        filter: { type: 'group', join: 'AND', rules: [] },
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts valid q string', () => {
    const result = pipe.transform({ q: 'tolkien' });
    expect(result.q).toBe('tolkien');
  });

  it('passes through without q', () => {
    const result = pipe.transform({});
    expect(result.q).toBeUndefined();
  });

  it('rejects q longer than 200 characters', () => {
    expect(() => pipe.transform({ q: 'a'.repeat(201) })).toThrow(BadRequestException);
  });

  it('accepts q at exactly 200 characters', () => {
    const result = pipe.transform({ q: 'a'.repeat(200) });
    expect(result.q).toHaveLength(200);
  });

  it('accepts all valid sort fields', () => {
    const validFields = [
      'author',
      'title',
      'series',
      'seriesIndex',
      'addedAt',
      'updatedAt',
      'publishedYear',
      'pageCount',
      'rating',
      'language',
      'metadataScore',
    ];
    for (const field of validFields) {
      expect(() => pipe.transform({ sort: [{ field, dir: 'desc' }] })).not.toThrow();
    }
  });

  it('accepts metadataScore and language sort entries together', () => {
    const result = pipe.transform({
      sort: [
        { field: 'metadataScore', dir: 'desc' },
        { field: 'language', dir: 'asc' },
      ],
    });

    expect(result.sort).toEqual([
      { field: 'metadataScore', dir: 'desc' },
      { field: 'language', dir: 'asc' },
    ]);
  });

  it('accepts deep pagination window required for virtual window loading', () => {
    const result = pipe.transform({ pagination: { page: 5000, size: 200 } });
    expect(result.pagination.page).toBe(5000);
    expect(result.pagination.size).toBe(200);
  });

  it('rejects a pagination window that exceeds the raised offset cap', () => {
    expect(() => pipe.transform({ pagination: { page: 6000, size: 200 } })).toThrow(BadRequestException);
  });
});
