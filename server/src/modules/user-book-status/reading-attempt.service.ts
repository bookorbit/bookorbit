import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ReadingAttempt,
  ReadingAttemptListResponse,
  ReadingAttemptOrigin,
  ReadingAttemptOutcome,
  ReadingAttemptPatch,
  ReadStatus,
  UserBookStatus,
} from '@bookorbit/types';

import { ReadingAttemptRepository } from './reading-attempt.repository';

function dateToUtcDate(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function outcomeForStatus(status: ReadStatus): ReadingAttemptOutcome | null {
  if (status === 'read') return 'completed';
  if (status === 'skimmed') return 'skimmed';
  if (status === 'abandoned') return 'abandoned';
  return null;
}

@Injectable()
export class ReadingAttemptService {
  constructor(private readonly repo: ReadingAttemptRepository) {}

  async applyManualStatus(
    userId: number,
    bookId: number,
    status: ReadStatus,
    startedOn: string | null | undefined,
    endedOn: string | null | undefined,
    today: string,
  ): Promise<UserBookStatus> {
    return this.repo.transaction(async (tx) => {
      let active: Awaited<ReturnType<ReadingAttemptRepository['findActive']>> | null = await this.repo.findActive(tx, userId, bookId);
      let latest = active ?? (await this.repo.findLatest(tx, userId, bookId));

      if (status === 'rereading' && !(await this.repo.hasCompleted(tx, userId, bookId))) {
        await this.repo.create(tx, {
          userId,
          bookId,
          startedOn: null,
          endedOn: null,
          outcome: 'completed',
          origin: 'migration',
        });
      }

      if (status === 'reading' || status === 'rereading' || status === 'on_hold') {
        if (!active) {
          active = await this.repo.createActive(tx, {
            userId,
            bookId,
            startedOn: startedOn === undefined ? today : startedOn,
            origin: 'manual',
          });
        } else if (startedOn !== undefined) {
          active = await this.repo.update(tx, userId, bookId, active.id, { startedOn });
        }
        latest = active;
      } else {
        const outcome = outcomeForStatus(status);
        if (outcome) {
          if (active) {
            latest = await this.repo.update(tx, userId, bookId, active.id, {
              ...(startedOn !== undefined ? { startedOn } : {}),
              endedOn: endedOn === undefined ? today : endedOn,
              outcome,
            });
            active = null;
          } else if (latest?.outcome !== outcome) {
            latest = await this.repo.create(tx, {
              userId,
              bookId,
              startedOn: startedOn ?? null,
              endedOn: endedOn === undefined ? today : endedOn,
              outcome,
              origin: 'manual',
            });
          }
        } else if (active) {
          latest = await this.repo.update(tx, userId, bookId, active.id, {
            endedOn: endedOn === undefined ? today : endedOn,
            outcome: 'abandoned',
          });
          active = null;
        }
      }

      if (startedOn !== undefined || endedOn !== undefined) {
        const target = active ?? latest;
        if (target) {
          latest = await this.repo.update(tx, userId, bookId, target.id, {
            ...(startedOn !== undefined ? { startedOn } : {}),
            ...(endedOn !== undefined ? { endedOn } : {}),
          });
        }
      }

      const completedBefore = await this.repo.hasCompleted(tx, userId, bookId);
      const projectedStatus = active ? (status === 'on_hold' ? 'on_hold' : completedBefore ? 'rereading' : 'reading') : status;
      const projectionTarget = active ?? latest;
      const startedAt = dateToUtcDate(projectionTarget?.startedOn ?? null);
      const finishedAt = projectionTarget?.outcome === 'completed' ? dateToUtcDate(projectionTarget.endedOn) : null;
      await this.repo.project(tx, userId, bookId, { status: projectedStatus, source: 'manual', startedAt, finishedAt });
      return {
        status: projectedStatus,
        source: 'manual',
        startedAt: projectionTarget?.startedOn ?? null,
        finishedAt: projectionTarget?.outcome === 'completed' ? (projectionTarget.endedOn ?? null) : null,
        updatedAt: new Date().toISOString(),
      };
    });
  }

  async recordActivity(input: {
    userId: number;
    bookId: number;
    occurredOn: string;
    origin: Exclude<ReadingAttemptOrigin, 'manual' | 'hardcover' | 'migration'>;
    progress: number;
    finishThreshold: number;
    strongRereadEvidence: boolean;
    meaningfulActivity: boolean;
  }): Promise<UserBookStatus | null> {
    return this.repo.transaction(async (tx) => {
      let active: Awaited<ReturnType<ReadingAttemptRepository['findActive']>> | null = await this.repo.findActive(tx, input.userId, input.bookId);
      let latest = active ?? (await this.repo.findLatest(tx, input.userId, input.bookId));
      const hasCompleted = await this.repo.hasCompleted(tx, input.userId, input.bookId);
      const isFinished = input.progress >= input.finishThreshold;

      if (!active && hasCompleted && !input.strongRereadEvidence && !input.meaningfulActivity) return null;
      if (!active && isFinished && !hasCompleted) {
        latest = await this.repo.create(tx, {
          userId: input.userId,
          bookId: input.bookId,
          startedOn: null,
          endedOn: input.occurredOn,
          outcome: 'completed',
          origin: input.origin,
        });
      }
      if (!active && isFinished && hasCompleted && input.strongRereadEvidence) {
        latest = await this.repo.create(tx, {
          userId: input.userId,
          bookId: input.bookId,
          startedOn: input.occurredOn,
          endedOn: input.occurredOn,
          outcome: 'completed',
          origin: input.origin,
        });
      }
      if (!active && !isFinished && (input.progress > 0 || input.strongRereadEvidence || input.meaningfulActivity)) {
        active = await this.repo.createActive(tx, {
          userId: input.userId,
          bookId: input.bookId,
          startedOn: input.occurredOn,
          origin: input.origin,
        });
      }

      let projectionTarget = active ?? latest;
      let status: ReadStatus;
      if (active && isFinished) {
        projectionTarget = await this.repo.update(tx, input.userId, input.bookId, active.id, {
          endedOn: input.occurredOn,
          outcome: 'completed',
        });
        status = 'read';
      } else if (active) {
        status = hasCompleted ? 'rereading' : 'reading';
      } else if (latest?.outcome === 'completed') {
        status = 'read';
      } else {
        return null;
      }

      await this.repo.project(tx, input.userId, input.bookId, {
        status,
        source: 'auto',
        startedAt: dateToUtcDate(projectionTarget?.startedOn ?? null),
        finishedAt: projectionTarget?.outcome === 'completed' ? dateToUtcDate(projectionTarget.endedOn) : null,
      });
      return {
        status,
        source: 'auto',
        startedAt: projectionTarget?.startedOn ?? null,
        finishedAt: projectionTarget?.outcome === 'completed' ? (projectionTarget.endedOn ?? null) : null,
        updatedAt: new Date().toISOString(),
      };
    });
  }

  async list(userId: number, bookId: number, page = 1, pageSize = 20): Promise<ReadingAttemptListResponse> {
    const result = await this.repo.list(userId, bookId, page, pageSize);
    return {
      items: result.items.map((row) => this.toDto(row)),
      page,
      pageSize,
      total: result.total,
    };
  }

  async createHistorical(
    userId: number,
    bookId: number,
    input: { startedOn?: string | null; endedOn?: string | null; outcome: ReadingAttemptOutcome },
  ): Promise<ReadingAttempt> {
    this.validateDates(input.startedOn ?? null, input.endedOn ?? null);
    const row = await this.repo.transaction((tx) =>
      this.repo.create(tx, {
        userId,
        bookId,
        startedOn: input.startedOn ?? null,
        endedOn: input.endedOn ?? null,
        outcome: input.outcome,
        origin: 'manual',
      }),
    );
    await this.rebuildProjection(userId, bookId);
    return this.toDto({ ...row, totalSessions: 0, totalSeconds: 0 });
  }

  async importExternalRead(
    userId: number,
    bookId: number,
    input: { provider: 'hardcover'; externalId: string; startedOn: string | null; endedOn: string | null },
  ): Promise<void> {
    this.validateDates(input.startedOn, input.endedOn);
    await this.repo.transaction(async (tx) => {
      const existing = await this.repo.findByExternal(tx, userId, input.provider, input.externalId);
      if (existing?.deletedAt) return;
      if (existing) {
        await this.repo.update(tx, userId, bookId, existing.id, {
          ...(existing.startedOn === null && input.startedOn !== null ? { startedOn: input.startedOn } : {}),
          ...(existing.endedOn === null && input.endedOn !== null ? { endedOn: input.endedOn, outcome: 'completed' } : {}),
        });
        return;
      }
      const active = input.endedOn === null ? await this.repo.findActive(tx, userId, bookId) : null;
      if (input.endedOn === null && !active) {
        await this.repo.createActive(tx, {
          userId,
          bookId,
          startedOn: input.startedOn,
          origin: 'hardcover',
          externalProvider: input.provider,
          externalId: input.externalId,
        });
      } else {
        await this.repo.create(tx, {
          userId,
          bookId,
          startedOn: input.startedOn,
          endedOn: input.endedOn,
          outcome: input.endedOn ? 'completed' : 'abandoned',
          origin: 'hardcover',
          externalProvider: input.provider,
          externalId: input.externalId,
        });
      }
    });
  }

  async update(userId: number, bookId: number, attemptId: number, patch: ReadingAttemptPatch): Promise<ReadingAttempt> {
    const existing = await this.repo.findOwned(userId, bookId, attemptId);
    if (!existing) throw new NotFoundException('Reading attempt not found');
    const startedOn = patch.startedOn === undefined ? existing.startedOn : patch.startedOn;
    const endedOn = patch.endedOn === undefined ? existing.endedOn : patch.endedOn;
    const outcome = patch.outcome === undefined ? existing.outcome : patch.outcome;
    this.validateDates(startedOn, endedOn);
    if (endedOn && outcome === null) throw new BadRequestException('A closed attempt requires an outcome');
    const row = await this.repo.transaction((tx) => this.repo.update(tx, userId, bookId, attemptId, patch));
    if (!row) throw new NotFoundException('Reading attempt not found');
    await this.rebuildProjection(userId, bookId);
    return this.toDto({ ...row, totalSessions: 0, totalSeconds: 0 });
  }

  async delete(userId: number, bookId: number, attemptId: number): Promise<void> {
    if (!(await this.repo.softDelete(userId, bookId, attemptId))) throw new NotFoundException('Reading attempt not found');
    await this.rebuildProjection(userId, bookId);
  }

  private async rebuildProjection(userId: number, bookId: number): Promise<void> {
    await this.repo.transaction(async (tx) => {
      const active = await this.repo.findActive(tx, userId, bookId);
      const latest = active ?? (await this.repo.findLatest(tx, userId, bookId));
      const current = await this.repo.findStatus(tx, userId, bookId);
      const hasCompleted = await this.repo.hasCompleted(tx, userId, bookId);
      const target = active ?? latest;
      let status: ReadStatus = 'unread';
      if (active) status = current?.status === 'on_hold' ? 'on_hold' : hasCompleted ? 'rereading' : 'reading';
      else if (current?.status === 'want_to_read' || current?.status === 'unread') status = current.status;
      else if (latest?.outcome === 'completed') status = 'read';
      else if (latest?.outcome === 'skimmed') status = 'skimmed';
      else if (latest?.outcome === 'abandoned') status = 'abandoned';
      await this.repo.project(tx, userId, bookId, {
        status,
        source: 'manual',
        startedAt: dateToUtcDate(target?.startedOn ?? null),
        finishedAt: target?.outcome === 'completed' ? dateToUtcDate(target.endedOn) : null,
      });
    });
  }

  private validateDates(startedOn: string | null, endedOn: string | null): void {
    if (startedOn && endedOn && endedOn < startedOn) throw new BadRequestException('endedOn must be on or after startedOn');
  }

  private toDto(row: {
    id: number;
    bookId: number;
    startedOn: string | null;
    endedOn: string | null;
    outcome: ReadingAttemptOutcome | null;
    origin: ReadingAttemptOrigin;
    externalProvider: string | null;
    externalId: string | null;
    totalSessions: number;
    totalSeconds: number;
    createdAt: Date;
    updatedAt: Date;
  }): ReadingAttempt {
    return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }
}
