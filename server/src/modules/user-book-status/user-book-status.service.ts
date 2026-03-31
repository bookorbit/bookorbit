import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { ReadStatus, UserBookStatus } from '@projectx/types';
import { UserBookStatusRepository } from './user-book-status.repository';
import type { UserBookStatusRow } from '../../db/schema';
import { isReadStatus, isReadStatusSource } from './user-book-status.constants';

const DEFAULT_FINISH_THRESHOLD = 98;
const READING_THRESHOLD = 0.25;
const MIN_PERCENTAGE = 0;
const MAX_PERCENTAGE = 100;

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

    const normalizedPercentage = this.normalizePercentage(percentage);
    const { readThreshold, finishThreshold: normalizedFinishThreshold } = this.normalizeThresholds(readingThreshold, finishThreshold);
    const derived: ReadStatus =
      normalizedPercentage >= normalizedFinishThreshold ? 'read' : normalizedPercentage >= readThreshold ? 'reading' : 'unread';

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
    const status = this.toReadStatus(row.status);
    const source = this.toReadStatusSource(row.source);

    return {
      status,
      source,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private normalizePercentage(value: number): number {
    if (!Number.isFinite(value)) return MIN_PERCENTAGE;
    return Math.min(MAX_PERCENTAGE, Math.max(MIN_PERCENTAGE, value));
  }

  private normalizeThresholds(readingThreshold?: number | null, finishThreshold?: number | null) {
    const normalizedReading = this.normalizeThreshold(readingThreshold, READING_THRESHOLD);
    const normalizedFinish = this.normalizeThreshold(finishThreshold, DEFAULT_FINISH_THRESHOLD);
    if (normalizedReading <= normalizedFinish) {
      return { readThreshold: normalizedReading, finishThreshold: normalizedFinish };
    }
    return { readThreshold: normalizedFinish, finishThreshold: normalizedFinish };
  }

  private normalizeThreshold(value: number | null | undefined, fallback: number): number {
    if (value == null || !Number.isFinite(value)) return fallback;
    return Math.min(MAX_PERCENTAGE, Math.max(MIN_PERCENTAGE, value));
  }

  private toReadStatus(value: string): ReadStatus {
    if (!isReadStatus(value)) {
      throw new InternalServerErrorException(`Invalid read status value: ${value}`);
    }
    return value;
  }

  private toReadStatusSource(value: string): 'auto' | 'manual' {
    if (!isReadStatusSource(value)) {
      throw new InternalServerErrorException(`Invalid read status source value: ${value}`);
    }
    return value;
  }
}
