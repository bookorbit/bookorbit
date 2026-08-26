import { BadRequestException } from '@nestjs/common';

import { basicAuthHeader, endpointUrl, fetchClient, readClientJson, readClientText } from './client-http.utils';

describe('endpointUrl', () => {
  /**
   * The whole reason this helper exists. `new URL('/api/v2/x', base)` discards the base's path,
   * which silently breaks every deployment where the client sits behind a reverse proxy at a
   * subpath: the request goes to the proxy root and comes back as somebody else's 404.
   */
  it('joins under the base path rather than replacing it', () => {
    const url = endpointUrl(new URL('https://seedbox.example/qb/'), '/api/v2/torrents/info');

    expect(url.href).toBe('https://seedbox.example/qb/api/v2/torrents/info');
  });

  it('does not double the separator when the base carries no trailing slash', () => {
    const url = endpointUrl(new URL('https://seedbox.example/qb'), '/api/v2/app/version');

    expect(url.pathname).toBe('/qb/api/v2/app/version');
  });

  it('leaves a root-hosted client alone', () => {
    const url = endpointUrl(new URL('http://127.0.0.1:8080'), '/api/v2/auth/login');

    expect(url.href).toBe('http://127.0.0.1:8080/api/v2/auth/login');
  });

  it('carries a query string through as the target search', () => {
    const url = endpointUrl(new URL('https://seedbox.example/qb/'), '/api/v2/torrents/info?hashes=abc&filter=all');

    expect(url.pathname).toBe('/qb/api/v2/torrents/info');
    expect(url.search).toBe('?hashes=abc&filter=all');
  });

  /** A base's own query and fragment describe the base, not this call, and must not ride along. */
  it('drops any query or fragment the base was carrying', () => {
    const url = endpointUrl(new URL('https://seedbox.example/qb/?theme=dark#top'), '/api/v2/app/version');

    expect(url.search).toBe('');
    expect(url.hash).toBe('');
  });

  it('keeps the base intact so one URL object can serve many calls', () => {
    const base = new URL('https://seedbox.example/qb/');

    endpointUrl(base, '/api/v2/torrents/info');
    endpointUrl(base, '/api/v2/app/version');

    expect(base.href).toBe('https://seedbox.example/qb/');
  });
});

describe('basicAuthHeader', () => {
  it('encodes a username and password pair', () => {
    expect(basicAuthHeader('admin', 'hunter2')).toEqual({ Authorization: `Basic ${Buffer.from('admin:hunter2').toString('base64')}` });
  });

  /**
   * A client with authentication switched off answers an empty `Basic :` header with a 401, so the
   * header has to be absent rather than empty.
   */
  it('sends no header at all when neither half is set', () => {
    expect(basicAuthHeader(null, null)).toEqual({});
    expect(basicAuthHeader('', '')).toEqual({});
  });

  it('still sends one when only half the pair is set, which some clients accept', () => {
    expect(basicAuthHeader('admin', null)).toEqual({ Authorization: `Basic ${Buffer.from('admin:').toString('base64')}` });
    expect(basicAuthHeader(null, 'hunter2')).toEqual({ Authorization: `Basic ${Buffer.from(':hunter2').toString('base64')}` });
  });
});

describe('fetchClient', () => {
  const url = new URL('http://127.0.0.1:8080/api/v2/app/version');

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns the response and never follows a redirect on its own', async () => {
    const response = new Response('v4.6.0', { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchClient(url, { method: 'GET' }, 'qBittorrent')).resolves.toBe(response);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'manual' });
  });

  /** The daemon's own name, because an instance with three clients configured needs to say which. */
  it('names the client when it cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(fetchClient(url, {}, 'Transmission')).rejects.toMatchObject({
      constructor: BadRequestException,
      message: expect.stringContaining('Transmission'),
    });
  });

  /**
   * `fetch` reports a timeout and a refusal as the same opaque `TypeError`, so the abort has to be
   * told apart from every other failure here or the operator is handed "fetch failed" either way.
   */
  it('reports a timeout as a timeout rather than as an unreachable client', async () => {
    const aborted = new Error('The operation was aborted');
    aborted.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(aborted));

    await expect(fetchClient(url, {}, 'Deluge')).rejects.toMatchObject({ message: 'Deluge did not answer in time' });
  });

  it('aborts the request once the timeout elapses', async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_input: unknown, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            seen = init.signal as AbortSignal;
            seen.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }),
      ),
    );

    // The assertion is attached before the clock moves, so the rejection is never momentarily
    // unhandled; otherwise this passes while the run reports an unhandled rejection alongside it.
    const settled = expect(fetchClient(url, {}, 'qBittorrent')).rejects.toMatchObject({ message: 'qBittorrent did not answer in time' });
    await vi.advanceTimersByTimeAsync(20_000);
    await settled;

    expect(seen?.aborted).toBe(true);
  });

  /** The timer is cleared on the way out, so a fast answer does not hold the process open. */
  it('clears its timeout after a successful call', async () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));

    await fetchClient(url, {}, 'qBittorrent');

    expect(clear).toHaveBeenCalled();
  });
});

describe('readClientText and readClientJson', () => {
  it('reads an ordinary answer', async () => {
    await expect(readClientText(new Response('Ok.'), 'qBittorrent')).resolves.toBe('Ok.');
    await expect(readClientJson<{ a: number }>(new Response('{"a":1}'), 'Transmission')).resolves.toEqual({ a: 1 });
  });

  /** A daemon behind a captive portal answers every call with a page; nothing obliges it to be small. */
  it('refuses a body larger than the ceiling, naming the client', async () => {
    const huge = new Response('x', { headers: { 'content-length': String(64 * 1024 * 1024) } });
    await expect(readClientText(huge, 'Deluge')).rejects.toThrow(/Deluge answered with more data/);
  });

  it('reports a non-JSON answer as the client failing rather than a parse crash', async () => {
    await expect(readClientJson(new Response('<html>login</html>'), 'qBittorrent')).rejects.toBeInstanceOf(BadRequestException);
  });
});
