import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { BOOK_JOURNAL_LIST_LIMIT, type BookJournalEntry, type BookJournalStatus } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { BookJournalEntryRow } from '../../db/schema';
import { BookService } from '../book/book.service';
import { BookJournalRepository, type BookJournalEntryPatch } from './book-journal.repository';
import type { CreateBookJournalEntryDto } from './dto/create-book-journal-entry.dto';
import type { UpdateBookJournalEntryDto } from './dto/update-book-journal-entry.dto';

/** How far ahead of the server clock an offline entry's own timestamp may be before it is clamped. */
export const BOOK_JOURNAL_FUTURE_SKEW_MS = 5 * 60 * 1000;
const EARLIEST_CREATED_AT_MS = Date.UTC(1970, 0, 1);

@Injectable()
export class BookJournalService {
  constructor(
    private readonly repo: BookJournalRepository,
    private readonly bookService: BookService,
  ) {}

  async list(bookId: number, user: RequestUser, status: BookJournalStatus = 'active'): Promise<BookJournalEntry[]> {
    await this.bookService.verifyBookAccess(bookId, user);
    const rows = await this.repo.findByBook(user.id, bookId, status, BOOK_JOURNAL_LIST_LIMIT);
    return rows.map(toBookJournalEntry);
  }

  /**
   * Idempotent on the client id, so an offline client can retry a create it never saw answered.
   * A replay returns the stored entry untouched, even if it has since been edited or trashed.
   */
  async create(bookId: number, user: RequestUser, dto: CreateBookJournalEntryDto, now = new Date()): Promise<BookJournalEntry> {
    await this.bookService.verifyBookAccess(bookId, user);

    const inserted = await this.repo.insert({
      clientId: dto.clientId,
      userId: user.id,
      bookId,
      body: requireBody(dto.body),
      quote: optionalText(dto.quote),
      chapterTitle: optionalText(dto.chapterTitle),
      positionPercent: dto.positionPercent ?? null,
      cfi: optionalText(dto.cfi),
      positionSeconds: dto.positionSeconds ?? null,
      createdAt: resolveCreatedAt(dto.createdAt, now),
    });
    if (inserted) return toBookJournalEntry(inserted);

    const existing = await this.repo.findByClientId(user.id, dto.clientId);
    if (!existing) throw new ConflictException('Journal entry could not be created; retry the request');
    if (existing.bookId !== bookId) throw new ConflictException('This journal entry id already belongs to another book');
    return toBookJournalEntry(existing);
  }

  async update(bookId: number, clientId: string, user: RequestUser, dto: UpdateBookJournalEntryDto): Promise<BookJournalEntry> {
    await this.bookService.verifyBookAccess(bookId, user);
    const patch = buildPatch(dto);

    const row =
      Object.keys(patch).length === 0
        ? await this.repo.findActive(user.id, bookId, clientId)
        : await this.repo.updateActive(user.id, bookId, clientId, patch);
    if (!row) throw new NotFoundException(notFoundMessage(bookId, clientId));
    return toBookJournalEntry(row);
  }

  /** Moves the entry to the trash. Trashing an entry already there is a no-op, not an error. */
  async trash(bookId: number, clientId: string, user: RequestUser): Promise<void> {
    await this.bookService.verifyBookAccess(bookId, user);
    const outcome = await this.repo.trash(user.id, bookId, clientId);
    if (outcome === 'not_found') throw new NotFoundException(notFoundMessage(bookId, clientId));
  }

  async restore(bookId: number, clientId: string, user: RequestUser): Promise<BookJournalEntry> {
    await this.bookService.verifyBookAccess(bookId, user);
    const row = await this.repo.restore(user.id, bookId, clientId);
    if (!row) throw new NotFoundException(`Journal entry ${clientId} is not in the trash for book ${bookId}`);
    return toBookJournalEntry(row);
  }

  async purge(bookId: number, clientId: string, user: RequestUser): Promise<void> {
    await this.bookService.verifyBookAccess(bookId, user);
    const purged = await this.repo.purge(user.id, bookId, clientId);
    if (!purged) throw new NotFoundException(`Journal entry ${clientId} is not in the trash for book ${bookId}`);
  }
}

export function toBookJournalEntry(row: BookJournalEntryRow): BookJournalEntry {
  return {
    id: row.id,
    clientId: row.clientId,
    bookId: row.bookId,
    body: row.body,
    quote: row.quote ?? null,
    chapterTitle: row.chapterTitle ?? null,
    positionPercent: row.positionPercent ?? null,
    cfi: row.cfi ?? null,
    positionSeconds: row.positionSeconds ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

/** A client clock running ahead must not date an entry into the future; one far behind is a bug. */
export function resolveCreatedAt(raw: string | undefined, now: Date): Date {
  if (raw === undefined) return now;
  const parsed = new Date(raw);
  const ms = parsed.getTime();
  if (Number.isNaN(ms) || ms < EARLIEST_CREATED_AT_MS) throw new BadRequestException('createdAt is out of range');
  return ms > now.getTime() + BOOK_JOURNAL_FUTURE_SKEW_MS ? now : parsed;
}

function requireBody(raw: string): string {
  const body = raw.trim();
  if (body === '') throw new BadRequestException('body must not be empty');
  return body;
}

/** Blank optional text is stored as absent rather than as an empty string. */
function optionalText(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function buildPatch(dto: UpdateBookJournalEntryDto): BookJournalEntryPatch {
  const patch: BookJournalEntryPatch = {};
  if (dto.body !== undefined) patch.body = requireBody(dto.body);
  if (dto.quote !== undefined) patch.quote = optionalText(dto.quote);
  if (dto.chapterTitle !== undefined) patch.chapterTitle = optionalText(dto.chapterTitle);
  if (dto.positionPercent !== undefined) patch.positionPercent = dto.positionPercent;
  if (dto.cfi !== undefined) patch.cfi = optionalText(dto.cfi);
  if (dto.positionSeconds !== undefined) patch.positionSeconds = dto.positionSeconds;
  return patch;
}

function notFoundMessage(bookId: number, clientId: string): string {
  return `Journal entry ${clientId} not found for book ${bookId}`;
}
