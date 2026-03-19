import { MetadataProviderKey } from '@projectx/types';

import { ProviderThrottleTracker } from './provider-throttle.tracker';

describe('ProviderThrottleTracker', () => {
  let tracker: ProviderThrottleTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'));
    tracker = new ProviderThrottleTracker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns default runtime state for providers with no throttling history', () => {
    const snapshot = tracker.snapshot([MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY]);

    expect(snapshot.observedAt).toBe('2026-04-08T12:00:00.000Z');
    expect(snapshot.providers).toEqual([
      {
        key: MetadataProviderKey.GOOGLE,
        throttled: false,
        throttledUntil: null,
        remainingSeconds: 0,
        backoffLevel: 0,
      },
      {
        key: MetadataProviderKey.OPEN_LIBRARY,
        throttled: false,
        throttledUntil: null,
        remainingSeconds: 0,
        backoffLevel: 0,
      },
    ]);
  });

  it('reports active throttling with remaining time and backoff level', () => {
    tracker.record(MetadataProviderKey.GOOGLE, 125);

    const snapshot = tracker.snapshot([MetadataProviderKey.GOOGLE]);

    expect(snapshot.providers).toEqual([
      {
        key: MetadataProviderKey.GOOGLE,
        throttled: true,
        throttledUntil: '2026-04-08T12:02:05.000Z',
        remainingSeconds: 125,
        backoffLevel: 1,
      },
    ]);
  });

  it('keeps backoff history but marks runtime state as not throttled after cooldown expires', () => {
    tracker.record(MetadataProviderKey.GOOGLE, 30);
    vi.advanceTimersByTime(31_000);

    const snapshot = tracker.snapshot([MetadataProviderKey.GOOGLE]);

    expect(snapshot.providers).toEqual([
      {
        key: MetadataProviderKey.GOOGLE,
        throttled: false,
        throttledUntil: null,
        remainingSeconds: 0,
        backoffLevel: 1,
      },
    ]);
  });
});
