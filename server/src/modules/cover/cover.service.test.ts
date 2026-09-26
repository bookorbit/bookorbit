import { type LookupAddress, lookup } from 'dns/promises';
import { BadRequestException } from '@nestjs/common';
import type { CoverSearchResult } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { COVER_PROXY_MAX_IMAGE_BYTES, COVER_PROXY_USER_AGENT } from './constants';
import { CoverService } from './cover.service';
import type { CoverProviderRegistry } from './provider-registry';
import { DUCKDUCKGO_PROVIDER_KEY, ITUNES_PROVIDER_KEY } from './providers/cover-provider';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

function makeResult(url: string, previewUrl: string): CoverSearchResult {
  return {
    url,
    sourceUrl: url,
    previewUrl,
    width: 600,
    height: 600,
    source: 'Test',
  };
}

function makeImageResponse(bytes: Uint8Array, contentType = 'image/jpeg', status = 200): Response {
  return new Response(bytes, {
    status,
    headers: {
      'content-type': contentType,
    },
  });
}

function makeStreamResponse(chunks: Uint8Array[], contentType = 'image/jpeg', status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: {
      'content-type': contentType,
    },
  });
}

function makeRedirectResponse(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: {
      location,
    },
  });
}

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 1,
    username: 'tester',
    name: 'Tester',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function createService(providerRegistry: CoverProviderRegistry, options?: { assertFieldsUnlocked?: ReturnType<typeof vi.fn> }): CoverService {
  return createMutationService({ ...options, providerRegistry }).service;
}

function createMutationService(options?: { assertFieldsUnlocked?: ReturnType<typeof vi.fn>; providerRegistry?: CoverProviderRegistry }) {
  const scoreService = {
    calculateAndSave: vi.fn().mockResolvedValue(undefined),
  };
  const fileWriteService = { scheduleWrite: vi.fn() };
  const assertFieldsUnlocked = options?.assertFieldsUnlocked ?? vi.fn().mockResolvedValue(undefined);
  const coverStore = {
    chooseWriteMedium: vi.fn().mockResolvedValue('ebook'),
    faceMediumFor: vi.fn().mockResolvedValue('ebook'),
    saveCustom: vi.fn().mockResolvedValue(true),
    revert: vi.fn().mockResolvedValue('extracted'),
  };

  const service = new CoverService(
    { findLibraryIdByBookId: vi.fn().mockResolvedValue(7) } as never,
    { assertFieldsUnlocked } as never,
    fileWriteService as never,
    { verifyUserAccess: vi.fn().mockResolvedValue(undefined) } as never,
    options?.providerRegistry ?? ({ select: vi.fn().mockReturnValue([]) } as unknown as CoverProviderRegistry),
    scoreService as never,
    coverStore as never,
  );

  return { service, scoreService, fileWriteService, assertFieldsUnlocked, coverStore };
}

describe('CoverService', () => {
  const originalFetch = global.fetch;
  const lookupMock = vi.mocked(lookup);
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 } as LookupAddress]);
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('searchCovers', () => {
    it('selects providers, deduplicates by source/url, and proxies preview URLs', async () => {
      const providerA = {
        key: DUCKDUCKGO_PROVIDER_KEY,
        search: vi
          .fn()
          .mockResolvedValue([
            makeResult('https://img.example/a.jpg', 'https://thumb.example/a.jpg'),
            makeResult('https://img.example/b.jpg', 'https://thumb.example/b.jpg'),
          ]),
      };
      const providerB = {
        key: ITUNES_PROVIDER_KEY,
        search: vi
          .fn()
          .mockResolvedValue([
            makeResult('https://img.example/b.jpg', 'https://thumb.example/b.jpg'),
            makeResult('https://img.example/c.jpg', 'https://thumb.example/c.jpg'),
          ]),
      };
      const providerRegistry = {
        select: vi.fn().mockReturnValue([providerA, providerB]),
      } as unknown as CoverProviderRegistry;
      const service = createService(providerRegistry);

      const results = await service.searchCovers({ title: 'Dune', author: 'Frank Herbert', provider: 'all' });

      expect((providerRegistry.select as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toBe('all');
      expect(providerA.search).toHaveBeenCalledWith({ title: 'Dune', author: 'Frank Herbert' });
      expect(providerB.search).toHaveBeenCalledWith({ title: 'Dune', author: 'Frank Herbert' });
      expect(results).toHaveLength(3);
      expect(results.map((result) => result.sourceUrl)).toEqual([
        'https://img.example/a.jpg',
        'https://img.example/b.jpg',
        'https://img.example/c.jpg',
      ]);
      expect(results[0].previewUrl).toBe('/api/v1/books/cover/proxy?url=https%3A%2F%2Fthumb.example%2Fa.jpg');
    });

    it('interleaves first five iTunes covers with duckduckgo when provider is all', async () => {
      const providerA = {
        key: DUCKDUCKGO_PROVIDER_KEY,
        search: vi
          .fn()
          .mockResolvedValue([
            makeResult('https://img.example/ddg-1.jpg', 'https://thumb.example/ddg-1.jpg'),
            makeResult('https://img.example/ddg-2.jpg', 'https://thumb.example/ddg-2.jpg'),
            makeResult('https://img.example/ddg-3.jpg', 'https://thumb.example/ddg-3.jpg'),
            makeResult('https://img.example/ddg-4.jpg', 'https://thumb.example/ddg-4.jpg'),
          ]),
      };
      const providerB = {
        key: ITUNES_PROVIDER_KEY,
        search: vi
          .fn()
          .mockResolvedValue([
            makeResult('https://img.example/it-1.jpg', 'https://thumb.example/it-1.jpg'),
            makeResult('https://img.example/it-2.jpg', 'https://thumb.example/it-2.jpg'),
            makeResult('https://img.example/it-3.jpg', 'https://thumb.example/it-3.jpg'),
            makeResult('https://img.example/it-4.jpg', 'https://thumb.example/it-4.jpg'),
            makeResult('https://img.example/it-5.jpg', 'https://thumb.example/it-5.jpg'),
            makeResult('https://img.example/it-6.jpg', 'https://thumb.example/it-6.jpg'),
          ]),
      };
      const providerRegistry = {
        select: vi.fn().mockReturnValue([providerA, providerB]),
      } as unknown as CoverProviderRegistry;
      const service = createService(providerRegistry);

      const results = await service.searchCovers({ title: 'Dune', provider: 'all' });

      expect(results.map((result) => result.sourceUrl)).toEqual([
        'https://img.example/ddg-1.jpg',
        'https://img.example/it-1.jpg',
        'https://img.example/ddg-2.jpg',
        'https://img.example/it-2.jpg',
        'https://img.example/ddg-3.jpg',
        'https://img.example/it-3.jpg',
        'https://img.example/ddg-4.jpg',
        'https://img.example/it-4.jpg',
        'https://img.example/it-5.jpg',
        'https://img.example/it-6.jpg',
      ]);
    });

    it('marks explicit iTunes provider searches as user-selected even when provider config is disabled', async () => {
      const provider = {
        key: ITUNES_PROVIDER_KEY,
        search: vi.fn().mockResolvedValue([makeResult('https://img.example/it.jpg', 'https://thumb.example/it.jpg')]),
      };
      const providerRegistry = {
        select: vi.fn().mockReturnValue([provider]),
      } as unknown as CoverProviderRegistry;
      const service = createService(providerRegistry);

      const results = await service.searchCovers({ title: 'The Martian', author: 'Andy Weir', isAudiobook: true, provider: 'itunes' });

      expect(provider.search).toHaveBeenCalledWith({
        title: 'The Martian',
        author: 'Andy Weir',
        isAudiobook: true,
        ignoreProviderEnabled: true,
      });
      expect(results).toHaveLength(1);
      expect(results[0].previewUrl).toBe('/api/v1/books/cover/proxy?url=https%3A%2F%2Fthumb.example%2Fit.jpg');
    });
  });

  describe('proxyImage', () => {
    function createProxyService(): CoverService {
      return createService({ select: vi.fn().mockReturnValue([]) } as unknown as CoverProviderRegistry);
    }

    it('returns image bytes and normalized content type', async () => {
      const service = createProxyService();
      fetchMock.mockResolvedValueOnce(makeImageResponse(Buffer.from('bytes'), 'image/jpeg; charset=utf-8'));

      const result = await service.proxyImage('https://covers.example.com/cover.jpg');

      expect(result.contentType).toBe('image/jpeg');
      expect(result.buffer).toEqual(Buffer.from('bytes'));
      expect(fetchMock).toHaveBeenCalledWith(
        'https://covers.example.com/cover.jpg',
        expect.objectContaining({
          redirect: 'manual',
          headers: expect.objectContaining({
            Accept: 'image/*',
            'User-Agent': COVER_PROXY_USER_AGENT,
          }),
        }),
      );
    });

    it('rejects invalid URLs before requesting remote data', async () => {
      const service = createProxyService();

      await expect(service.proxyImage('not a url')).rejects.toThrow('Invalid URL');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects unsupported URL protocols', async () => {
      const service = createProxyService();
      await expect(service.proxyImage('ftp://covers.example.com/cover.jpg')).rejects.toThrow('URL must use http or https');
    });

    it('rejects localhost and private hosts', async () => {
      const service = createProxyService();
      await expect(service.proxyImage('http://127.0.0.1/cover.jpg')).rejects.toThrow('URL resolves to a private or local address');
      await expect(service.proxyImage('https://localhost/cover.jpg')).rejects.toThrow('URL resolves to a private or local address');
    });

    it('rejects domains that resolve to private addresses', async () => {
      const service = createProxyService();
      lookupMock.mockResolvedValueOnce([{ address: '10.0.0.7', family: 4 } as LookupAddress]);

      await expect(service.proxyImage('https://internal.example.com/cover.jpg')).rejects.toThrow('URL resolves to a private or local address');
    });

    it('rejects non-image responses', async () => {
      const service = createProxyService();
      fetchMock.mockResolvedValueOnce(makeImageResponse(Buffer.from('<html/>'), 'text/html'));

      await expect(service.proxyImage('https://covers.example.com/cover.jpg')).rejects.toThrow('URL does not point to an image');
    });

    it('rejects oversized responses', async () => {
      const service = createProxyService();
      fetchMock.mockResolvedValueOnce(makeStreamResponse([new Uint8Array(COVER_PROXY_MAX_IMAGE_BYTES), new Uint8Array([1])], 'image/png'));

      await expect(service.proxyImage('https://covers.example.com/cover.jpg')).rejects.toThrow('Image exceeds 20 MB limit');
    });

    it('follows redirects to a safe image host', async () => {
      const service = createProxyService();

      fetchMock
        .mockResolvedValueOnce(makeRedirectResponse('/images/cover.jpg'))
        .mockResolvedValueOnce(makeImageResponse(Buffer.from('png-bytes'), 'image/png'));

      const result = await service.proxyImage('https://covers.example.com/start');

      expect(result.contentType).toBe('image/png');
      expect(result.buffer).toEqual(Buffer.from('png-bytes'));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://covers.example.com/images/cover.jpg', expect.objectContaining({ redirect: 'manual' }));
    });

    it('rejects redirects without a location header', async () => {
      const service = createProxyService();
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));

      await expect(service.proxyImage('https://covers.example.com/start')).rejects.toThrow('Image redirect is missing location');
    });

    it('rejects redirect chains longer than the configured limit', async () => {
      const service = createProxyService();

      for (let i = 0; i < 6; i += 1) {
        fetchMock.mockResolvedValueOnce(makeRedirectResponse(`https://covers.example.com/r/${i}`));
      }

      await expect(service.proxyImage('https://covers.example.com/start')).rejects.toThrow('Too many image redirects');
      expect(fetchMock).toHaveBeenCalledTimes(6);
    });

    it('maps AbortError failures to timeout errors', async () => {
      const service = createProxyService();
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      fetchMock.mockRejectedValueOnce(abortError);

      await expect(service.proxyImage('https://covers.example.com/cover.jpg')).rejects.toThrow('Image request timed out');
    });

    it('rejects unresolved hostnames', async () => {
      const service = createProxyService();
      lookupMock.mockRejectedValueOnce(new Error('dns failure'));

      await expect(service.proxyImage('https://missing.example.com/cover.jpg')).rejects.toThrow('Unable to resolve URL host');
    });

    describe('SSRF protection', () => {
      it.each([
        ['10.0.0.1', '10.x range'],
        ['172.16.0.1', '172.16-31.x range'],
        ['172.31.255.255', '172.31 upper bound'],
        ['192.168.1.1', '192.168.x range'],
        ['0.0.0.0', '0.x range'],
        ['169.254.169.254', 'link-local'],
        ['100.64.0.1', 'CGN lower bound'],
        ['100.127.255.255', 'CGN upper bound'],
      ])('rejects IPv4 literal %s (%s)', async (ip) => {
        const service = createProxyService();
        await expect(service.proxyImage(`http://${ip}/cover.jpg`)).rejects.toThrow('URL resolves to a private or local address');
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('rejects multicast IPv4 address', async () => {
        const service = createProxyService();
        await expect(service.proxyImage('http://224.0.0.1/cover.jpg')).rejects.toThrow('URL resolves to a private or local address');
      });

      it.each([
        ['::1', 'loopback'],
        ['fc00::1', 'unique local fc'],
        ['fd12::1', 'unique local fd'],
        ['fe80::1', 'link-local'],
      ])('rejects IPv6 literal %s (%s)', async (ip) => {
        const service = createProxyService();
        await expect(service.proxyImage(`http://[${ip}]/cover.jpg`)).rejects.toThrow('URL resolves to a private or local address');
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('rejects IPv4-mapped IPv6 address that resolves to private', async () => {
        const service = createProxyService();
        lookupMock.mockResolvedValueOnce([{ address: '::ffff:10.0.0.1', family: 6 } as LookupAddress]);

        await expect(service.proxyImage('https://sneaky.example.com/cover.jpg')).rejects.toThrow('URL resolves to a private or local address');
      });

      it('rejects .localhost domains', async () => {
        const service = createProxyService();
        await expect(service.proxyImage('http://evil.localhost/cover.jpg')).rejects.toThrow('URL resolves to a private or local address');
      });

      it('rejects .local domains', async () => {
        const service = createProxyService();
        await expect(service.proxyImage('http://printer.local/cover.jpg')).rejects.toThrow('URL resolves to a private or local address');
      });

      it('rejects when DNS resolves to mixed private+public', async () => {
        const service = createProxyService();
        lookupMock.mockResolvedValueOnce([
          { address: '93.184.216.34', family: 4 },
          { address: '10.0.0.1', family: 4 },
        ] as LookupAddress[]);

        await expect(service.proxyImage('https://mixed.example.com/cover.jpg')).rejects.toThrow('URL resolves to a private or local address');
      });

      it('rejects redirect to private host', async () => {
        const service = createProxyService();
        fetchMock.mockResolvedValueOnce(makeRedirectResponse('http://10.0.0.1/internal'));

        await expect(service.proxyImage('https://covers.example.com/start')).rejects.toThrow('URL resolves to a private or local address');
      });
    });
  });

  describe('manual cover mutations', () => {
    it('blocks upload when the chosen slot is locked', async () => {
      const assertFieldsUnlocked = vi.fn().mockRejectedValue(new Error('locked'));
      const { service, coverStore } = createMutationService({ assertFieldsUnlocked });

      await expect(service.uploadCover(12, Buffer.from('img'), 'image/png', makeUser())).rejects.toThrow('locked');

      expect(coverStore.chooseWriteMedium).toHaveBeenCalledWith(12);
      expect(assertFieldsUnlocked).toHaveBeenCalledWith(12, ['cover']);
      expect(coverStore.saveCustom).not.toHaveBeenCalled();
    });

    it('checks the audio cover lock for an upload into the audio slot', async () => {
      const assertFieldsUnlocked = vi.fn().mockRejectedValue(new Error('locked'));
      const { service, coverStore } = createMutationService({ assertFieldsUnlocked });

      await expect(service.uploadCover(12, Buffer.from('img'), 'image/png', makeUser(), 'audio')).rejects.toThrow('locked');

      expect(coverStore.chooseWriteMedium).not.toHaveBeenCalled();
      expect(assertFieldsUnlocked).toHaveBeenCalledWith(12, ['audioCover']);
    });

    it('checks a requested slot lock before fetching a URL upload', async () => {
      const assertFieldsUnlocked = vi.fn().mockRejectedValue(new Error('locked'));
      const { service, coverStore } = createMutationService({ assertFieldsUnlocked });

      await expect(service.uploadCoverFromUrl(12, 'https://example.com/cover.jpg', makeUser(), 'ebook')).rejects.toThrow('locked');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(assertFieldsUnlocked).toHaveBeenCalledWith(12, ['cover']);
      expect(coverStore.saveCustom).not.toHaveBeenCalled();
    });

    it('puts an upload that names no slot in the face slot, whatever its shape, checking that lock before fetching', async () => {
      const assertFieldsUnlocked = vi.fn().mockRejectedValue(new Error('locked'));
      const { service, coverStore } = createMutationService({ assertFieldsUnlocked });
      coverStore.chooseWriteMedium.mockResolvedValue('audio');

      await expect(service.uploadCoverFromUrl(12, 'https://example.com/cover.jpg', makeUser())).rejects.toThrow('locked');

      expect(coverStore.chooseWriteMedium).toHaveBeenCalledWith(12);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(assertFieldsUnlocked).toHaveBeenCalledTimes(1);
      expect(assertFieldsUnlocked).toHaveBeenCalledWith(12, ['audioCover']);
      expect(coverStore.saveCustom).not.toHaveBeenCalled();
    });

    it('saves a URL upload into the chosen slot', async () => {
      const { service, coverStore, scoreService, fileWriteService } = createMutationService();
      fetchMock.mockResolvedValueOnce(makeImageResponse(Buffer.from('remote'), 'image/png'));

      await service.uploadCoverFromUrl(12, 'https://example.com/cover.png', makeUser());

      expect(coverStore.saveCustom).toHaveBeenCalledWith(12, 'ebook', Buffer.from('remote'));
      expect(scoreService.calculateAndSave).toHaveBeenCalledWith(12);
      expect(fileWriteService.scheduleWrite).toHaveBeenCalledWith(12, 'auto', 1);
    });

    it('blocks delete when the face slot is locked', async () => {
      const assertFieldsUnlocked = vi.fn().mockRejectedValue(new Error('locked'));
      const { service, coverStore } = createMutationService({ assertFieldsUnlocked });

      await expect(service.deleteCover(12, makeUser())).rejects.toThrow('locked');

      expect(coverStore.faceMediumFor).toHaveBeenCalledWith(12);
      expect(assertFieldsUnlocked).toHaveBeenCalledWith(12, ['cover']);
      expect(coverStore.revert).not.toHaveBeenCalled();
    });

    it('rejects non-image mimetype on upload', async () => {
      const { service, coverStore } = createMutationService();

      await expect(service.uploadCover(12, Buffer.from('img'), 'text/plain', makeUser())).rejects.toThrow('File must be an image');
      expect(coverStore.saveCustom).not.toHaveBeenCalled();
    });

    it('saves the custom cover into the chosen slot when unlocked', async () => {
      const { service, coverStore, scoreService, fileWriteService } = createMutationService();
      const source = Buffer.from('image-data');

      await service.uploadCover(12, source, 'image/jpeg', makeUser());

      expect(coverStore.saveCustom).toHaveBeenCalledWith(12, 'ebook', source);
      expect(scoreService.calculateAndSave).toHaveBeenCalledWith(12);
      expect(fileWriteService.scheduleWrite).toHaveBeenCalledWith(12, 'auto', 1);
    });

    it('propagates an invalid image from the store without scoring or scheduling a write', async () => {
      const { service, coverStore, scoreService, fileWriteService } = createMutationService();
      coverStore.saveCustom.mockRejectedValue(new BadRequestException('Invalid image file'));

      await expect(service.uploadCover(12, Buffer.from('invalid'), 'image/jpeg', makeUser())).rejects.toThrow('Invalid image file');

      expect(scoreService.calculateAndSave).not.toHaveBeenCalled();
      expect(fileWriteService.scheduleWrite).not.toHaveBeenCalled();
    });

    it('propagates score persistence failures after saving the cover', async () => {
      const { service, coverStore, scoreService } = createMutationService();
      scoreService.calculateAndSave.mockRejectedValue(new Error('score failed'));

      await expect(service.uploadCover(12, Buffer.from('image-data'), 'image/jpeg', makeUser())).rejects.toThrow('score failed');
      expect(coverStore.saveCustom).toHaveBeenCalled();
    });

    it('reverts the requested slot and schedules a write when a cover remains', async () => {
      const { service, coverStore, scoreService, fileWriteService } = createMutationService();

      const result = await service.deleteCover(12, makeUser(), 'audio');

      expect(result).toBe('extracted');
      expect(coverStore.faceMediumFor).not.toHaveBeenCalled();
      expect(coverStore.revert).toHaveBeenCalledWith(12, 'audio');
      expect(scoreService.calculateAndSave).toHaveBeenCalledWith(12);
      expect(fileWriteService.scheduleWrite).toHaveBeenCalledWith(12, 'auto', 1);
    });

    it('returns null and schedules no write when no cover remains after delete', async () => {
      const { service, coverStore, fileWriteService } = createMutationService();
      coverStore.revert.mockResolvedValue(null);

      const result = await service.deleteCover(12, makeUser());

      expect(result).toBeNull();
      expect(coverStore.revert).toHaveBeenCalledWith(12, 'ebook');
      expect(fileWriteService.scheduleWrite).not.toHaveBeenCalled();
    });
  });
});
