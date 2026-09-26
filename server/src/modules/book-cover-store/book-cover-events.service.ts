import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import type { CoverRefreshedEvent } from '@bookorbit/types';

export const BOOK_COVER_CHANGED = 'book-cover.changed';

@Injectable()
export class BookCoverEventsService extends EventEmitter {
  emitChanged(event: CoverRefreshedEvent): void {
    this.emit(BOOK_COVER_CHANGED, event);
  }
}
