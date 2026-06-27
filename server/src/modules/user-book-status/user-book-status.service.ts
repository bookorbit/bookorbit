import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { ReadStatus, UserBookStatus } from '@bookorbit/types';
import { UserBookStatusRepository } from './user-book-status.repository';
import type { UserBookStatusRow } from '../../db/schema';
import { isReadStatus, isReadStatusSource } from './user-book-status.constants';
import { AchievementEventsService, ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED } from '../achievement/achievement-events.service';

const DEFAULT_FINISH_THRESHOLD = 98;
const READING_THRESHOLD = 0.25;
const MIN_PERCENTAGE = 0;
const MAX_PERCENTAGE = 100;

type ManualStatusPatch = {
  status?: ReadStatus;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

@Injectable()
export class UserBookStatusService {
  constructor(
    private readonly repo: UserBookStatusRepository,
    private readonly achievementEvents: AchievementEventsService,
  ) {}

  async setManual(userId: number, bookId: number, status: ReadStatus): Promise<void> {
    await this.updateManual(userId, bookId, { status });
  }

  async updateManual(userId: number, bookId: number, patch: ManualStatusPatch): Promise<UserBookStatus> {
    const existing = await this.repo.findOne(userId, bookId);
    const now = new Date();
    const hasStatus = Object.prototype.hasOwnProperty.call(patch, 'status');
    const hasStartedAt = Object.prototype.hasOwnProperty.call(patch, 'startedAt');
    const hasFinishedAt = Object.prototype.hasOwnProperty.call(patch, 'finishedAt');

    const nextStatus = patch.status ?? existing?.status ?? 'unread';
    let nextStartedAt = hasStartedAt ? (patch.startedAt ?? null) : (existing?.startedAt ?? null);
    let nextFinishedAt = hasFinishedAt ? (patch.finishedAt ?? null) : (existing?.finishedAt ?? null);

    // When dates were not explicitly provided and would be null, seed from session history.
    // Explicit null patches (user clearing a date) are preserved as-is.
    // Mirror the same status guard used in repo.upsert(): unread/want_to_read always have null dates.
    const needsStartedAt = !hasStartedAt && nextStartedAt === null && nextStatus !== 'unread' && nextStatus !== 'want_to_read';
    const needsFinishedAt = !hasFinishedAt && nextFinishedAt === null && nextStatus === 'read';
    if (needsStartedAt || needsFinishedAt) {
      const boundaries = await this.repo.findSessionBoundariesForBook(userId, bookId);
      if (needsStartedAt) nextStartedAt = boundaries.firstStartedAt;
      if (needsFinishedAt) {
        const seeded = boundaries.lastEndedAt;
        // Only apply if the seeded end is not before the current startedAt.
        if (seeded !== null && (nextStartedAt === null || seeded >= nextStartedAt)) {
          nextFinishedAt = seeded;
        }
      }
    }

    const shouldPersist = existing !== null || hasStatus || nextStartedAt !== null || nextFinishedAt !== null;
    if (shouldPersist) {
      await this.repo.upsertState(userId, bookId, {
        status: nextStatus,
        source: 'manual',
        startedAt: nextStartedAt,
        finishedAt: nextFinishedAt,
        updatedAt: now,
      });
    }

    const previousStatus = existing?.status ?? null;
    if (hasStatus && nextStatus !== previousStatus) {
      this.achievementEvents.emit(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, {
        userId,
        bookId,
        newStatus: nextStatus,
        previousStatus,
      });
    }

    return {
      status: nextStatus,
      source: 'manual',
      startedAt: nextStartedAt?.toISOString() ?? null,
      finishedAt: nextFinishedAt?.toISOString() ?? null,
      updatedAt: now.toISOString(),
    };
  }

  async bulkSetManual(userId: number, bookIds: number[], status: ReadStatus): Promise<void> {
    if (bookIds.length === 0) return;
    const now = new Date();
    const existing = await this.repo.findByBookIds(userId, bookIds);
    const existingMap = new Map(existing.map((row) => [row.bookId, row]));
    await Promise.all(
      bookIds.map((bookId) => {
        const current = existingMap.get(bookId) ?? null;
        return this.repo.upsertState(userId, bookId, {
          status,
          source: 'manual',
          startedAt: current?.startedAt ?? null,
          finishedAt: current?.finishedAt ?? null,
          updatedAt: now,
        });
      }),
    );
    for (const bookId of bookIds) {
      const previousStatus = existingMap.get(bookId)?.status ?? null;
      if (status !== previousStatus) {
        this.achievementEvents.emit(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, {
          userId,
          bookId,
          newStatus: status,
          previousStatus,
        });
      }
    }
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

    const previousStatus = existing?.status ?? null;
    await this.repo.upsert(userId, bookId, derived, 'auto', new Date(), existing);
    this.achievementEvents.emit(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, {
      userId,
      bookId,
      newStatus: derived,
      previousStatus,
    });
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
      throw new InternalServerErrorException(`Invalid read status value: ${String(value)}`);
    }
    return value;
  }

  private toReadStatusSource(value: string): 'auto' | 'manual' {
    if (!isReadStatusSource(value)) {
      throw new InternalServerErrorException(`Invalid read status source value: ${String(value)}`);
    }
    return value;
  }
}
