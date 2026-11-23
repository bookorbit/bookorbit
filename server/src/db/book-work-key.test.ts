import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { workKeySql } from './book-work-key';
import { books } from './schema';

const dialect = new PgDialect();

describe('workKeySql', () => {
  it('keys a linked book by its group and any other book by itself', () => {
    const query = dialect.sqlToQuery(sql`select ${workKeySql(books.id)}`);
    expect(query.sql.replace(/\s+/g, ' ')).toBe(
      `select coalesce('g' || (SELECT bl.group_id FROM book_links bl WHERE bl.book_id = "books"."id"), 'b' || "books"."id")`,
    );
  });
});
