import { RequestAutomationSearchDelay } from './request-automation-search-delay.service';

describe('RequestAutomationSearchDelay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([
    [0, 1_000],
    [0.5, 1_500],
    [0.999999, 2_000],
  ])('waits an inclusive random duration for random=%s', async (random, expectedMs) => {
    vi.spyOn(Math, 'random').mockReturnValue(random);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const service = new RequestAutomationSearchDelay();

    const waiting = service.wait();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), expectedMs);
    await vi.runAllTimersAsync();
    await waiting;
  });
});
