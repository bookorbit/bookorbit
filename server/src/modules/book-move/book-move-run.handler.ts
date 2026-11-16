import { Injectable, type OnModuleInit } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import type { BulkRunRow } from '../../db/schema';
import type { BulkItemOutcome, BulkRunEnd, BulkRunHandler, BulkRunItemContext } from '../bulk-runs/bulk-run-handler';
import { BulkRunHandlerRegistry } from '../bulk-runs/bulk-run-handler.registry';
import { BookMoveService, bookMoveDoneEvent, type BookMoveRunState } from './book-move.service';

/**
 * Moves books to another library as a bulk run, so a move goes on after the tab that started it
 * closes and can be cancelled from Jobs. The run holds the libraries' gate from its first book to
 * its last; while a scan or another move holds one of them, it waits in line.
 */
@Injectable()
export class BookMoveRunHandler implements BulkRunHandler<BookMoveRunState>, OnModuleInit {
  readonly kind = 'book-move' as const;
  /** `BookMoveService` reports a finished move under Bulk rename, with the library it moved to. */
  readonly notifiesCompletion = true;

  constructor(
    private readonly registry: BulkRunHandlerRegistry,
    private readonly moves: BookMoveService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  prepare(run: BulkRunRow, actor: RequestUser): Promise<{ state: BookMoveRunState } | 'busy'> {
    return this.moves.prepareRun(run, actor);
  }

  processItem(id: number, context: BulkRunItemContext<BookMoveRunState>): Promise<BulkItemOutcome> {
    return this.moves.moveOne(id, context.state, context.actor);
  }

  finish(run: BulkRunRow, state: BookMoveRunState | null, end: BulkRunEnd): Promise<void> {
    return this.moves.finishRun(run, state, end);
  }

  doneEvent(run: BulkRunRow): object {
    return bookMoveDoneEvent(run);
  }

  continuable(run: Omit<BulkRunRow, 'subjectIds'>): boolean {
    return this.moves.isContinuable(run);
  }
}
