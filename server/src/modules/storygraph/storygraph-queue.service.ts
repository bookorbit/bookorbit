import { Injectable, Logger } from '@nestjs/common';

import { STORYGRAPH_MIN_INTERVAL_MS } from './storygraph.constants';

@Injectable()
export class StorygraphQueueService {
  private readonly logger = new Logger(StorygraphQueueService.name);
  private readonly lastRequestAt = new Map<number, number>();

  async throttle(userId: number): Promise<void> {
    // Reserve the next slot synchronously so concurrent callers serialize instead of
    // reading the same lastRequestAt and firing together after identical waits.
    const now = Date.now();
    const last = this.lastRequestAt.get(userId);
    const slot = last === undefined ? now : Math.max(now, last + STORYGRAPH_MIN_INTERVAL_MS);
    this.lastRequestAt.set(userId, slot);
    const wait = slot - now;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  resetUser(userId: number): void {
    this.lastRequestAt.delete(userId);
  }
}
