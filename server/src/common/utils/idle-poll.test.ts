import { IDLE_POLL_INTERVAL_MS, IdlePoll } from './idle-poll';

describe('IdlePoll', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lets every poll through until one comes back empty', () => {
    const poll = new IdlePoll();
    expect(poll.begin()).toBeDefined();
    expect(poll.begin()).toBeDefined();
  });

  it('skips polls for the idle wait after an empty read, then looks again unwoken', () => {
    const poll = new IdlePoll();
    poll.begin()!();

    vi.advanceTimersByTime(IDLE_POLL_INTERVAL_MS - 1);
    expect(poll.begin()).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(poll.begin()).toBeDefined();
  });

  it('polls at once after a wake', () => {
    const poll = new IdlePoll();
    poll.begin()!();
    poll.wake();
    expect(poll.begin()).toBeDefined();
  });

  it('does not back off on an empty read that started before a wake', () => {
    const poll = new IdlePoll();
    const deferIfIdle = poll.begin()!;
    poll.wake();
    deferIfIdle();
    expect(poll.begin()).toBeDefined();
  });
});
