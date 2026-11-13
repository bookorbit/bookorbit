import type { SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';

import * as schema from '../../db/schema';
import { TaxonomyRepository } from './taxonomy.repository';

const dialect = new PgDialect();
const render = (fragment: SQL) => dialect.sqlToQuery(fragment);

// A real drizzle instance over a client that is never asked to connect: `.toSQL()` renders the
// queries the repository builds without a database.
function makeRepo() {
  const db = drizzle({ client: {} as never, schema });
  return { repo: new TaxonomyRepository(db as never), db };
}

describe('TaxonomyRepository', () => {
  it('builds a membership clause against the junction of the requested kind', () => {
    const { repo } = makeRepo();

    const genre = render(repo.membershipClause('genre', 5));
    const tag = render(repo.membershipClause('tag', 5));

    expect(genre.sql).toContain(
      'exists ((select 1 from "book_genres" where ("book_genres"."book_id" = "books"."id" and "book_genres"."genre_id" = $1)))',
    );
    expect(genre.params).toEqual([5]);
    expect(tag.sql).toContain('"book_tags"."tag_id" = $1');
  });

  it('skips the database for a viewer with no libraries', async () => {
    const { repo, db } = makeRepo();
    const select = vi.spyOn(db, 'select');

    await expect(repo.countVisible('genre', { libraryIds: [] })).resolves.toBe(0);
    await expect(repo.findLibraryCounts('genre', 1, { libraryIds: [] })).resolves.toEqual([]);
    await expect(repo.hasVisibleBooks('genre', 1, { libraryIds: [] })).resolves.toBe(false);
    await expect(repo.findSimilar('tag', { id: 1, name: 'x' }, { libraryIds: [] }, 10)).resolves.toEqual([]);
    await expect(repo.findCoverBookIds('tag', [], { libraryIds: [1] })).resolves.toEqual(new Map());
    expect(select).not.toHaveBeenCalled();
  });

  it('counts names over visible books and groups covers per name', async () => {
    const { repo, db } = makeRepo();
    const execute = vi.spyOn(db, 'execute').mockResolvedValue({
      rows: [
        { entityId: 3, bookId: 30 },
        { entityId: 3, bookId: 31 },
        { entityId: 4, bookId: 40 },
      ],
    } as never);

    const covers = await repo.findCoverBookIds('genre', [3, 4], { libraryIds: [1, 2] });

    expect(covers).toEqual(
      new Map([
        [3, [30, 31]],
        [4, [40]],
      ]),
    );
    const query = render(execute.mock.calls[0][0] as SQL);
    expect(query.sql).toContain('cross join lateral');
    expect(query.sql).toContain('"books"."library_id" in ($3, $4)');
    expect(query.sql).toMatch(/limit \$\d+/);
    expect(query.params).toEqual([3, 4, 1, 2, 3]);
  });
});
