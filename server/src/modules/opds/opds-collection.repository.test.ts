import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { OpdsCollectionRepository } from './opds-collection.repository';

describe('OpdsCollectionRepository', () => {
  let repository: OpdsCollectionRepository;
  const query = vi.fn();

  beforeEach(async () => {
    query.mockReset().mockResolvedValue({ rows: [] });
    const db = drizzle({ client: { query } as never, schema });
    const module = await Test.createTestingModule({
      providers: [OpdsCollectionRepository, { provide: DB, useValue: db }],
    }).compile();
    repository = module.get(OpdsCollectionRepository);
  });

  it('counts only present books in the viewer libraries in one aggregate query', async () => {
    query.mockResolvedValueOnce({
      rows: [
        [4, 'Favorites', 1],
        [9, 'Empty public', 0],
      ],
    });

    await expect(repository.findVisibleForUser(7, false)).resolves.toEqual([
      { id: 4, name: 'Favorites', bookCount: 1 },
      { id: 9, name: 'Empty public', bookCount: 0 },
    ]);

    expect(query).toHaveBeenCalledOnce();
    const [{ text }, params] = query.mock.calls[0] as [{ text: string }, unknown[]];
    expect(text).toContain('count("books"."id")::int');
    expect(text).toContain('left join "books" on');
    expect(text).toContain('"books"."status" = $1');
    expect(text).toContain('exists (select 1 from "user_library_access"');
    expect(text).toContain('"user_library_access"."library_id" = "books"."library_id"');
    expect(text).toContain('("collections"."user_id" = $3 or "collections"."is_public" = $4)');
    expect(params).toEqual(['present', 7, 7, true, 'books']);
  });

  it('applies include and exclude content filters inside the book join', () => {
    const filters = {
      ...EMPTY_CONTENT_FILTER_RULES,
      includeTagIds: [11],
      includeGenreIds: [12],
      excludeTagIds: [13],
      excludeGenreIds: [14],
    };
    const { sql, params } = repository.findVisibleForUser(7, false, filters).toSQL();
    const bookJoin = sql.slice(sql.indexOf('left join "books"'), sql.indexOf(' where (('));

    expect(bookJoin).toContain('"books"."status"');
    expect(bookJoin).toContain('exists (select 1 from "book_tags"');
    expect(bookJoin).toContain('exists (select 1 from "book_genres"');
    expect(bookJoin).toContain(' or exists');
    expect(bookJoin).toContain('not exists (select 1 from "book_tags"');
    expect(bookJoin).toContain('not exists (select 1 from "book_genres"');
    expect(params).toEqual(['present', 7, 11, 12, 13, 14, 7, true, 'books']);
  });

  it('lets superusers count every library but still excludes foreign private and podcast collections', () => {
    const filters = { ...EMPTY_CONTENT_FILTER_RULES, excludeTagIds: [13] };
    const { sql, params } = repository.findVisibleForUser(7, true, filters).toSQL();

    expect(sql).not.toContain('user_library_access');
    expect(sql).not.toContain('book_tags');
    expect(sql).toContain('"books"."status"');
    expect(sql).toContain('"collections"."user_id"');
    expect(sql).toContain('"collections"."is_public"');
    expect(sql).toContain('"collections"."media_type"');
    expect(params).toEqual(['present', 7, true, 'books']);
  });

  it('uses the same visibility for dashboard totals without joining memberships', async () => {
    query.mockResolvedValueOnce({ rows: [['3']] });

    await expect(repository.countVisibleForUser(7)).resolves.toBe(3);

    const [{ text }, params] = query.mock.calls[0] as [{ text: string }, unknown[]];
    expect(text).toContain('("collections"."user_id" = $1 or "collections"."is_public" = $2)');
    expect(text).not.toContain('join');
    expect(params).toEqual([7, true, 'books']);
  });
});
