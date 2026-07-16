import { BadRequestException } from '@nestjs/common';

import { PublisherStrategy } from './publisher.strategy';

class TestablePublisherStrategy extends PublisherStrategy {
  exposeIdentityCondition(alias: string, value: string) {
    return this.buildIdentityEqualsCondition(alias, value);
  }
}

function makeStrategy(db: Record<string, unknown> = {}) {
  return new PublisherStrategy(db as never);
}

function flattenSql(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenSql).join(' ');
  if (!value || typeof value !== 'object') return '';

  const record = value as { queryChunks?: unknown[]; value?: unknown };
  return [flattenSql(record.value), flattenSql(record.queryChunks)].join(' ');
}

function extractSqlParams(value: unknown): unknown[] {
  if (typeof value === 'number' || typeof value === 'string' || value === null || typeof value === 'boolean') return [value];
  if (!value || typeof value !== 'object') return [];

  const record = value as { queryChunks?: unknown[]; value?: unknown };
  return [...(Array.isArray(record.value) ? record.value.flatMap(extractSqlParams) : []), ...(record.queryChunks?.flatMap(extractSqlParams) ?? [])];
}

describe('PublisherStrategy', () => {
  describe('rename', () => {
    it('normalizes publisher names before updating metadata', async () => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
        .mockResolvedValueOnce({ rows: [{ bookId: 10 }, { bookId: 11 }] });
      const strategy = makeStrategy({ execute });

      const result = await strategy.rename({
        entityId: 'Orbit  Books',
        newName: '  Orbit\t\nBooks  ',
        userId: 1,
        libraryIds: [7],
      });

      expect(result).toEqual({
        oldName: 'Orbit  Books',
        affectedBookIds: [10, 11],
        wasImplicitMerge: false,
        mergedEntityId: undefined,
      });

      const updateParams = extractSqlParams(execute.mock.calls[1]![0]);
      expect(updateParams).toContain('Orbit Books');
      expect(updateParams).not.toContain('  Orbit\t\nBooks  ');
    });

    it('uses normalized identity when detecting implicit publisher merges', async () => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ cnt: 3 }] })
        .mockResolvedValueOnce({ rows: [{ bookId: 20 }] });
      const strategy = makeStrategy({ execute });

      const result = await strategy.rename({
        entityId: 'Orbit  Books',
        newName: 'Orbit Books',
        userId: 1,
        libraryIds: [7],
      });

      expect(result).toMatchObject({
        wasImplicitMerge: true,
        mergedEntityId: 'Orbit Books',
      });

      const countSql = execute.mock.calls[0]![0];
      const countSqlText = flattenSql(countSql).replace(/\s+/g, ' ');
      expect(countSqlText).toContain('regexp_replace');
      expect(countSqlText).toContain('chr(160)');
      expect(extractSqlParams(countSql)).toContain('orbit books');
    });

    it('rejects whitespace-only publisher names after normalization', async () => {
      const execute = vi.fn();
      const strategy = makeStrategy({ execute });

      await expect(
        strategy.rename({
          entityId: 'Orbit Books',
          newName: ' \t\n\u00a0 ',
          userId: 1,
          libraryIds: [7],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('buildIdentityEqualsCondition', () => {
    it('returns a false condition when the normalized lookup key is empty', () => {
      const strategy = new TestablePublisherStrategy({} as never);

      const condition = strategy.exposeIdentityCondition('bm', ' \t\n\u00a0 ');

      expect(flattenSql(condition)).toContain('false');
    });
  });
});
