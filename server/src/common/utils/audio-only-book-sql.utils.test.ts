import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { AUDIO_FORMAT_LIST } from '@bookorbit/types';
import { excludeAudioOnlyBooks } from './audio-only-book-sql.utils';

const dialect = new PgDialect();

describe('excludeAudioOnlyBooks', () => {
  it('hides a book only when every content file it has is audio', () => {
    const { sql: text, params } = dialect.sqlToQuery(excludeAudioOnlyBooks());

    // A scalar aggregate rather than NOT EXISTS, so PostgreSQL cannot flatten it into an anti-join.
    expect(text).toMatch(/^\(\(select bool_and\(coalesce\("audio_only_content_file"\."format" in \(/);
    expect(text).toContain('from "book_files" "audio_only_content_file"');
    expect(text).toContain('"audio_only_content_file"."book_id" = "books"."id"');
    expect(text).toMatch(/\) is not true$/);
    expect(params).toEqual([...AUDIO_FORMAT_LIST, 'content']);
  });

  it('correlates to any column holding a book id', () => {
    const { sql: text } = dialect.sqlToQuery(excludeAudioOnlyBooks(sql.raw('os.id')));

    expect(text).toContain('"audio_only_content_file"."book_id" = os.id');
    expect(text).not.toContain('"books"."id"');
  });
});
