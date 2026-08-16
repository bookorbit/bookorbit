import { BadRequestException } from '@nestjs/common';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AudiobookshelfApiConnector, createPinnedLookup, requestAudiobookshelfJson, resolvePinnedAddress } from './audiobookshelf-api.connector';

const config = {
  mode: 'api' as const,
  baseUrl: 'https://abs.example.com',
  apiToken: 'super-secret-token',
  allowPrivateNetwork: false,
};

type RequestJson = (configValue: typeof config, path: string, options?: Record<string, unknown>) => Promise<unknown>;

afterEach(() => vi.restoreAllMocks());

function mockRequest(connector: AudiobookshelfApiConnector) {
  return vi.spyOn(connector as unknown as { requestJson: RequestJson }, 'requestJson');
}

describe('AudiobookshelfApiConnector validation and field selection', () => {
  it('validates status and authorizes with POST for an admin identity', async () => {
    const connector = new AudiobookshelfApiConnector();
    const request = mockRequest(connector)
      .mockResolvedValueOnce({ app: 'audiobookshelf', serverVersion: '2.36.0', isInit: true })
      .mockResolvedValueOnce({ user: { id: 'u1', username: 'admin', type: 'admin', token: 'must-not-survive' } });

    await expect(connector.getStatus(config)).resolves.toEqual({ sourceVersion: '2.36.0' });
    await expect(connector.authorize(config)).resolves.toEqual({ id: 'u1', username: 'admin', type: 'admin' });
    expect(request).toHaveBeenNthCalledWith(1, config, '/status');
    expect(request).toHaveBeenNthCalledWith(2, config, '/api/authorize', { method: 'POST', retryable: true });
  });

  it('rejects the wrong application, an uninitialized server, and a non-admin identity', async () => {
    const connector = new AudiobookshelfApiConnector();
    const request = mockRequest(connector);

    request.mockResolvedValueOnce({ app: 'something-else', serverVersion: '1', isInit: true });
    await expect(connector.getStatus(config)).rejects.toBeInstanceOf(BadRequestException);

    request.mockResolvedValueOnce({ app: 'audiobookshelf', serverVersion: '2.36.0', isInit: false });
    await expect(connector.getStatus(config)).rejects.toBeInstanceOf(BadRequestException);

    request.mockResolvedValueOnce({ user: { id: 'u1', username: 'reader', type: 'user' } });
    await expect(connector.authorize(config)).rejects.toThrow('admin or root');
  });

  it('whitelists user details and discards credentials and permissions immediately', async () => {
    const connector = new AudiobookshelfApiConnector();
    mockRequest(connector).mockResolvedValue({
      id: 'u1',
      username: 'reader',
      email: 'reader@example.com',
      isActive: true,
      token: 'leaked-token',
      accessToken: 'leaked-access-token',
      permissions: { download: true },
      pash: 'password-hash',
      mediaProgress: [
        {
          id: 'p1',
          userId: 'u1',
          mediaItemId: 'b1',
          mediaItemType: 'book',
          currentTime: 12,
          secret: 'discard-me',
        },
      ],
      bookmarks: [{ libraryItemId: 'li1', time: 4, title: 'Mark', privateData: 'discard-me' }],
    });

    const result = await connector.getUserDetails(config, 'u1');
    expect(result.user).toEqual({ id: 'u1', username: 'reader', email: 'reader@example.com', isActive: true });
    expect(result.mediaProgress).toEqual([
      expect.objectContaining({ id: 'p1', userId: 'u1', mediaItemId: 'b1', mediaItemType: 'book', currentTime: 12 }),
    ]);
    expect(result.bookmarks).toEqual([expect.objectContaining({ userId: 'u1', libraryItemId: 'li1', time: 4, title: 'Mark' })]);
    expect(JSON.stringify(result)).not.toMatch(/leaked|password-hash|permissions|privateData|secret/);
  });

  it('maps only migration fields from expanded book items', async () => {
    const connector = new AudiobookshelfApiConnector();
    mockRequest(connector).mockResolvedValue({
      libraryItems: [
        {
          id: 'li1',
          mediaType: 'book',
          path: '/books/title',
          relPath: 'title',
          internal: 'discard-me',
          media: {
            id: 'b1',
            duration: 120,
            tags: ['favorite'],
            metadata: {
              title: 'Title',
              authors: [{ id: 'a1', name: 'Author', imagePath: '/secret' }],
              narrators: ['Narrator'],
              genres: ['Fantasy'],
              series: [{ id: 's1', name: 'Series', sequence: '2' }],
              asin: 'B000000001',
            },
            audioFiles: [
              {
                ino: '77',
                index: 1,
                format: 'MP3',
                duration: 120,
                metadata: { path: '/books/title/track.mp3', relPath: 'track.mp3', filename: 'track.mp3', ext: '.mp3' },
              },
            ],
          },
        },
      ],
    });

    const result = await connector.getExpandedItems(config, ['li1']);
    expect(result).toEqual([
      expect.objectContaining({
        id: 'li1',
        mediaType: 'book',
        book: expect.objectContaining({
          id: 'b1',
          title: 'Title',
          authors: [{ id: 'a1', name: 'Author' }],
          audioFiles: [expect.objectContaining({ ino: '77', format: 'MP3' })],
        }),
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('discard-me');
    expect(JSON.stringify(result)).not.toContain('imagePath');
  });
});

describe('AudiobookshelfApiConnector pagination and batching', () => {
  it('builds snapshot counts without expanding every library item or session page', async () => {
    const connector = new AudiobookshelfApiConnector();
    vi.spyOn(connector, 'getStatus').mockResolvedValue({ sourceVersion: '2.36.0' });
    vi.spyOn(connector, 'authorize').mockResolvedValue({ id: 'root', username: 'root', type: 'root' });
    vi.spyOn(connector, 'getUsers').mockResolvedValue([
      { id: 'u1', username: 'one' },
      { id: 'u2', username: 'two' },
    ]);
    vi.spyOn(connector, 'getLibraries').mockResolvedValue([
      { id: 'books', mediaType: 'book', folders: [] },
      { id: 'podcasts', mediaType: 'podcast', folders: [] },
    ]);
    vi.spyOn(connector, 'getLibraryItemsPage').mockResolvedValue({ results: [{ id: 'first', mediaType: 'book' }], total: 25_000, page: 0 });
    vi.spyOn(connector, 'getUserDetails')
      .mockResolvedValueOnce({
        user: { id: 'u1', username: 'one' },
        mediaProgress: [
          { userId: 'u1', mediaItemId: 'b1', mediaItemType: 'book' },
          { userId: 'u1', mediaItemId: 'b2', mediaItemType: 'book' },
        ],
        bookmarks: [{ userId: 'u1', libraryItemId: 'li1', time: 5 }],
      })
      .mockResolvedValueOnce({ user: { id: 'u2', username: 'two' }, mediaProgress: [], bookmarks: [] });
    const sessionPages = vi
      .spyOn(connector, 'getUserListeningSessionsPage')
      .mockResolvedValueOnce({ sessions: [], total: 300, numPages: 3, page: 0 })
      .mockResolvedValueOnce({ sessions: [], total: 20, numPages: 1, page: 0 });
    const expanded = vi.spyOn(connector, 'getExpandedItems');

    await expect(connector.fetchSnapshotSummary(config)).resolves.toEqual({
      sourceVersion: '2.36.0',
      counts: {
        users: 2,
        libraryItems: 25_000,
        mediaProgress: 2,
        bookmarks: 1,
        readingSessions: 320,
      },
    });
    expect(sessionPages.mock.calls.map((call) => call[2])).toEqual([0, 0]);
    expect(expanded).not.toHaveBeenCalled();
  });

  it('walks zero-based pages across libraries and keeps batches at 100 IDs', async () => {
    const connector = new AudiobookshelfApiConnector();
    vi.spyOn(connector, 'getStatus').mockResolvedValue({ sourceVersion: '2.36.0' });
    vi.spyOn(connector, 'authorize').mockResolvedValue({ id: 'root', username: 'root', type: 'root' });
    vi.spyOn(connector, 'getUsers').mockResolvedValue([]);
    vi.spyOn(connector, 'getLibraries').mockResolvedValue([
      { id: 'lib1', mediaType: 'book', folders: [] },
      { id: 'lib2', mediaType: 'book', folders: [] },
      { id: 'podcasts', mediaType: 'podcast', folders: [] },
    ]);
    const pageSpy = vi.spyOn(connector, 'getLibraryItemsPage').mockImplementation((_config, libraryId, page) => {
      if (libraryId === 'lib1' && page === 0) {
        return Promise.resolve({
          results: Array.from({ length: 200 }, (_, index) => ({ id: `li-${index}`, mediaType: 'book' })),
          total: 201,
          page,
        });
      }
      if (libraryId === 'lib1' && page === 1) {
        return Promise.resolve({ results: [{ id: 'li-200', mediaType: 'book' }], total: 201, page });
      }
      return Promise.resolve({ results: [{ id: 'li-other', mediaType: 'book' }], total: 1, page });
    });
    const batchSpy = vi
      .spyOn(connector, 'getExpandedItems')
      .mockImplementation((_config, ids) => Promise.resolve(ids.map((id) => ({ id, mediaType: 'podcast' as const }))));

    const result = await connector.fetchSourceRecords(config);

    expect(pageSpy.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ['lib1', 0],
      ['lib1', 1],
      ['lib2', 0],
    ]);
    expect(batchSpy.mock.calls.map((call) => call[1].length)).toEqual([100, 100, 1, 1]);
    expect(result.libraryItems).toHaveLength(202);
  });

  it('collects users with no progress and paginates listening sessions', async () => {
    const connector = new AudiobookshelfApiConnector();
    vi.spyOn(connector, 'getStatus').mockResolvedValue({ sourceVersion: '2.36.0' });
    vi.spyOn(connector, 'authorize').mockResolvedValue({ id: 'root', username: 'root', type: 'root' });
    vi.spyOn(connector, 'getUsers').mockResolvedValue([{ id: 'u1', username: 'reader', email: null, isActive: true }]);
    vi.spyOn(connector, 'getLibraries').mockResolvedValue([]);
    vi.spyOn(connector, 'getUserDetails').mockResolvedValue({
      user: { id: 'u1', username: 'reader', email: null, isActive: true },
      mediaProgress: [],
      bookmarks: [],
    });
    const sessions = vi
      .spyOn(connector, 'getUserListeningSessionsPage')
      .mockResolvedValueOnce({
        sessions: [
          {
            id: 's1',
            userId: 'u1',
            mediaItemId: 'b1',
            mediaItemType: 'book',
            duration: 60,
            startTime: 0,
            currentTime: 10,
            timeListening: 10,
          },
        ],
        total: 2,
        numPages: 2,
        page: 0,
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            id: 's2',
            userId: 'u1',
            mediaItemId: 'b1',
            mediaItemType: 'book',
            duration: 60,
            startTime: 10,
            currentTime: 20,
            timeListening: 10,
          },
        ],
        total: 2,
        numPages: 2,
        page: 1,
      });

    const result = await connector.fetchSourceRecords(config);
    expect(result.users).toEqual([{ id: 'u1', username: 'reader', email: null, isActive: true }]);
    expect(result.mediaProgress).toEqual([]);
    expect(result.playbackSessions.map((session) => session.id)).toEqual(['s1', 's2']);
    expect(sessions.mock.calls.map((call) => call[2])).toEqual([0, 1]);
  });

  it('stops paginating a server that ignores the page parameter', async () => {
    const connector = new AudiobookshelfApiConnector();
    vi.spyOn(connector, 'getStatus').mockResolvedValue({ sourceVersion: '2.36.0' });
    vi.spyOn(connector, 'authorize').mockResolvedValue({ id: 'root', username: 'root', type: 'root' });
    vi.spyOn(connector, 'getUsers').mockResolvedValue([{ id: 'u1', username: 'reader' }]);
    vi.spyOn(connector, 'getLibraries').mockResolvedValue([{ id: 'lib1', mediaType: 'book', folders: [] }]);
    vi.spyOn(connector, 'getUserDetails').mockResolvedValue({ user: { id: 'u1', username: 'reader' }, mediaProgress: [], bookmarks: [] });
    vi.spyOn(connector, 'getExpandedItems').mockImplementation((_config, ids) =>
      Promise.resolve(ids.map((id) => ({ id, mediaType: 'podcast' as const }))),
    );

    // Every page repeats the same rows and understates them against a large total, so no
    // count-based condition can terminate the walk.
    const itemPages = vi.spyOn(connector, 'getLibraryItemsPage').mockImplementation((_config, _libraryId, page) =>
      Promise.resolve({
        results: Array.from({ length: 200 }, (_, index) => ({ id: `li-${index}`, mediaType: 'book' })),
        total: 100_000,
        page,
      }),
    );
    const sessionPages = vi.spyOn(connector, 'getUserListeningSessionsPage').mockImplementation((_config, _userId, page) =>
      Promise.resolve({
        sessions: [
          { id: 's1', userId: 'u1', mediaItemId: 'b1', mediaItemType: 'book', duration: 60, startTime: 0, currentTime: 10, timeListening: 10 },
        ],
        total: 100_000,
        numPages: 0,
        page,
      }),
    );

    const result = await connector.fetchSourceRecords(config);

    expect(itemPages.mock.calls).toHaveLength(2);
    expect(result.libraryItems).toHaveLength(200);
    expect(sessionPages.mock.calls).toHaveLength(2);
    expect(result.playbackSessions.map((session) => session.id)).toEqual(['s1']);
  });
});

describe('Audiobookshelf HTTP safety', () => {
  it('rejects private targets unless access is explicitly enabled', async () => {
    await expect(requestAudiobookshelfJson({ ...config, baseUrl: 'http://127.0.0.1:9' }, '/status')).rejects.toThrow('private or local');
  });

  it('uses an explicitly allowed private target', async () => {
    await withServer(
      (_request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end('{"ok":true}');
      },
      async (baseUrl) => {
        await expect(requestAudiobookshelfJson({ ...config, baseUrl, allowPrivateNetwork: true }, '/status')).resolves.toEqual({ ok: true });
      },
    );
  });

  it('rejects redirects, streamed oversized responses, and timeouts', async () => {
    await withServer(
      (_request, response) => {
        response.statusCode = 302;
        response.setHeader('location', 'http://127.0.0.1/private');
        response.end();
      },
      async (baseUrl) => {
        await expect(requestAudiobookshelfJson({ ...config, baseUrl, allowPrivateNetwork: true }, '/redirect')).rejects.toThrow(
          'redirects are not allowed',
        );
      },
    );

    await withServer(
      (_request, response) => {
        response.write('{"payload":"');
        response.write('x'.repeat(100));
        response.end('"}');
      },
      async (baseUrl) => {
        await expect(
          requestAudiobookshelfJson({ ...config, baseUrl, allowPrivateNetwork: true }, '/large', { maxResponseBytes: 32 }),
        ).rejects.toThrow('exceeded the allowed size');
      },
    );

    await withServer(
      () => undefined,
      async (baseUrl) => {
        await expect(requestAudiobookshelfJson({ ...config, baseUrl, allowPrivateNetwork: true }, '/slow', { timeoutMs: 20 })).rejects.toThrow(
          'timed out',
        );
      },
    );
  });

  it('does not expose credentials or upstream response bodies in errors', async () => {
    await withServer(
      (_request, response) => {
        response.statusCode = 500;
        response.end(`failure included ${config.apiToken}`);
      },
      async (baseUrl) => {
        const error = await requestAudiobookshelfJson({ ...config, baseUrl, allowPrivateNetwork: true }, '/failure').catch(
          (reason: unknown) => reason,
        );
        expect(error).toBeInstanceOf(BadRequestException);
        expect(String(error)).not.toContain(config.apiToken);
        expect(String(error)).not.toContain('failure included');
      },
    );
  });

  it('pins the validated DNS answer so the connection lookup cannot re-resolve the hostname', async () => {
    const resolver = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const pinned = await resolvePinnedAddress('abs.example.com', false, resolver as never);
    expect(resolver).toHaveBeenCalledTimes(1);

    const lookup = createPinnedLookup(pinned);
    const callback = vi.fn();
    lookup('abs.example.com', {}, callback);
    lookup('abs.example.com', {}, callback);

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenNthCalledWith(1, null, '93.184.216.34', 4);
    expect(callback).toHaveBeenNthCalledWith(2, null, '93.184.216.34', 4);
  });

  it('returns an address array when Node requests all pinned DNS answers', () => {
    const lookup = createPinnedLookup({ address: '172.22.0.3', family: 4 });
    const callback = vi.fn();

    lookup('audiobookshelf', { family: undefined, hints: 32, all: true }, callback);

    expect(callback).toHaveBeenCalledWith(null, [{ address: '172.22.0.3', family: 4 }]);
  });
});

async function withServer(handler: Parameters<typeof createServer>[0], run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}
