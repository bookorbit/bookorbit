import { Injectable } from '@nestjs/common';

import type { UserBookNoteRow } from '../../db/schema';
import { UserBookNoteRepository } from './user-book-note.repository';

export const USER_BOOK_NOTE_MAX_LENGTH = 10000;

export interface UserBookNoteDto {
  note: string | null;
  updatedAt: string;
}

@Injectable()
export class UserBookNoteService {
  constructor(private readonly repo: UserBookNoteRepository) {}

  async findOne(userId: number, bookId: number): Promise<UserBookNoteDto | null> {
    const row = await this.repo.findOne(userId, bookId);
    return row ? this.toDto(row) : null;
  }

  async findRow(userId: number, bookId: number): Promise<UserBookNoteRow | null> {
    return this.repo.findOne(userId, bookId);
  }

  async findByBookIds(userId: number, bookIds: number[]): Promise<Map<number, UserBookNoteDto>> {
    const rows = await this.repo.findByBookIds(userId, bookIds);
    const map = new Map<number, UserBookNoteDto>();
    for (const row of rows) {
      map.set(row.bookId, this.toDto(row));
    }
    return map;
  }

  async setNote(userId: number, bookId: number, rawNote: string | null | undefined, updatedAt = new Date()): Promise<UserBookNoteDto> {
    const note = this.normalizeNote(rawNote);
    const row = await this.repo.upsert(userId, bookId, note, updatedAt);
    return this.toDto(row);
  }

  normalizeNote(rawNote: string | null | undefined): string | null {
    if (rawNote == null) return null;
    const trimmed = rawNote.trim();
    if (trimmed === '') return null;
    return trimmed.length > USER_BOOK_NOTE_MAX_LENGTH ? trimmed.slice(0, USER_BOOK_NOTE_MAX_LENGTH) : trimmed;
  }

  private toDto(row: UserBookNoteRow): UserBookNoteDto {
    return {
      note: row.note ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
