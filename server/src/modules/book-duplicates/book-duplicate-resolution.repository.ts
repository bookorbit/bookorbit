import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';
import type { BookDuplicateKind, BookDuplicateMatchReason } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { DB } from '../../db';
import {
  bookDuplicateGroupMembers,
  bookDuplicateGroups,
  bookDuplicateResolutions,
  books,
  type BookDuplicateResolutionOutcomeRow,
  type BookDuplicateResolutionRow,
} from '../../db/schema';
import { duplicateScopeWhere, type Db } from './book-duplicates.repository';

export interface ResolutionGroupRow {
  id: number;
  kind: BookDuplicateKind;
  reasons: BookDuplicateMatchReason[];
}

export interface LiveBookRow {
  id: number;
  libraryId: number;
  status: string;
}

@Injectable()
export class BookDuplicateResolutionRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(values: { userId: number; scanId: number; total: number }): Promise<BookDuplicateResolutionRow> {
    const [row] = await this.db
      .insert(bookDuplicateResolutions)
      .values({ ...values, status: 'running' })
      .returning();
    return row!;
  }

  async update(
    id: number,
    values: Partial<{
      status: string;
      processed: number;
      currentGroupId: number | null;
      outcomes: BookDuplicateResolutionOutcomeRow[];
      errorCode: string | null;
      finishedAt: Date | null;
    }>,
  ): Promise<void> {
    await this.db.update(bookDuplicateResolutions).set(values).where(eq(bookDuplicateResolutions.id, id));
  }

  async find(id: number): Promise<BookDuplicateResolutionRow | null> {
    const [row] = await this.db.select().from(bookDuplicateResolutions).where(eq(bookDuplicateResolutions.id, id)).limit(1);
    return row ?? null;
  }

  async findRunningForUser(userId: number): Promise<BookDuplicateResolutionRow | null> {
    const [row] = await this.db
      .select()
      .from(bookDuplicateResolutions)
      .where(and(eq(bookDuplicateResolutions.userId, userId), eq(bookDuplicateResolutions.status, 'running')))
      .limit(1);
    return row ?? null;
  }

  /** A resolution cut short by a restart. The merges it ran are recovered by their own journal. */
  async markInterruptedFailed(): Promise<number> {
    const result = await this.db
      .update(bookDuplicateResolutions)
      .set({ status: 'failed', errorCode: 'RESOLUTION_INTERRUPTED', currentGroupId: null, finishedAt: new Date() })
      .where(eq(bookDuplicateResolutions.status, 'running'));
    return result.rowCount ?? 0;
  }

  /** Groups of a scan the user can still act on (two or more visible members), oldest first. */
  async findResolvableGroups(
    scanId: number,
    libraryIds: number[],
    user: RequestUser,
    filter: { kind: BookDuplicateKind; reason?: BookDuplicateMatchReason; excludeGroupIds: number[]; afterGroupId: number },
    limit: number,
  ): Promise<ResolutionGroupRow[]> {
    const accessibleGroupIds = this.db
      .select({ groupId: bookDuplicateGroupMembers.groupId })
      .from(bookDuplicateGroupMembers)
      .innerJoin(books, eq(books.id, bookDuplicateGroupMembers.bookId))
      .where(and(eq(bookDuplicateGroupMembers.scanId, scanId), duplicateScopeWhere(this.db, libraryIds, user)))
      .groupBy(bookDuplicateGroupMembers.groupId)
      .having(sql`count(*) >= 2`);
    const rows = await this.db
      .select({ id: bookDuplicateGroups.id, kind: bookDuplicateGroups.kind, reasons: bookDuplicateGroups.reasons })
      .from(bookDuplicateGroups)
      .where(
        and(
          eq(bookDuplicateGroups.scanId, scanId),
          eq(bookDuplicateGroups.kind, filter.kind),
          gt(bookDuplicateGroups.id, filter.afterGroupId),
          inArray(bookDuplicateGroups.id, accessibleGroupIds),
          filter.reason ? sql`${filter.reason} = ANY(${bookDuplicateGroups.reasons})` : undefined,
          filter.excludeGroupIds.length > 0 ? notInArray(bookDuplicateGroups.id, filter.excludeGroupIds) : undefined,
        ),
      )
      .orderBy(asc(bookDuplicateGroups.id))
      .limit(limit);
    return rows as ResolutionGroupRow[];
  }

  async findGroups(scanId: number, groupIds: number[]): Promise<ResolutionGroupRow[]> {
    if (groupIds.length === 0) return [];
    const rows = await this.db
      .select({ id: bookDuplicateGroups.id, kind: bookDuplicateGroups.kind, reasons: bookDuplicateGroups.reasons })
      .from(bookDuplicateGroups)
      .where(and(eq(bookDuplicateGroups.scanId, scanId), inArray(bookDuplicateGroups.id, groupIds)));
    return rows as ResolutionGroupRow[];
  }

  async findMemberIds(scanId: number, groupIds: number[]): Promise<Map<number, number[]>> {
    const members = new Map<number, number[]>();
    if (groupIds.length === 0) return members;
    const rows = await this.db
      .select({ groupId: bookDuplicateGroupMembers.groupId, bookId: bookDuplicateGroupMembers.bookId })
      .from(bookDuplicateGroupMembers)
      .where(and(eq(bookDuplicateGroupMembers.scanId, scanId), inArray(bookDuplicateGroupMembers.groupId, groupIds)))
      .orderBy(asc(bookDuplicateGroupMembers.groupId), asc(bookDuplicateGroupMembers.bookId));
    for (const row of rows) members.set(row.groupId, [...(members.get(row.groupId) ?? []), row.bookId]);
    return members;
  }

  /** The books that still exist and are visible to the user, as they are now. */
  async findLiveBooks(bookIds: number[], libraryIds: number[], user: RequestUser): Promise<LiveBookRow[]> {
    if (bookIds.length === 0) return [];
    return this.db
      .select({ id: books.id, libraryId: books.libraryId, status: books.status })
      .from(books)
      .where(and(inArray(books.id, bookIds), duplicateScopeWhere(this.db, libraryIds, user)));
  }
}
