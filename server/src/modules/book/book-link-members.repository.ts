import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { getBookMediaKind, type LinkedBookSummary } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export type LinkGroupMember = LinkedBookSummary & { groupId: number };

export function toLinkedBookSummary(member: LinkGroupMember): LinkedBookSummary {
  const { bookId, libraryId, libraryName, title, formats, mediaKind, status, isLead } = member;
  return { bookId, libraryId, libraryName, title, formats, mediaKind, status, isLead };
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
   * in group order: lead first, then by id. Groups with fewer than two members mean "not linked"
   * and are left out.
   */
  async findMembers(groupIds: number[], accessWhere: SQL | undefined): Promise<LinkGroupMember[]> {
    const ids = [...new Set(groupIds)];
    if (ids.length === 0) return [];
    const formats = sql<string[] | null>`(
      select array_agg(lower(bf.format) order by (bf.id = ${schema.books.primaryFileId}) desc, bf.sort_order, bf.id)
      from book_files bf
      where bf.book_id = ${schema.books.id} and bf.role = 'content' and bf.format is not null
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
      };
    });
  }

  /** The other members of the book's group that pass `accessWhere`. */
  /** With no other member visible, the book reads as not linked: no group id, so nothing hints at a hidden book (G2). */
  async findLinkedBooks(
    bookId: number,
    groupId: number,
    accessWhere: SQL | undefined,
  ): Promise<{ groupId: number | null; books: LinkedBookSummary[]; isLead: boolean }> {
    const members = await this.findMembers([groupId], accessWhere);
    const self = members.find((member) => member.bookId === bookId);
    const books = self ? members.filter((member) => member.bookId !== bookId).map(toLinkedBookSummary) : [];
    if (books.length === 0) return { groupId: null, books: [], isLead: false };
    return { groupId, books, isLead: self?.isLead ?? false };
  }
}
