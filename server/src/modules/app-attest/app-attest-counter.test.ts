import { acceptCounter, COUNTER_WINDOW, isFreshCounter, type CounterState } from './app-attest-counter';

const fresh = (): CounterState => ({ counter: 0, recentCounters: new Set() });

describe('app attest counter window', () => {
  it('accepts rising counters', () => {
    const state = fresh();
    for (const counter of [1, 2, 3]) {
      expect(isFreshCounter(state, counter)).toBe(true);
      acceptCounter(state, counter);
    }
    expect(state.counter).toBe(3);
  });

  it('accepts a lower counter that arrives late, once', () => {
    const state = fresh();
    acceptCounter(state, 3);
    expect(isFreshCounter(state, 1)).toBe(true);
    acceptCounter(state, 1);
    expect(isFreshCounter(state, 1)).toBe(false);
    expect(isFreshCounter(state, 3)).toBe(false);
    expect(isFreshCounter(state, 2)).toBe(true);
    expect(state.counter).toBe(3);
  });

  it('refuses counters older than the window', () => {
    const state = fresh();
    acceptCounter(state, 100);
    expect(isFreshCounter(state, 100 - COUNTER_WINDOW)).toBe(false);
    expect(isFreshCounter(state, 100 - COUNTER_WINDOW + 1)).toBe(true);
  });

  it('forgets used counters once they leave the window', () => {
    const state = fresh();
    acceptCounter(state, 1);
    acceptCounter(state, 1 + COUNTER_WINDOW);
    expect(state.recentCounters).toEqual(new Set([1 + COUNTER_WINDOW]));
    expect(isFreshCounter(state, 1)).toBe(false);
  });

  it('never accepts the attestation counter or a malformed one', () => {
    const state = fresh();
    for (const counter of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isFreshCounter(state, counter)).toBe(false);
    }
  });
});
