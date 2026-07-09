import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { StorygraphClientService } from './storygraph-client.service';
import { StorygraphQueueService } from './storygraph-queue.service';
import { StorygraphRepository } from './storygraph.repository';

vi.mock('./storygraph-queue.service');
vi.mock('./storygraph.repository');

const mockQueueService = {
  throttle: vi.fn().mockResolvedValue(undefined),
  resetUser: vi.fn(),
};

const mockRepo = {
  updateSessionCookie: vi.fn().mockResolvedValue(undefined),
};

const cookies = { sessionCookie: 'sess', rememberToken: 'remember' };

function makeFetchResponse(input: { status: number; html?: string; url?: string; setCookies?: string[] }): Response {
  return {
    status: input.status,
    url: input.url ?? 'https://app.thestorygraph.com/books/abc',
    text: vi.fn().mockResolvedValue(input.html ?? ''),
    headers: {
      getSetCookie: () => input.setCookies ?? [],
    },
  } as unknown as Response;
}

describe('StorygraphClientService', () => {
  let service: StorygraphClientService;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new StorygraphClientService(mockQueueService as unknown as StorygraphQueueService, mockRepo as unknown as StorygraphRepository);
    fetchSpy = vi.spyOn(global, 'fetch');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('get', () => {
    it('returns html and status on success', async () => {
      fetchSpy.mockResolvedValueOnce(makeFetchResponse({ status: 200, html: '<html>ok</html>' }));
      const result = await service.get(1, cookies, '/books/abc');
      expect(result).toEqual({ status: 200, html: '<html>ok</html>', redirectedToSignIn: false });
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://app.thestorygraph.com/books/abc',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Cookie: expect.stringContaining('remember_user_token=remember') }),
        }),
      );
    });

    it('flags a redirect to the sign-in page as an expired session', async () => {
      fetchSpy.mockResolvedValueOnce(makeFetchResponse({ status: 200, url: 'https://app.thestorygraph.com/users/sign_in' }));
      const result = await service.get(1, cookies, '/books/abc');
      expect(result.redirectedToSignIn).toBe(true);
    });

    it('retries on 5xx and eventually returns the failing response', async () => {
      fetchSpy.mockResolvedValue(makeFetchResponse({ status: 500 }));
      const p = service.get(1, cookies, '/books/abc');
      const expectation = expect(p).resolves.toEqual(expect.objectContaining({ status: 500 }));
      await vi.runAllTimersAsync();
      await expectation;
      expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 + 2 retries
    });

    it('throws on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network failure'));
      await expect(service.get(1, cookies, '/books/abc')).rejects.toThrow('Network failure');
    });

    it('persists a rotated session cookie from Set-Cookie', async () => {
      fetchSpy.mockResolvedValueOnce(makeFetchResponse({ status: 200, setCookies: ['_storygraph_session=newvalue; Path=/; HttpOnly'] }));
      await service.get(1, cookies, '/books/abc');
      expect(mockRepo.updateSessionCookie).toHaveBeenCalledWith(1, 'newvalue');
    });

    it('does not persist a session cookie when none is present', async () => {
      fetchSpy.mockResolvedValueOnce(makeFetchResponse({ status: 200 }));
      await service.get(1, cookies, '/books/abc');
      expect(mockRepo.updateSessionCookie).not.toHaveBeenCalled();
    });
  });

  describe('post', () => {
    it('sends form-encoded body with the CSRF token', async () => {
      fetchSpy.mockResolvedValueOnce(makeFetchResponse({ status: 302 }));
      await service.post(1, cookies, '/update-status.js?book_id=abc&status=read', { foo: 'bar' }, 'csrf-token');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://app.thestorygraph.com/update-status.js?book_id=abc&status=read',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-token', 'Content-Type': 'application/x-www-form-urlencoded' }),
          body: expect.stringContaining('authenticity_token=csrf-token'),
        }),
      );
    });
  });

  describe('extractCsrfToken', () => {
    it('extracts the token from a meta tag', () => {
      const html = '<html><head><meta name="csrf-token" content="abc123"></head></html>';
      expect(service.extractCsrfToken(html)).toBe('abc123');
    });

    it('falls back to a hidden authenticity_token input', () => {
      const html = '<html><body><input type="hidden" name="authenticity_token" value="xyz789"></body></html>';
      expect(service.extractCsrfToken(html)).toBe('xyz789');
    });

    it('returns null when no token is present', () => {
      expect(service.extractCsrfToken('<html></html>')).toBeNull();
    });
  });
});
