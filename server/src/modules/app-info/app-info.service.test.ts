import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppSettingsService } from '../app-settings/app-settings.service';
import { GITHUB_RELEASES_API } from './app-info.constants';
import { AppInfoService } from './app-info.service';

function makeConfig(version = 'v1.2.3', appDataPath = '/data'): jest.Mocked<ConfigService> {
  return {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'storage.appDataPath') return appDataPath;
      if (key === 'app.version') return version;
      return undefined;
    }),
  } as unknown as jest.Mocked<ConfigService>;
}

function makeAppSettings(enabled = true): jest.Mocked<AppSettingsService> {
  return {
    isUpdateCheckEnabled: vi.fn().mockResolvedValue(enabled),
  } as unknown as jest.Mocked<AppSettingsService>;
}

function makeGithubResponse(tagName: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue({ tag_name: tagName }),
  } as unknown as Response;
}

describe('AppInfoService', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAppInfo', () => {
    it('returns version from config', async () => {
      const service = new AppInfoService(makeConfig('v2.0.0'), makeAppSettings());
      expect((await service.getAppInfo()).version).toBe('v2.0.0');
    });

    it('defaults to "Local build" when config returns undefined', async () => {
      const config = { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService;
      const service = new AppInfoService(config, makeAppSettings());
      expect((await service.getAppInfo()).version).toBe('Local build');
    });

    it('returns null for updateAvailable when update check is skipped', async () => {
      const service = new AppInfoService(makeConfig('Local build'), makeAppSettings());
      const info = await service.getAppInfo();
      expect(info.updateAvailable).toBeNull();
      expect(info.latestVersion).toBeNull();
    });

    it('returns bookDockPath as appDataPath/book-dock', async () => {
      const service = new AppInfoService(makeConfig('v1.0.0', '/custom/data'), makeAppSettings());
      expect((await service.getAppInfo()).bookDockPath).toBe('/custom/data/book-dock');
    });

    it('falls back to /data/book-dock when storage.appDataPath is not configured', async () => {
      const config = { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService;
      const service = new AppInfoService(config, makeAppSettings());
      expect((await service.getAppInfo()).bookDockPath).toBe('/data/book-dock');
    });

    it('includes bookDockPath in full response shape', async () => {
      const service = new AppInfoService(makeConfig('Local build', '/app/data'), makeAppSettings());
      const info = await service.getAppInfo();
      expect(info).toMatchObject({
        version: 'Local build',
        updateAvailable: null,
        latestVersion: null,
        bookDockPath: '/app/data/book-dock',
      });
    });

    it('fetches from GitHub if checked for the first time', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(makeGithubResponse('v1.3.0'));
      const service = new AppInfoService(makeConfig('v1.2.3'), makeAppSettings(true));

      const info = await service.getAppInfo();
      expect(info.updateAvailable).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('returns cached result and does not fetch if less than 10 minutes have passed', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(makeGithubResponse('v1.3.0'));
      const service = new AppInfoService(makeConfig('v1.2.3'), makeAppSettings(true));

      await service.getAppInfo(); // First call triggers fetch
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await service.getAppInfo(); // Second call within 10 min uses cache
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('re-fetches if more than 10 minutes have elapsed', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(makeGithubResponse('v1.3.0'));
      const service = new AppInfoService(makeConfig('v1.2.3'), makeAppSettings(true));

      await service.getAppInfo(); // First call
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Fast-forward time by 10 minutes and 1 millisecond
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600001);

      await service.getAppInfo(); // Second call after TTL expires
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      vi.restoreAllMocks();
    });
  });

  describe('onApplicationBootstrap', () => {
    it('fetches GitHub API and sets updateAvailable: true when newer version exists', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(makeGithubResponse('v1.3.0'));

      const service = new AppInfoService(makeConfig('v1.2.3'), makeAppSettings(true));
      await service.onApplicationBootstrap();

      const info = await service.getAppInfo();
      expect(info.updateAvailable).toBe(true);
      expect(info.latestVersion).toBe('v1.3.0');
      expect(fetch).toHaveBeenCalledWith(GITHUB_RELEASES_API, expect.objectContaining({ headers: expect.any(Object) }));
    });

    it('sets updateAvailable: false when already on latest', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(makeGithubResponse('v1.2.3'));

      const service = new AppInfoService(makeConfig('v1.2.3'), makeAppSettings(true));
      await service.onApplicationBootstrap();

      expect((await service.getAppInfo()).updateAvailable).toBe(false);
    });

    it('sets updateAvailable: false when running newer than latest (downgrade scenario)', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(makeGithubResponse('v1.2.2'));

      const service = new AppInfoService(makeConfig('v1.2.3'), makeAppSettings(true));
      await service.onApplicationBootstrap();

      expect((await service.getAppInfo()).updateAvailable).toBe(false);
    });

    it('correctly compares minor version bumps', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(makeGithubResponse('v1.3.0'));

      const service = new AppInfoService(makeConfig('v1.2.9'), makeAppSettings(true));
      await service.onApplicationBootstrap();

      expect((await service.getAppInfo()).updateAvailable).toBe(true);
    });

    it('correctly compares major version bumps', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(makeGithubResponse('v2.0.0'));

      const service = new AppInfoService(makeConfig('v1.9.9'), makeAppSettings(true));
      await service.onApplicationBootstrap();

      expect((await service.getAppInfo()).updateAvailable).toBe(true);
    });

    it('skips fetch and leaves updateAvailable: null when version is "Local build"', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      const service = new AppInfoService(makeConfig('Local build'), makeAppSettings(true));
      await service.onApplicationBootstrap();

      expect(fetchSpy).not.toHaveBeenCalled();
      expect((await service.getAppInfo()).updateAvailable).toBeNull();
    });

    it('skips fetch when version is a sha-prefixed string', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      const service = new AppInfoService(makeConfig('sha-abc1234'), makeAppSettings(true));
      await service.onApplicationBootstrap();

      expect(fetchSpy).not.toHaveBeenCalled();
      expect((await service.getAppInfo()).updateAvailable).toBeNull();
    });

    it('skips fetch when update checks are disabled', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      const service = new AppInfoService(makeConfig('v1.2.3'), makeAppSettings(false));
      await service.onApplicationBootstrap();

      expect(fetchSpy).not.toHaveBeenCalled();
      expect((await service.getAppInfo()).updateAvailable).toBeNull();
    });

    it('leaves updateAvailable: null on network error (does not throw)', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

      const service = new AppInfoService(makeConfig('v1.2.3'), makeAppSettings(true));
      await expect(service.onApplicationBootstrap()).resolves.not.toThrow();

      expect((await service.getAppInfo()).updateAvailable).toBeNull();
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('leaves updateAvailable: null on AbortError timeout (does not throw)', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      vi.spyOn(global, 'fetch').mockRejectedValue(abortError);

      const service = new AppInfoService(makeConfig('v1.2.3'), makeAppSettings(true));
      await expect(service.onApplicationBootstrap()).resolves.not.toThrow();

      expect((await service.getAppInfo()).updateAvailable).toBeNull();
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('leaves updateAvailable: null when GitHub API returns non-200', async () => {
      const badResponse: Response = {
        ok: false,
        status: 403,
        json: vi.fn(),
      } as unknown as Response;
      vi.spyOn(global, 'fetch').mockResolvedValue(badResponse);

      const service = new AppInfoService(makeConfig('v1.2.3'), makeAppSettings(true));
      await service.onApplicationBootstrap();

      expect((await service.getAppInfo()).updateAvailable).toBeNull();
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('leaves updateAvailable: null when GitHub API returns null body', async () => {
      const response: Response = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(null),
      } as unknown as Response;
      vi.spyOn(global, 'fetch').mockResolvedValue(response);

      const service = new AppInfoService(makeConfig('v1.2.3'), makeAppSettings(true));
      await service.onApplicationBootstrap();

      expect((await service.getAppInfo()).updateAvailable).toBeNull();
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('leaves updateAvailable: null when tag_name is missing from response', async () => {
      const response: Response = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ name: 'Release 1.3.0' }),
      } as unknown as Response;
      vi.spyOn(global, 'fetch').mockResolvedValue(response);

      const service = new AppInfoService(makeConfig('v1.2.3'), makeAppSettings(true));
      await service.onApplicationBootstrap();

      expect((await service.getAppInfo()).updateAvailable).toBeNull();
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('leaves updateAvailable: null when tag_name is not a valid semver', async () => {
      const response: Response = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ tag_name: 'not-a-version' }),
      } as unknown as Response;
      vi.spyOn(global, 'fetch').mockResolvedValue(response);

      const service = new AppInfoService(makeConfig('v1.2.3'), makeAppSettings(true));
      await service.onApplicationBootstrap();

      expect((await service.getAppInfo()).updateAvailable).toBeNull();
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('leaves updateAvailable: null when response body is not an object', async () => {
      const response: Response = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue('just a string'),
      } as unknown as Response;
      vi.spyOn(global, 'fetch').mockResolvedValue(response);

      const service = new AppInfoService(makeConfig('v1.2.3'), makeAppSettings(true));
      await service.onApplicationBootstrap();

      expect((await service.getAppInfo()).updateAvailable).toBeNull();
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('logs start and end on success', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(makeGithubResponse('v1.3.0'));

      const service = new AppInfoService(makeConfig('v1.2.3'), makeAppSettings(true));
      await service.onApplicationBootstrap();

      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(logSpy.mock.calls[0][0]).toContain('[start]');
      expect(logSpy.mock.calls[1][0]).toContain('[end]');
    });

    it('logs warn on failure', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'));

      const service = new AppInfoService(makeConfig('v1.2.3'), makeAppSettings(true));
      await service.onApplicationBootstrap();

      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toContain('[fail]');
    });
  });
});
