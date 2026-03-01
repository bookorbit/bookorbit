import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigService } from '@nestjs/config';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookMetadata, bookTags, books, tags } from '../../db/schema';
import type { TemplateContext } from './email-template-renderer';
import { formatFileSize } from './email-template-renderer';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class EmailTemplateContextService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
  ) {}

  async buildForBook(bookId: number, fileId: number | null, senderName: string): Promise<TemplateContext> {
    const [bookResult, metaResult, authorRows, tagRows, fileResult] = await Promise.all([
      this.db.select().from(books).where(eq(books.id, bookId)).limit(1),
      this.db.select().from(bookMetadata).where(eq(bookMetadata.bookId, bookId)).limit(1),
      this.db
        .select({ name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(eq(bookAuthors.bookId, bookId))
        .orderBy(bookAuthors.displayOrder),
      this.db.select({ name: tags.name }).from(bookTags).innerJoin(tags, eq(tags.id, bookTags.tagId)).where(eq(bookTags.bookId, bookId)),
      fileId ? this.db.select().from(bookFiles).where(eq(bookFiles.id, fileId)).limit(1) : Promise.resolve([]),
    ]);

    const [book] = bookResult;
    if (!book) throw new NotFoundException('Book not found');

    const [meta] = metaResult;
    const file: typeof bookFiles.$inferSelect | undefined = fileResult[0];

    const appUrl = this.config.get<string>('mailer.appUrl') ?? '';
    const coverUrl = meta ? `${appUrl}/api/books/${bookId}/cover` : '';

    return {
      title: meta?.title ?? '',
      subtitle: meta?.subtitle ?? '',
      author: authorRows.map((a) => a.name).join(', '),
      series: meta?.seriesName ?? '',
      seriesIndex: meta?.seriesIndex ?? null,
      format: file?.format?.toUpperCase() ?? '',
      fileSize: formatFileSize(file?.sizeBytes ?? null),
      pageCount: meta?.pageCount ?? null,
      publisher: meta?.publisher ?? '',
      publishedYear: meta?.publishedYear ?? null,
      isbn: meta?.isbn13 ?? meta?.isbn10 ?? '',
      tags: tagRows.map((t) => t.name).join(', '),
      language: meta?.language ?? '',
      senderName,
      appUrl,
      coverUrl,
    };
  }
}
