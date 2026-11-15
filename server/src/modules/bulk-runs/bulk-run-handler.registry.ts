import { Injectable } from '@nestjs/common';
import type { BulkRunKind } from '@bookorbit/types';

import type { BulkRunHandler } from './bulk-run-handler';

@Injectable()
export class BulkRunHandlerRegistry {
  private readonly handlers = new Map<BulkRunKind, BulkRunHandler>();

  register<S>(handler: BulkRunHandler<S>): void {
    if (this.handlers.has(handler.kind)) throw new Error(`Bulk run kind ${handler.kind} is registered twice`);
    this.handlers.set(handler.kind, handler as BulkRunHandler);
  }

  get(kind: BulkRunKind): BulkRunHandler | null {
    return this.handlers.get(kind) ?? null;
  }
}
