import { Injectable } from '@nestjs/common';
import type { ReadStatus, UserBookStatus } from '@projectx/types';
import { UserBookStatusRepository } from './user-book-status.repository';
import type { UserBookStatusRow } from '../../db/schema';

const DEFAULT_FINISH_THRESHOLD = 98;
const READING_THRESHOLD = 0.25;

@Injectable()
export class UserBookStatusService {
  constructor(private readonly repo: UserBookStatusRepository) {}

  async setManual(userId: number, bookId: number, status: ReadStatus): Promise<void> {
    await this.repo.upsert(userId, bookId, status, 'manual', new Date());
  }

  async autoUpdate(
    userId: number,
    bookId: number,
    percentage: number,
    readingThreshold?: number | null,
    finishThreshold?: number | null,
  ): Promise<void> {
    const existing = await this.repo.findOne(userId, bookId);

    if (existing?.source === 'manual') return;

    const readTh = readingThreshold ?? READING_THRESHOLD;
    const finishTh = finishThreshold ?? DEFAULT_FINISH_THRESHOLD;
    const derived: ReadStatus = percentage >= finishTh ? 'read' : percentage >= readTh ? 'reading' : 'unread';

    if (!existing && derived === 'unread') return;
    if (existing?.status === derived) return;

    await this.repo.upsert(userId, bookId, derived, 'auto', new Date(), existing);
  }

  async findOne(userId: number, bookId: number): Promise<UserBookStatus | null> {
    const row = await this.repo.findOne(userId, bookId);
    return row ? this.toDto(row) : null;
  }

  async findByBookIds(userId: number, bookIds: number[]): Promise<Map<number, UserBookStatus>> {
    const rows = await this.repo.findByBookIds(userId, bookIds);
    const map = new Map<number, UserBookStatus>();
    for (const row of rows) {
      map.set(row.bookId, this.toDto(row));
    }
    return map;
  }

  private toDto(row: UserBookStatusRow): UserBookStatus {
    return {
      status: row.status as ReadStatus,
      source: row.source as 'auto' | 'manual',
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
