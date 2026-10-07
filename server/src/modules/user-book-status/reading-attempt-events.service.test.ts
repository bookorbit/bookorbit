import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { READING_ATTEMPT_CHANGED, ReadingAttemptEventsService } from './reading-attempt-events.service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('ReadingAttemptEventsService', () => {
  let events: ReadingAttemptEventsService;
  let listener: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [ReadingAttemptEventsService] }).compile();
    events = module.get(ReadingAttemptEventsService);
    listener = vi.fn();
    events.on(READING_ATTEMPT_CHANGED, listener);
  });

  it('notifies a single mutation synchronously', () => {
    events.notifyChanged(1);
    expect(listener).toHaveBeenCalledExactlyOnceWith({ userId: 1 });
  });

  it('routes direct emit calls through batching and error isolation', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    events.prependListener(READING_ATTEMPT_CHANGED, () => {
      throw new Error('Listener failed');
    });
    await events.coalesceChanges(() => {
      expect(events.emit(READING_ATTEMPT_CHANGED, { userId: 1 })).toBe(true);
      events.emit(READING_ATTEMPT_CHANGED, { userId: 1 });
      expect(listener).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });
    expect(listener).toHaveBeenCalledExactlyOnceWith({ userId: 1 });
    expect(warn).toHaveBeenCalledOnce();
    expect(() => events.emit(READING_ATTEMPT_CHANGED, { userId: 11 })).not.toThrow();
    expect(listener).toHaveBeenLastCalledWith({ userId: 11 });
    warn.mockRestore();
  });

  it('coalesces repeated and nested changes by user', async () => {
    await events.coalesceChanges(async () => {
      for (let i = 0; i < 10000; i++) events.notifyChanged(1);
      await events.coalesceChanges(() => {
        events.notifyChanged(1);
        events.notifyChanged(11);
      });
      expect(listener).not.toHaveBeenCalled();
    });
    expect(listener.mock.calls).toEqual([[{ userId: 1 }], [{ userId: 11 }]]);
  });

  it('flushes committed changes even if later work fails, preserving the original error', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    events.prependListener(READING_ATTEMPT_CHANGED, () => {
      throw new Error('Listener failed');
    });
    const original = new Error('Write failed');
    await expect(
      events.coalesceChanges(() => {
        events.notifyChanged(1);
        throw original;
      }),
    ).rejects.toBe(original);
    expect(listener).toHaveBeenCalledExactlyOnceWith({ userId: 1 });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('isolates a throwing listener and preserves once listeners', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const once = vi.fn();
    events.prependListener(READING_ATTEMPT_CHANGED, () => {
      throw new Error('Listener failed');
    });
    events.once(READING_ATTEMPT_CHANGED, once);
    expect(() => events.notifyChanged(1)).not.toThrow();
    events.notifyChanged(1);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(once).toHaveBeenCalledExactlyOnceWith({ userId: 1 });
    warn.mockRestore();
  });

  it('flushes changes for a reader during a batch and flushes later writes again at the end', async () => {
    await events.coalesceChanges(() => {
      events.notifyChanged(1);
      events.notifyChanged(11);
      events.flushPendingChanges(1);
      expect(listener).toHaveBeenCalledExactlyOnceWith({ userId: 1 });
      events.flushPendingChanges(1);
      expect(listener).toHaveBeenCalledOnce();
      events.notifyChanged(1);
    });
    expect(listener.mock.calls).toEqual([[{ userId: 1 }], [{ userId: 11 }], [{ userId: 1 }]]);
  });

  it('keeps unrelated requests independent of a running batch for the same user', async () => {
    const gate = deferred();
    const batch = events.coalesceChanges(async () => {
      events.notifyChanged(1);
      await gate.promise;
    });
    events.notifyChanged(1);
    expect(listener).toHaveBeenCalledExactlyOnceWith({ userId: 1 });
    gate.resolve();
    await batch;
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('flushes shared deletions during a batch for any reader', async () => {
    await events.coalesceChanges(() => {
      events.notifyChanged(null);
      events.flushPendingChanges(11);
      expect(listener).toHaveBeenCalledExactlyOnceWith({ userId: null });
    });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not strand changes from work that outlives its batch context', async () => {
    const gate = deferred();
    let late!: Promise<void>;
    await events.coalesceChanges(() => {
      late = gate.promise.then(() => events.notifyChanged(1));
    });
    gate.resolve();
    await late;
    expect(listener).toHaveBeenCalledExactlyOnceWith({ userId: 1 });
  });
});
