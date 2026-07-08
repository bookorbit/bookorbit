import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReadwiseAutoSyncSchedulerService } from './readwise-auto-sync-scheduler.service';
import {
  READWISE_AUTO_SYNC_DEBOUNCE_MS,
  READWISE_AUTO_SYNC_MAX_RETRIES,
  READWISE_AUTO_SYNC_MAX_WAIT_MS,
  READWISE_AUTO_SYNC_RETRY_BASE_MS,
} from './readwise.constants';
import { ReadwiseSyncService } from './readwise-sync.service';

const mockSyncService = {
  flush: vi.fn(),
};

function makeDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ReadwiseAutoSyncSchedulerService', () => {
  let service: ReadwiseAutoSyncSchedulerService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockSyncService.flush.mockResolvedValue(undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    service = new ReadwiseAutoSyncSchedulerService(mockSyncService as unknown as ReadwiseSyncService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('collapses multiple requests within the debounce window into a single flush', async () => {
    service.requestSync(1);
    await vi.advanceTimersByTimeAsync(500);
    service.requestSync(1);
    service.requestSync(1);

    await vi.advanceTimersByTimeAsync(READWISE_AUTO_SYNC_DEBOUNCE_MS - 1);
    expect(mockSyncService.flush).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(mockSyncService.flush).toHaveBeenCalledTimes(1);
    expect(mockSyncService.flush).toHaveBeenCalledWith(1);
  });

  it('flushes independently for different users', async () => {
    service.requestSync(1);
    service.requestSync(2);

    await vi.runAllTimersAsync();

    expect(mockSyncService.flush).toHaveBeenCalledTimes(2);
    expect(mockSyncService.flush).toHaveBeenCalledWith(1);
    expect(mockSyncService.flush).toHaveBeenCalledWith(2);
  });

  it('triggers a second flush for a fresh request after a completed flush', async () => {
    service.requestSync(1);
    await vi.runAllTimersAsync();
    expect(mockSyncService.flush).toHaveBeenCalledTimes(1);

    service.requestSync(1);
    await vi.runAllTimersAsync();

    expect(mockSyncService.flush).toHaveBeenCalledTimes(2);
    expect(mockSyncService.flush).toHaveBeenNthCalledWith(2, 1);
  });

  it('schedules exactly one follow-up flush for a request arriving while a flush is in flight', async () => {
    const firstFlush = makeDeferred<void>();
    mockSyncService.flush.mockReturnValueOnce(firstFlush.promise).mockResolvedValueOnce(undefined);

    service.requestSync(1);
    await vi.advanceTimersByTimeAsync(READWISE_AUTO_SYNC_DEBOUNCE_MS);
    expect(mockSyncService.flush).toHaveBeenCalledTimes(1);

    // Arrives while the first flush is still in flight.
    service.requestSync(1);
    await vi.advanceTimersByTimeAsync(READWISE_AUTO_SYNC_DEBOUNCE_MS);
    expect(mockSyncService.flush).toHaveBeenCalledTimes(1);

    // Complete the first flush; a follow-up should now be scheduled.
    firstFlush.resolve();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(READWISE_AUTO_SYNC_DEBOUNCE_MS - 1);
    expect(mockSyncService.flush).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mockSyncService.flush).toHaveBeenCalledTimes(2);
    expect(mockSyncService.flush).toHaveBeenNthCalledWith(2, 1);
  });

  it('does not postpone a pending flush past the max wait under continuous requests', async () => {
    service.requestSync(1);

    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(900);
      service.requestSync(1);
    }

    await vi.advanceTimersByTimeAsync(READWISE_AUTO_SYNC_MAX_WAIT_MS - 4500 - 1);
    expect(mockSyncService.flush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockSyncService.flush).toHaveBeenCalledTimes(1);
  });

  it('retries and logs transient flush failures', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    mockSyncService.flush.mockRejectedValueOnce(new Error('boom'));

    service.requestSync(1);
    await vi.runAllTimersAsync();

    expect(mockSyncService.flush).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[readwise.scheduler] [fail] userId=1'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`nextDelayMs=${READWISE_AUTO_SYNC_RETRY_BASE_MS}`));
  });

  it('stops retrying after the retry budget is exhausted', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockSyncService.flush.mockRejectedValue(new Error('boom'));

    service.requestSync(1);
    await vi.runAllTimersAsync();

    expect(mockSyncService.flush).toHaveBeenCalledTimes(READWISE_AUTO_SYNC_MAX_RETRIES + 1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('retryExhausted=true'));
  });
});
