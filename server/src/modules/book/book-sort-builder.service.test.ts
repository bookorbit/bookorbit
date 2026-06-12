vi.mock('drizzle-orm', () => {
  const sqlTag = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', text: strings.join(''), values })),
    {
      raw: vi.fn((value: string) => ({ type: 'raw', value })),
    },
  );

  return {
    sql: sqlTag,
  };
});

import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { BookSortBuilder } from './book-sort-builder.service';

describe('BookSortBuilder', () => {
  let service: BookSortBuilder;

  beforeEach(() => {
    service = new BookSortBuilder();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('returns default title sort when no sorts are provided', () => {
    const result = service.build([]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: 'sql', text: ' ASC NULLS LAST' });
  });

  it('builds simple field sorts for title asc and desc', () => {
    const raw = (sql as unknown as { raw: vi.Mock }).raw;

    const ascResult = service.build([{ field: 'title', dir: 'asc' }]);
    const descResult = service.build([{ field: 'title', dir: 'desc' }]);

    expect(ascResult).toHaveLength(2);
    expect(descResult).toHaveLength(2);
    expect(raw).toHaveBeenNthCalledWith(1, 'ASC');
    expect(raw).toHaveBeenNthCalledWith(2, 'DESC');
  });

  it('builds author sort with the denormalized sort key', () => {
    const raw = (sql as unknown as { raw: vi.Mock }).raw;

    const result = service.build([{ field: 'author', dir: 'asc' }]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: 'sql', text: '  NULLS LAST' });
    expect(raw).toHaveBeenCalledWith('ASC');
  });

  it('builds fileSize sort with a correlated subquery', () => {
    const raw = (sql as unknown as { raw: vi.Mock }).raw;

    const result = service.build([{ field: 'fileSize', dir: 'desc' }]);

    expect(result).toHaveLength(2);
    expect(raw).toHaveBeenCalledWith(expect.stringContaining('SELECT bf.size_bytes FROM book_files'));
  });

  it('builds format sort with a correlated subquery', () => {
    const raw = (sql as unknown as { raw: vi.Mock }).raw;

    const result = service.build([{ field: 'format', dir: 'asc' }]);

    expect(result).toHaveLength(2);
    expect(raw).toHaveBeenCalledWith(expect.stringContaining('SELECT bf.format FROM book_files'));
  });

  it('builds random sort with md5 hash expression', () => {
    const raw = (sql as unknown as { raw: vi.Mock }).raw;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T00:00:00Z'));

    const result = service.build([{ field: 'random', dir: 'desc' }], 7);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ type: 'sql', text: expect.stringContaining('md5(') });
    expect(result[0]?.values[1]).toBe(Math.floor(new Date('2025-01-15T00:00:00Z').getTime() / 86_400_000) + 7);
    expect(raw).toHaveBeenNthCalledWith(1, 'DESC');
    expect(raw).toHaveBeenNthCalledWith(2, 'DESC');
  });

  it('throws for readProgress sort without userId', () => {
    expect(() => service.build([{ field: 'readProgress', dir: 'asc' }])).toThrow(
      new BadRequestException('readProgress sort requires an authenticated user'),
    );
  });

  it('builds readProgress sort with userId', () => {
    const raw = (sql as unknown as { raw: vi.Mock }).raw;

    const result = service.build([{ field: 'readProgress', dir: 'asc' }], 42);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: 'sql', text: expect.stringContaining('SELECT max(rp.percentage)') });
    expect(result[0]?.values[0]).toBe(42);
    expect(raw).toHaveBeenCalledWith('ASC');
  });

  it('throws for lastReadAt sort without userId', () => {
    expect(() => service.build([{ field: 'lastReadAt', dir: 'asc' }])).toThrow(
      new BadRequestException('lastReadAt sort requires an authenticated user'),
    );
  });

  it('throws for finishedAt sort without userId', () => {
    expect(() => service.build([{ field: 'finishedAt', dir: 'asc' }])).toThrow(
      new BadRequestException('finishedAt sort requires an authenticated user'),
    );
  });

  it('throws for startedAt sort without userId', () => {
    expect(() => service.build([{ field: 'startedAt', dir: 'asc' }])).toThrow(
      new BadRequestException('startedAt sort requires an authenticated user'),
    );
  });

  it('builds startedAt sort with userId', () => {
    const raw = (sql as unknown as { raw: vi.Mock }).raw;

    const result = service.build([{ field: 'startedAt', dir: 'desc' }], 42);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: 'sql', text: expect.stringContaining('SELECT ubs.started_at FROM user_book_status ubs') });
    expect(result[0]?.values[0]).toBe(42);
    expect(raw).toHaveBeenCalledWith('DESC');
  });

  it('throws for rating sort without userId', () => {
    expect(() => service.build([{ field: 'rating', dir: 'asc' }])).toThrow(new BadRequestException('rating sort requires an authenticated user'));
  });

  it('throws for readStatus sort without userId', () => {
    expect(() => service.build([{ field: 'readStatus', dir: 'asc' }])).toThrow(
      new BadRequestException('readStatus sort requires an authenticated user'),
    );
  });

  it('adds series name fallback when sorting by seriesIndex without series sort', () => {
    const raw = (sql as unknown as { raw: vi.Mock }).raw;

    const result = service.build([{ field: 'seriesIndex', dir: 'desc' }]);

    expect(result).toHaveLength(3);
    expect(raw).toHaveBeenNthCalledWith(1, 'DESC');
    expect(raw).toHaveBeenNthCalledWith(2, 'DESC');
  });

  it('does not add series name fallback when series is already sorted', () => {
    const raw = (sql as unknown as { raw: vi.Mock }).raw;

    const result = service.build([
      { field: 'series', dir: 'asc' },
      { field: 'seriesIndex', dir: 'desc' },
    ]);

    expect(result).toHaveLength(3);
    expect(raw).toHaveBeenNthCalledWith(1, 'ASC');
    expect(raw).toHaveBeenNthCalledWith(2, 'DESC');
  });

  it('adds multiple sorts in the requested order', () => {
    const raw = (sql as unknown as { raw: vi.Mock }).raw;

    const result = service.build([
      { field: 'language', dir: 'asc' },
      { field: 'metadataScore', dir: 'desc' },
      { field: 'publisher', dir: 'asc' },
    ]);

    expect(result).toHaveLength(4);
    expect(raw).toHaveBeenNthCalledWith(1, 'ASC');
    expect(raw).toHaveBeenNthCalledWith(2, 'DESC');
    expect(raw).toHaveBeenNthCalledWith(3, 'ASC');
  });

  it('skips unknown sort fields silently', () => {
    const raw = (sql as unknown as { raw: vi.Mock }).raw;

    const result = service.build([{ field: 'unknown', dir: 'asc' } as never]);

    expect(result).toHaveLength(2);
    expect(raw).not.toHaveBeenCalled();
  });

  it('skips invalid sort directions', () => {
    const raw = (sql as unknown as { raw: vi.Mock }).raw;

    const result = service.build([{ field: 'title', dir: 'asc; DROP TABLE books' } as never]);

    expect(result).toHaveLength(2);
    expect(raw).not.toHaveBeenCalled();
  });
});
