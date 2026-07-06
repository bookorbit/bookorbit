import { Injectable, Logger } from '@nestjs/common';

import { READWISE_AUTO_SYNC_DEBOUNCE_MS } from './readwise.constants';
import { ReadwiseSyncService } from './readwise-sync.service';

interface AutoSyncState {
  userId: number;
  timer: NodeJS.Timeout | null;
  inFlight: boolean;
  pending: boolean;
}

@Injectable()
export class ReadwiseAutoSyncSchedulerService {
  private readonly logger = new Logger(ReadwiseAutoSyncSchedulerService.name);
  private readonly states = new Map<number, AutoSyncState>();
  private readonly userSyncQueues = new Map<number, Promise<void>>();

  constructor(private readonly syncService: ReadwiseSyncService) {}

  requestSync(userId: number): void {
    const state = this.states.get(userId) ?? { userId, timer: null, inFlight: false, pending: false };
    this.states.set(userId, state);
    state.pending = true;
    if (state.inFlight) return;
    this.schedule(state);
  }

  private schedule(state: AutoSyncState): void {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      void this.runDue(state.userId);
    }, READWISE_AUTO_SYNC_DEBOUNCE_MS);
  }

  private async runDue(userId: number): Promise<void> {
    const state = this.states.get(userId);
    if (!state || state.inFlight || !state.pending) return;
    state.pending = false;
    state.inFlight = true;
    try {
      await this.enqueue(userId, () => this.syncService.flush(userId));
    } catch (err) {
      this.logger.error(`[readwise.scheduler] flush failed userId=${userId}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      state.inFlight = false;
      if (state.pending) this.schedule(state);
      else this.states.delete(userId);
    }
  }

  private enqueue(userId: number, task: () => Promise<void>): Promise<void> {
    const previous = this.userSyncQueues.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.userSyncQueues.set(userId, current);
    current
      .finally(() => {
        if (this.userSyncQueues.get(userId) === current) this.userSyncQueues.delete(userId);
      })
      .catch(() => undefined);
    return current;
  }
}
