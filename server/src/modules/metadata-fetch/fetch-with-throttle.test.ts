import { fetchWithThrottle } from './fetch-with-throttle';
import { ProviderThrottleError } from './provider-throttle.error';

describe('fetchWithThrottle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the response when provider is not throttling', async () => {
    const response = {
      status: 200,
      headers: { get: vi.fn() },
    } as unknown as Response;
    global.fetch = vi.fn().mockResolvedValue(response);

    await expect(fetchWithThrottle('https://provider.example/search')).resolves.toBe(response);
  });

  it('throws ProviderThrottleError with numeric Retry-After seconds', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 429,
      headers: { get: vi.fn().mockReturnValue('120') },
    });

    await expect(fetchWithThrottle('https://provider.example/search')).rejects.toMatchObject({
      name: 'ProviderThrottleError',
      retryAfterSeconds: 120,
    });
  });

  it('parses Retry-After HTTP-date headers into remaining seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'));

    const retryAt = new Date('2026-04-08T12:02:05.000Z').toUTCString();
    global.fetch = vi.fn().mockResolvedValue({
      status: 429,
      headers: { get: vi.fn().mockReturnValue(retryAt) },
    });

    await expect(fetchWithThrottle('https://provider.example/search')).rejects.toMatchObject({
      retryAfterSeconds: 125,
    });
  });

  it('falls back to undefined retryAfterSeconds for invalid, zero, or past headers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'));

    const retryAfterHeaders = ['0', '-5', 'not-a-date', new Date('2026-04-08T11:59:00.000Z').toUTCString()];

    for (const header of retryAfterHeaders) {
      global.fetch = vi.fn().mockResolvedValue({
        status: 429,
        headers: { get: vi.fn().mockReturnValue(header) },
      });

      try {
        await fetchWithThrottle('https://provider.example/search');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderThrottleError);
        expect((error as ProviderThrottleError).retryAfterSeconds).toBeUndefined();
      }
    }
  });
});
