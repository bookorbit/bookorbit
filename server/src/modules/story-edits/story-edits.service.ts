import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { STORY_EDITS_PAGE_MAX, STORY_EDITS_PER_BOOK_MAX, type StoryEdit, type StoryEditsPage } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { StoryEditRow } from '../../db/schema';
import { BookService } from '../book/book.service';
import type { PutStoryEditDto } from './dto/put-story-edit.dto';
import type { StoryEditsQueryDto } from './dto/story-edits-query.dto';
import { StoryEditsRepository } from './story-edits.repository';

export const STORY_EDITS_LIMIT_REACHED = 'STORY_EDITS_LIMIT_REACHED';

@Injectable()
export class StoryEditsService {
  constructor(
    private readonly repo: StoryEditsRepository,
    private readonly bookService: BookService,
  ) {}

  /**
   * After a merge moved another book's corrections onto this one: new revisions for every reader's
   * rows, so devices read them past any cursor they already hold. Returns how many readers.
   */
  resyncBook(bookId: number): Promise<number> {
    return this.repo.redrawRevisions(bookId);
  }

  /** Rows changed after `since`, oldest change first, tombstones included. */
  async list(bookId: number, user: RequestUser, query: StoryEditsQueryDto): Promise<StoryEditsPage> {
    await this.bookService.verifyBookAccess(bookId, user);
    const since = query.since ? query.since : '0';
    const limit = query.limit ?? STORY_EDITS_PAGE_MAX;

    const rows = await this.repo.listSince(user.id, bookId, Number(since), limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      edits: page.map(toStoryEdit),
      cursor: last ? String(last.revision) : since,
      hasMore: rows.length > limit,
    };
  }

  /** Answers the row as stored, which is the existing one untouched when it is newer than this write. */
  async put(bookId: number, id: string, user: RequestUser, dto: PutStoryEditDto): Promise<StoryEdit> {
    await this.bookService.verifyBookAccess(bookId, user);
    const result = await this.repo.write(
      {
        userId: user.id,
        bookId,
        id,
        kind: dto.kind,
        data: dto.data,
        position: dto.position ?? null,
        clientUpdatedAt: parseClientTime(dto.updatedAt),
        deleted: dto.deleted ?? false,
      },
      STORY_EDITS_PER_BOOK_MAX,
    );
    if (result.outcome === 'refused') {
      throw new ConflictException({
        message: `A book holds at most ${STORY_EDITS_PER_BOOK_MAX} story edits`,
        errorCode: STORY_EDITS_LIMIT_REACHED,
        errorMeta: { limit: STORY_EDITS_PER_BOOK_MAX },
      });
    }
    return toStoryEdit(result.row);
  }
}

export function toStoryEdit(row: StoryEditRow): StoryEdit {
  return {
    id: row.id,
    kind: row.kind,
    data: row.data,
    position: row.position ?? null,
    updatedAt: row.clientUpdatedAt.toISOString(),
    deleted: row.deleted,
  };
}

/** ISO 8601 admits forms such as week dates that `Date` cannot read; those are refused, not stored as NaN. */
function parseClientTime(raw: string): Date {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException('updatedAt must be an ISO 8601 date and time');
  return parsed;
}
