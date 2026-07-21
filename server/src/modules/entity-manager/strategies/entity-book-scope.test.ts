import { ForbiddenException } from '@nestjs/common';

import { assertEntityRelationsWithinLibraries } from './entity-book-scope';

function flattenSql(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenSql).join(' ');
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  return [flattenSql(record.value), flattenSql(record.queryChunks)].join(' ');
}

describe('assertEntityRelationsWithinLibraries', () => {
  it('allows a mutation when no entity relations exist outside the accessible libraries', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });

    await expect(assertEntityRelationsWithinLibraries({ execute } as never, 'book_authors', 'author_id', [10, 20], [3, 4])).resolves.toBeUndefined();

    const query = flattenSql(execute.mock.calls[0]![0]).replace(/\s+/g, ' ');
    expect(query).toContain('book_authors');
    expect(query).toContain('scoped_relation.author_id');
    expect(query).toContain('NOT IN');
  });

  it('rejects a mutation when any entity relation belongs to an inaccessible library', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });

    await expect(assertEntityRelationsWithinLibraries({ execute } as never, 'book_tags', 'tag_id', [7], [2])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('treats every existing relation as inaccessible when the user has no libraries', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });

    await expect(assertEntityRelationsWithinLibraries({ execute } as never, 'book_genres', 'genre_id', [5], [])).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(flattenSql(execute.mock.calls[0]![0])).toContain('true');
  });

  it('skips the database query when there are no entity IDs', async () => {
    const execute = vi.fn();

    await assertEntityRelationsWithinLibraries({ execute } as never, 'book_authors', 'author_id', [], [1]);

    expect(execute).not.toHaveBeenCalled();
  });
});
