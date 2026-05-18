import { Injectable, Logger } from '@nestjs/common';

import { HARDCOVER_MIN_INTERVAL_MS } from './hardcover.constants';

@Injectable()
export class HardcoverQueueService {
  private readonly logger = new Logger(HardcoverQueueService.name);
  private readonly lastRequestAt = new Map<number, number>();

  async throttle(userId: number): Promise<void> {
    const last = this.lastRequestAt.get(userId);
    if (last !== undefined) {
      const elapsed = Date.now() - last;
      if (elapsed < HARDCOVER_MIN_INTERVAL_MS) {
        const wait = HARDCOVER_MIN_INTERVAL_MS - elapsed;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    this.lastRequestAt.set(userId, Date.now());
  }

  resetUser(userId: number): void {
    this.lastRequestAt.delete(userId);
  }
}
