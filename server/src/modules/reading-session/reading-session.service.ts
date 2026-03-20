import { Injectable } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import type { SaveReadingSessionDto } from './dto/save-reading-session.dto';
import { ReadingSessionRepository } from './reading-session.repository';

@Injectable()
export class ReadingSessionService {
  constructor(
    private readonly repo: ReadingSessionRepository,
    private readonly bookService: BookService,
  ) {}

  async save(fileId: number, dto: SaveReadingSessionDto, user: RequestUser): Promise<void> {
    await this.bookService.verifyFileAccess(fileId, user);

    const startedAt = new Date(dto.startedAt);
    const endedAt = new Date(dto.endedAt);
    const wallClockSeconds = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));

    // Client sends active reading time (excludes idle/hidden periods); cap it at the wall-clock
    // span to prevent the client from reporting more time than physically elapsed.
    const durationSeconds = Math.min(dto.durationSeconds, wallClockSeconds);

    await this.repo.saveSession(
      user.id,
      fileId,
      dto.sessionId,
      startedAt,
      endedAt,
      durationSeconds,
      dto.progressDelta ?? null,
      dto.endProgress ?? null,
    );
  }
}
