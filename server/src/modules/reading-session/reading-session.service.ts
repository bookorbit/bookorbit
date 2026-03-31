import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import type { SaveReadingSessionDto } from './dto/save-reading-session.dto';
import { ReadingSessionRepository } from './reading-session.repository';

@Injectable()
export class ReadingSessionService {
  private readonly logger = new Logger(ReadingSessionService.name);

  constructor(
    private readonly repo: ReadingSessionRepository,
    private readonly bookService: BookService,
  ) {}

  async save(fileId: number, dto: SaveReadingSessionDto, user: RequestUser): Promise<void> {
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
      );

      this.logger.log(
        `[${event}] [end] fileId=${fileId} userId=${user.id} sessionId=${dto.sessionId} durationMs=${Date.now() - startedAtMs} outcome=${result.kind}${result.kind === 'skipped' ? ` reason=${result.reason}` : ''} - reading session save completed`,
      );
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const errorMessage = (error instanceof Error ? error.message : 'unknown error').replaceAll('"', "'");
      this.logger.warn(
        `[${event}] [fail] fileId=${fileId} userId=${user.id} sessionId=${dto.sessionId} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${errorMessage}" - reading session save failed`,
      );
      throw error;
    }
  }
}
