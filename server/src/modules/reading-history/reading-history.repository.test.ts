import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { ReadingHistoryRepository, type ReadingHistoryScope } from './reading-history.repository';

const dialect = new PgDialect();
const SCOPE: ReadingHistoryScope = { userId: 1, libraryIds: null, contentFilters: undefined, timeZone: 'UTC' };
const ALL_TIME = { from: null, until: null };

function makeRepo(rows: unknown[] = [{}]) {
  const execute = vi.fn().mockResolvedValue({ rows });
  return { repo: new ReadingHistoryRepository({ execute } as never), execute };
}

function rendered(execute: ReturnType<typeof vi.fn>): string {
  return dialect.sqlToQuery(execute.mock.calls[0]![0] as SQL).sql.replace(/\s+/g, ' ');
}

describe('ReadingHistoryRepository numbering', () => {
  it('numbers finishes per work, so a second linked edition is a re-read, while the rating stays with each book', async () => {
    const { repo, execute } = makeRepo([{ total: 0 }]);

    await repo.count(SCOPE, { period: ALL_TIME, outcomes: ['completed'], search: null, bookId: null, sort: 'newest' });

    const text = rendered(execute);
    // A read whose book was deleted has no work key and stays in a partition of its own.
    expect(text).toContain(
      `coalesce(coalesce('g' || (SELECT bl.group_id FROM book_links bl WHERE bl.book_id = ra.book_id), 'b' || ra.book_id), 'r' || ra.id) as work_key`,
    );
    expect(text).toContain(`row_number() over ( partition by ra.work_key, ra.outcome = 'completed' order by coalesce(ra.started_on, ra.ended_on)`);
    expect(text).toContain(`over (partition by ra.work_key) as completed_reads`);
    expect(text).toContain(
      `partition by coalesce(ra.book_id, -ra.id), ra.outcome = 'completed' order by ra.ended_on desc nulls last, ra.id desc ) = 1 as latest_completed`,
    );
  });

  it('counts distinct works in the period totals and ranks the most re-read work', async () => {
    const totals = makeRepo([{ reads: 2, books: 1 }]);
    await expect(totals.repo.totals(SCOPE, ALL_TIME)).resolves.toMatchObject({ reads: 2, books: 1 });
    expect(rendered(totals.execute)).toContain(
      `count(distinct numbered.work_key) filter (where "reading_attempts"."outcome" = 'completed')::int as books`,
    );

    const records = makeRepo([]);
    await records.repo.records(SCOPE, ALL_TIME);
    const texts = records.execute.mock.calls.map((call) => dialect.sqlToQuery(call[0] as SQL).sql);
    expect(texts.filter((text) => text.includes('count(*) over (partition by numbered.work_key)'))).toHaveLength(1);
    expect(texts.some((text) => text.includes('partition by coalesce("reading_attempts"."book_id"'))).toBe(false);
  });
});
