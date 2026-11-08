import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { BOOK_LINK_MAX_MEMBERS, LINK_GROUP_FULL_ERROR_CODE, LINK_GROUP_NOT_EDITABLE_ERROR_CODE, type BookLinkGroup } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookService } from '../book/book.service';
import { ScanGateway } from '../scanner/scan.gateway';
import { BookLinkRepository } from './book-link.repository';
import type { BookLinkDto, BookLinkLeadDto } from './dto/book-link.dto';

const LINK_EVENT = 'book_link';

/** One message whatever the cause and however many members, so a refusal reveals nothing about a hidden book. */
function notEditable(): ConflictException {
  return new ConflictException({
    message: 'These books are linked with a book you cannot edit.',
    errorCode: LINK_GROUP_NOT_EDITABLE_ERROR_CODE,
  });
}

/**
 * Links books that are the same work kept as separate records, often in different libraries
 * (07-phase-3-link.md 3.2). Records and files stay as they are; lists and detail show them as one.
 */
@Injectable()
export class BookLinkService {
  private readonly logger = new Logger(BookLinkService.name);

  constructor(
    private readonly repository: BookLinkRepository,
    private readonly bookService: BookService,
    private readonly gateway: ScanGateway,
  ) {}

  async link(dto: BookLinkDto, user: RequestUser): Promise<BookLinkGroup> {
    const startedAt = Date.now();
    const bookIds = dto.bookIds;
    for (const bookId of bookIds) await this.bookService.verifyBookAccess(bookId, user, 'editor');

    const memberships = await this.repository.findMemberships(bookIds);
    const groupIds = [...new Set(memberships.map((row) => row.groupId))];
    const existingMembers = await this.repository.findMemberIds(groupIds);
    const others = existingMembers.filter((id) => !bookIds.includes(id));
    await this.verifyEditable(others, user);

    const allMembers = new Set([...bookIds, ...existingMembers]);
    if (allMembers.size > BOOK_LINK_MAX_MEMBERS) {
      throw new ConflictException({
        message: `A link group holds at most ${BOOK_LINK_MAX_MEMBERS} books.`,
        errorCode: LINK_GROUP_FULL_ERROR_CODE,
        errorMeta: { max: BOOK_LINK_MAX_MEMBERS },
      });
    }

    const firstGrouped = bookIds.map((id) => memberships.find((row) => row.bookId === id)).find((row) => row !== undefined);
    const groupId = await this.repository.transaction(async (tx) => {
      // What was checked must still be the whole group; a member added since could be one this user cannot edit.
      const current = await this.repository.findMemberIds(
        [...new Set((await this.repository.findMemberships(bookIds, tx)).map((row) => row.groupId))],
        tx,
      );
      if (current.some((id) => !allMembers.has(id))) throw notEditable();

      const target = firstGrouped?.groupId ?? (await this.repository.createGroup(tx, bookIds[0], user.id));
      await this.repository.absorbGroups(
        tx,
        target,
        groupIds.filter((id) => id !== target),
      );
      await this.repository.addMembers(tx, target, bookIds, user.id);
      await this.repository.setLead(tx, target, firstGrouped?.leadBookId ?? bookIds[0]);
      return target;
    });

    await this.notify([...allMembers]);
    this.logger.log(
      `[${LINK_EVENT}] [end] groupId=${groupId} userId=${user.id} bookCount=${allMembers.size} mergedGroups=${groupIds.length} durationMs=${Date.now() - startedAt} - books linked`,
    );
    return this.group(groupId, user);
  }

  async setLead(groupId: number, dto: BookLinkLeadDto, user: RequestUser): Promise<BookLinkGroup> {
    await this.bookService.verifyBookAccess(dto.leadBookId, user, 'editor');
    const [membership] = await this.repository.findMemberships([dto.leadBookId]);
    if (!membership || membership.groupId !== groupId) throw new NotFoundException('Link group not found');
    await this.repository.transaction((tx) => this.repository.setLead(tx, groupId, dto.leadBookId));
    await this.notify(await this.repository.findMemberIds([groupId]));
    return this.group(groupId, user);
  }

  async unlink(bookId: number, user: RequestUser): Promise<void> {
    await this.bookService.verifyBookAccess(bookId, user, 'editor');
    const affected = await this.repository.transaction(async (tx) => {
      const [membership] = await this.repository.findMemberships([bookId], tx);
      if (!membership) return null;
      const members = await this.repository.findMemberIds([membership.groupId], tx);
      await this.repository.removeMember(tx, bookId);
      const remaining = members.filter((id) => id !== bookId);
      if (remaining.length < 2) await this.repository.deleteGroup(tx, membership.groupId);
      else if (membership.leadBookId === bookId) await this.repository.setLead(tx, membership.groupId, null);
      return { groupId: membership.groupId, members };
    });
    if (!affected) return;

    await this.notify(affected.members);
    this.logger.log(
      `[${LINK_EVENT}] [end] groupId=${affected.groupId} bookId=${bookId} userId=${user.id} remaining=${affected.members.length - 1} - book unlinked`,
    );
  }

  private async verifyEditable(bookIds: number[], user: RequestUser): Promise<void> {
    for (const bookId of bookIds) {
      try {
        await this.bookService.verifyBookAccess(bookId, user, 'editor');
      } catch (error) {
        if (error instanceof NotFoundException || error instanceof ForbiddenException) throw notEditable();
        throw error;
      }
    }
  }

  private async group(groupId: number, user: RequestUser): Promise<BookLinkGroup> {
    const books = await this.bookService.findLinkGroupMembers(groupId, user);
    return { groupId, leadBookId: books.find((book) => book.isLead)?.bookId ?? null, books };
  }

  /** Each library's room hears only of its own members, so nobody learns the id of a linked book in a library they cannot open (G2). */
  private async notify(bookIds: number[]): Promise<void> {
    try {
      const byLibrary = new Map<number, number[]>();
      for (const { bookId, libraryId } of await this.repository.findBookLibraries(bookIds)) {
        byLibrary.set(libraryId, [...(byLibrary.get(libraryId) ?? []), bookId]);
      }
      for (const [libraryId, ids] of byLibrary) this.gateway.emitBookLinksChanged({ libraryId, bookIds: ids });
    } catch (error) {
      this.logger.warn(
        `[${LINK_EVENT}] [fail] bookCount=${bookIds.length} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - link change not broadcast`,
      );
    }
  }
}
