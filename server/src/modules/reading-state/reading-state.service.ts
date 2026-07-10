import { Injectable, Logger } from '@nestjs/common';

import type { ResetBookReadingStateResponse } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { ReadingStateRepository } from './reading-state.repository';

@Injectable()
export class ReadingStateService {
  private readonly logger = new Logger(ReadingStateService.name);

  constructor(
    private readonly bookService: BookService,
    private readonly repo: ReadingStateRepository,
  ) {}

  async resetBookReadingState(bookId: number, user: RequestUser): Promise<ResetBookReadingStateResponse> {
    const event = 'book.reading_state.reset';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] bookId=${bookId} userId=${user.id} - reset reading state started`);

    try {
      await this.bookService.verifyBookAccess(bookId, user);
      const timeZone = resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
      const result = await this.repo.resetBookReadingState(user.id, bookId, timeZone);
      this.logger.log(
        `[${event}] [end] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} sessionsDeleted=${result.sessionsDeleted} progressDeleted=${result.progressDeleted} audioProgressDeleted=${result.audioProgressDeleted} koreaderDeviceProgressDeleted=${result.koreaderDeviceProgressDeleted} koreaderPageStatsDeleted=${result.koreaderPageStatsDeleted} koboStateReset=${result.koboStateReset} - reset reading state completed`,
      );
      return { readStatus: result.readStatus };
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : 'unknown error');
      this.logger.warn(
        `[${event}] [fail] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - reset reading state failed`,
      );
      throw error;
    }
  }
}
