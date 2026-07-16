import { Injectable } from '@nestjs/common';

import { READWISE_MIN_INTERVAL_MS } from './readwise.constants';

@Injectable()
export class ReadwiseQueueService {
  private readonly lastRequestAt = new Map<number, number>();

  async throttle(userId: number): Promise<void> {
    const last = this.lastRequestAt.get(userId);
    if (last !== undefined) {
      const elapsed = Date.now() - last;
      if (elapsed < READWISE_MIN_INTERVAL_MS) {
        const wait = READWISE_MIN_INTERVAL_MS - elapsed;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    this.lastRequestAt.set(userId, Date.now());
  }

  resetUser(userId: number): void {
    this.lastRequestAt.delete(userId);
  }
}
