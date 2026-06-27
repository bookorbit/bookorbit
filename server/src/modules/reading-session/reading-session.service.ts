import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { BookReadingSession, BookReadingSessionListResponse, ReadingSessionSource, UserSettings } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import { BookService } from '../book/book.service';
import { AchievementEventsService, ACHIEVEMENT_EVENT_READING_SESSION_SAVED } from '../achievement/achievement-events.service';
import type { CreateManualReadingSessionDto } from './dto/create-manual-reading-session.dto';
import type { ListBookReadingSessionsDto } from './dto/list-book-reading-sessions.dto';
import type { SaveReadingSessionDto } from './dto/save-reading-session.dto';
import { ReadingSessionRepository } from './reading-session.repository';

@Injectable()
export class ReadingSessionService {
  private readonly logger = new Logger(ReadingSessionService.name);

  constructor(
    private readonly repo: ReadingSessionRepository,
    private readonly bookService: BookService,
    private readonly achievementEvents: AchievementEventsService,
  ) {}

  private resolveUserTimeZone(user: RequestUser): string {
    return resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
  }

  async save(fileId: number, dto: SaveReadingSessionDto, user: RequestUser, source: ReadingSessionSource = 'web'): Promise<void> {
    const event = 'reading_session.save';
    const startedAtMs = Date.now();
    this.logger.log(
      `[${event}] [start] fileId=${fileId} userId=${user.id} sessionId=${dto.sessionId} clientDurationSeconds=${dto.durationSeconds} - reading session save started`,
    );

    try {
      await this.bookService.verifyFileAccess(fileId, user);

      const startedAt = new Date(dto.startedAt);
      const endedAt = new Date(dto.endedAt);
      if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
        throw new BadRequestException('Invalid reading session timestamps');
      }
      if (endedAt.getTime() < startedAt.getTime()) {
        throw new BadRequestException('endedAt must be greater than or equal to startedAt');
      }

      const wallClockSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);

      // Client sends active reading time (excludes idle/hidden periods); cap it at the wall-clock
      // span to prevent the client from reporting more time than physically elapsed.
      const durationSeconds = Math.min(dto.durationSeconds, wallClockSeconds);

      const result = await this.repo.saveSession(
        user.id,
        fileId,
        dto.sessionId,
        startedAt,
        endedAt,
        durationSeconds,
        dto.progressDelta ?? null,
        dto.endProgress ?? null,
        source,
        this.resolveUserTimeZone(user),
      );

      this.logger.log(
        `[${event}] [end] fileId=${fileId} userId=${user.id} sessionId=${dto.sessionId} durationMs=${Date.now() - startedAtMs} outcome=${result.kind}${result.kind === 'skipped' ? ` reason=${result.reason}` : ''} - reading session save completed`,
      );

      if (result.kind === 'saved') {
        this.achievementEvents.emit(ACHIEVEMENT_EVENT_READING_SESSION_SAVED, {
          userId: user.id,
          bookFileId: fileId,
          durationSeconds,
          startedAt,
          endedAt,
          progressDelta: dto.progressDelta ?? null,
          endProgress: dto.endProgress ?? null,
          timezone: (user.settings as unknown as UserSettings)?.timezone ?? 'UTC',
        });
      }
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : 'unknown error');
      this.logger.warn(
        `[${event}] [fail] fileId=${fileId} userId=${user.id} sessionId=${dto.sessionId} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${errorMessage}" - reading session save failed`,
      );
      throw error;
    }
  }

  async createManualSession(bookId: number, dto: CreateManualReadingSessionDto, user: RequestUser): Promise<BookReadingSession> {
    const event = 'book.reading_session.create_manual';
    const startedAtMs = Date.now();
    this.logger.log(
      `[${event}] [start] bookId=${bookId} userId=${user.id} durationMinutes=${dto.durationMinutes} - create manual reading session started`,
    );

    try {
      await this.bookService.verifyBookAccess(bookId, user);

      const startedAt = new Date(dto.startedAt);
      if (Number.isNaN(startedAt.getTime())) {
        throw new BadRequestException('Invalid startedAt timestamp');
      }
      if (startedAt.getTime() > Date.now()) {
        throw new BadRequestException('startedAt cannot be in the future');
      }

      const durationSeconds = dto.durationMinutes * 60;
      const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);

      const context = await this.repo.findBookContext(bookId);
      if (!context) {
        throw new NotFoundException('Book not found');
      }

      let bookFileId: number | null = null;
      if (dto.format) {
        const match = context.files.find((f) => f.format?.toUpperCase() === dto.format!.toUpperCase());
        if (!match) {
          throw new BadRequestException(`No ${dto.format.toUpperCase()} file on this book`);
        }
        bookFileId = match.id;
      } else if (context.files.length === 1) {
        bookFileId = context.files[0].id;
      }

      let progressDelta: number | null = null;
      const endProgress = dto.endProgress ?? null;
      if (endProgress !== null) {
        const previous = (await this.repo.findLatestEndProgressBefore(user.id, bookId, startedAt)) ?? 0;
        progressDelta = Math.round(Math.max(-100, Math.min(100, endProgress - previous)) * 100) / 100;
      }

      const created = await this.repo.insertManualSession({
        userId: user.id,
        bookId,
        libraryId: context.libraryId,
        bookFileId,
        sessionId: `manual:${randomUUID()}`,
        startedAt,
        endedAt,
        durationSeconds,
        progressDelta,
        endProgress,
        timeZone: this.resolveUserTimeZone(user),
      });

      // No achievement event: the payload requires a non-null bookFileId, and retroactive
      // manual entries would allow farming time-based achievements.

      this.logger.log(
        `[${event}] [end] bookId=${bookId} userId=${user.id} sessionId=${created.id} durationMs=${Date.now() - startedAtMs} - create manual reading session completed`,
      );

      const format = bookFileId !== null ? (context.files.find((f) => f.id === bookFileId)?.format ?? null) : null;

      return {
        id: created.id,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationSeconds,
        progressDelta,
        endProgress,
        format,
        source: 'manual',
      };
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${event}] [fail] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : 'unknown error')}" - create manual reading session failed`,
      );
      throw error;
    }
  }

  async listByBook(bookId: number, user: RequestUser, query: ListBookReadingSessionsDto): Promise<BookReadingSessionListResponse> {
    const event = 'book.reading_sessions.list';
    const startedAtMs = Date.now();
    this.logger.log(`[${event}] [start] bookId=${bookId} userId=${user.id} - list reading sessions started`);
    try {
      await this.bookService.verifyBookAccess(bookId, user);
      const result = await this.repo.listByBook(
        user.id,
        bookId,
        query.page ?? 1,
        query.pageSize ?? 25,
        query.sortBy ?? 'startedAt',
        query.sortDir ?? 'desc',
        query.dateFrom,
        query.dateTo,
        query.format,
        this.resolveUserTimeZone(user),
      );
      this.logger.log(
        `[${event}] [end] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAtMs} total=${result.total} - list reading sessions completed`,
      );
      return result;
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${event}] [fail] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : 'unknown error')}" - list reading sessions failed`,
      );
      throw error;
    }
  }

  async deleteSessionByBook(bookId: number, sessionId: number, user: RequestUser): Promise<void> {
    const event = 'book.reading_session.delete';
    const startedAtMs = Date.now();
    this.logger.log(`[${event}] [start] bookId=${bookId} sessionId=${sessionId} userId=${user.id} - delete reading session started`);
    try {
      await this.bookService.verifyBookAccess(bookId, user);
      const result = await this.repo.deleteSessionByBook(user.id, bookId, sessionId, this.resolveUserTimeZone(user));
      if (!result.found) throw new NotFoundException('Reading session not found');
      this.logger.log(
        `[${event}] [end] bookId=${bookId} sessionId=${sessionId} userId=${user.id} durationMs=${Date.now() - startedAtMs} - delete reading session completed`,
      );
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${event}] [fail] bookId=${bookId} sessionId=${sessionId} userId=${user.id} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : 'unknown error')}" - delete reading session failed`,
      );
      throw error;
    }
  }
}
