import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { HardcoverClientService } from './hardcover-client.service';
import { HardcoverQueueService } from './hardcover-queue.service';

vi.mock('./hardcover-queue.service');

const mockQueueService = {
  throttle: vi.fn().mockResolvedValue(undefined),
  resetUser: vi.fn(),
};

function makeFetchResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('HardcoverClientService', () => {
  let service: HardcoverClientService;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    service = new HardcoverClientService(mockQueueService as unknown as HardcoverQueueService);
    fetchSpy = vi.spyOn(global, 'fetch');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should return data on success', async () => {
    fetchSpy.mockResolvedValueOnce(makeFetchResponse(200, { data: { me: [{ id: 1 }] } }));
    const result = await service.query<{ me: { id: number }[] }>(1, 'token', '{ me { id } }');
    expect(result).toEqual({ me: [{ id: 1 }] });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('BookOrbit'),
        }),
      }),
    );
  });

  it('should throw on GraphQL errors', async () => {
    fetchSpy.mockResolvedValueOnce(makeFetchResponse(200, { errors: [{ message: 'Unauthorized' }] }));
    await expect(service.query(1, 'token', '{ me { id } }')).rejects.toThrow('Hardcover GraphQL error: Unauthorized');
  });

  it('should throw on non-OK HTTP status', async () => {
    fetchSpy.mockResolvedValueOnce(makeFetchResponse(500, {}));
    await expect(service.query(1, 'token', '{ me { id } }')).rejects.toThrow('Hardcover API error: 500');
  });

  it('should retry on 429 with backoff', async () => {
    fetchSpy.mockResolvedValueOnce(makeFetchResponse(429, {})).mockResolvedValueOnce(makeFetchResponse(200, { data: { me: [] } }));

    const p = service.query(1, 'token', '{ me { id } }');
    const expectation = expect(p).resolves.toEqual({ me: [] });
    await vi.runAllTimersAsync();
    await expectation;
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('should give up after max retries on 429', async () => {
    fetchSpy.mockResolvedValue(makeFetchResponse(429, {}));
    const p = service.query(1, 'token', '{ me { id } }');
    const expectation = expect(p).rejects.toThrow('Hardcover rate limit exceeded');
    await vi.runAllTimersAsync();
    await expectation;
    expect(fetchSpy).toHaveBeenCalledTimes(4); // 1 + 3 retries
  });

  it('should throw on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network failure'));
    await expect(service.query(1, 'token', '{ me { id } }')).rejects.toThrow('Network failure');
  });
});
