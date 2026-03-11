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

  it('accepts all valid sort fields', () => {
    const validFields = ['author', 'title', 'series', 'seriesIndex', 'addedAt', 'updatedAt', 'publishedYear', 'pageCount', 'rating'];
    for (const field of validFields) {
      expect(() => pipe.transform({ sort: [{ field, dir: 'desc' }] })).not.toThrow();
    }
  });
});
