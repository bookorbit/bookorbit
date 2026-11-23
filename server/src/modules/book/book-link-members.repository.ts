import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { getBookMediaKind, type LinkedBookSummary } from '@bookorbit/types';

import { DB } from '../../db';
import { bookLastReadSql } from '../../db/book-last-read';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export type LinkGroupMember = LinkedBookSummary & { groupId: number };

export function toLinkedBookSummary(member: LinkGroupMember): LinkedBookSummary {
  const summary: LinkedBookSummary & { groupId?: number } = { ...member };
  delete summary.groupId;
  return summary;
}

type ProgressInputs = {
  status: string | null;
  filePercentage: number | null;
  fileReadAt: Date | null;
  audioPercentage: number | null;
  audioUpdatedAt: Date | null;
};

/**
 * The viewer's progress as a card shows it: the more recent of file and audiobook progress.
 * Finished, like the up-next shelf decides it: marked read or skimmed, or read to the end.
 */
export function memberProgress(row: ProgressInputs): LinkedBookSummary['progress'] {
  let percentage: number | null;
  if (row.filePercentage != null && row.audioPercentage != null) {
    percentage = (row.fileReadAt?.getTime() ?? 0) >= (row.audioUpdatedAt?.getTime() ?? 0) ? row.filePercentage : row.audioPercentage;
  } else {
    percentage = row.filePercentage ?? row.audioPercentage;
  }
  if (row.status === 'read' || row.status === 'skimmed' || (percentage ?? 0) >= 100) return { percentage: 100, finished: true };
  if (percentage == null || percentage <= 0) return null;
  return { percentage: Math.round(Math.min(100, percentage) * 10) / 10, finished: false };
}

/** Who is linked with whom. Read side only: the book-link module owns the writes. */
@Injectable()
export class BookLinkMembersRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The group a book belongs to, or null. */
  async findGroupId(bookId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ groupId: schema.bookLinks.groupId })
      .from(schema.bookLinks)
      .where(eq(schema.bookLinks.bookId, bookId))
      .limit(1);
    return row?.groupId ?? null;
  }

  /**
   * Members of these groups that pass `accessWhere` (the viewer's libraries and content filters),
   * in group order: lead first, then by id, with the viewer's own progress. Groups with fewer than
   * two members mean "not linked" and are left out. A group holds at most ten books, so the
   * per-member lookups stay small.
   */
  async findMembers(groupIds: number[], accessWhere: SQL | undefined, userId: number): Promise<LinkGroupMember[]> {
    const ids = [...new Set(groupIds)];
    if (ids.length === 0) return [];
    const formats = sql<string[] | null>`(
      select array_agg(file_formats.format order by file_formats.rank_key)
      from (
        select lower(bf.format) as format,
          min(array[case when bf.id = ${schema.books.primaryFileId} then 0 else 1 end, coalesce(bf.sort_order, 2147483647), bf.id]) as rank_key
        from book_files bf
        where bf.book_id = ${schema.books.id} and bf.role = 'content' and bf.format is not null
        group by lower(bf.format)
      ) file_formats
    )`;
    const rows = await this.db
      .select({
        groupId: schema.bookLinks.groupId,
        bookId: schema.books.id,
        libraryId: schema.books.libraryId,
        libraryName: schema.libraries.name,
        title: schema.bookMetadata.title,
        status: schema.books.status,
        leadBookId: schema.bookLinkGroups.leadBookId,
        formats,
        editionName: schema.bookMetadata.editionName,
        publisher: schema.bookMetadata.publisher,
        publishedYear: schema.bookMetadata.publishedYear,
        originalPublishedYear: schema.bookMetadata.originalPublishedYear,
        coverUpdatedAt: schema.bookMetadata.coverUpdatedAt,
        narrators: sql<string[] | null>`(
          select array_agg(n.name order by bn.display_order, n.id)
          from book_narrators bn inner join narrators n on n.id = bn.narrator_id
          where bn.book_id = ${schema.books.id}
        )`,
        viewerStatus: sql<string | null>`(
          select ubs.status from user_book_status ubs where ubs.user_id = ${userId} and ubs.book_id = ${schema.books.id}
        )`,
        filePercentage: sql<number | null>`(
          select rp.percentage from reading_progress rp where rp.user_id = ${userId} and rp.book_file_id = ${schema.books.primaryFileId}
        )`,
        fileReadAt: sql<Date | null>`(
          select rp.last_read_at from reading_progress rp where rp.user_id = ${userId} and rp.book_file_id = ${schema.books.primaryFileId}
        )`.mapWith((value: string | Date | null) => (value == null ? null : new Date(value))),
        audioPercentage: sql<number | null>`(
          select ap.percentage from audiobook_progress ap where ap.user_id = ${userId} and ap.book_id = ${schema.books.id}
        )`,
        audioUpdatedAt: sql<Date | null>`(
          select ap.updated_at from audiobook_progress ap where ap.user_id = ${userId} and ap.book_id = ${schema.books.id}
        )`.mapWith((value: string | Date | null) => (value == null ? null : new Date(value))),
        lastReadAt: bookLastReadSql(schema.books.id, userId).mapWith((value: string | Date | null) => (value == null ? null : new Date(value))),
      })
      .from(schema.bookLinks)
      .innerJoin(schema.bookLinkGroups, eq(schema.bookLinkGroups.id, schema.bookLinks.groupId))
      .innerJoin(schema.books, eq(schema.books.id, schema.bookLinks.bookId))
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.books.libraryId))
      .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
      .where(
        and(
          inArray(schema.bookLinks.groupId, ids),
          sql`(select count(*) from book_links others where others.group_id = ${schema.bookLinks.groupId}) >= 2`,
          accessWhere,
        ),
      )
      .orderBy(schema.bookLinks.groupId, sql`(${schema.books.id} = ${schema.bookLinkGroups.leadBookId}) desc`, schema.books.id);

    return rows.map((row) => {
      const bookFormats = row.formats ?? [];
      return {
        groupId: row.groupId,
        bookId: row.bookId,
        libraryId: row.libraryId,
        libraryName: row.libraryName,
        title: row.title ?? null,
        formats: bookFormats,
        mediaKind: getBookMediaKind(bookFormats[0]),
        status: row.status,
        isLead: row.leadBookId === row.bookId,
        editionName: row.editionName ?? null,
        publisher: row.publisher ?? null,
        publishedYear: row.publishedYear ?? null,
        originalPublishedYear: row.originalPublishedYear ?? null,
        narrators: row.narrators ?? [],
        coverUpdatedAt: row.coverUpdatedAt ? new Date(row.coverUpdatedAt).toISOString() : null,
        progress: memberProgress({
          status: row.viewerStatus,
          filePercentage: row.filePercentage == null ? null : Number(row.filePercentage),
          fileReadAt: row.fileReadAt,
          audioPercentage: row.audioPercentage == null ? null : Number(row.audioPercentage),
          audioUpdatedAt: row.audioUpdatedAt,
        }),
        lastReadAt: row.lastReadAt ? row.lastReadAt.toISOString() : null,
      };
    });
  }

  /** The other members of the book's group that pass `accessWhere`. */
  /** With no other member visible, the book reads as not linked: no group id, so nothing hints at a hidden book (G2). */
  async findLinkedBooks(
    bookId: number,
    groupId: number,
    accessWhere: SQL | undefined,
    userId: number,
  ): Promise<{ groupId: number | null; books: LinkedBookSummary[]; isLead: boolean; self: LinkedBookSummary | null }> {
    const members = await this.findMembers([groupId], accessWhere, userId);
    const self = members.find((member) => member.bookId === bookId);
    const books = self ? members.filter((member) => member.bookId !== bookId).map(toLinkedBookSummary) : [];
    if (!self || books.length === 0) return { groupId: null, books: [], isLead: false, self: null };
    return { groupId, books, isLead: self.isLead, self: toLinkedBookSummary(self) };
  }
}
