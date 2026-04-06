import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';

import { DEFAULT_DOWNLOAD_PATTERN, DEFAULT_UPLOAD_PATTERN } from '@projectx/types';

import { AppSettingsRepository } from './app-settings.repository';
import { AppSettingsService } from './app-settings.service';

function makeRepo(): jest.Mocked<AppSettingsRepository> {
  return {
    listPublic: vi.fn().mockResolvedValue([]),
    findByKey: vi.fn().mockResolvedValue(undefined),
    findMany: vi.fn().mockResolvedValue([]),
    updateByKey: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AppSettingsRepository>;
}

describe('AppSettingsService', () => {
  let service: AppSettingsService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    service = new AppSettingsService(repo);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listSettings', () => {
    it('delegates to repo.listPublic', async () => {
      const rows = [{ key: 'allow_registration', value: 'true' }];
      repo.listPublic.mockResolvedValue(rows as never);
      const result = await service.listSettings();
      expect(result).toEqual(rows);
      expect(repo.listPublic).toHaveBeenCalledOnce();
    });
  });

  describe('getValue', () => {
    it('returns the stored value', async () => {
      repo.findByKey.mockResolvedValue({ key: 'opds_enabled', value: 'false' } as never);
      expect(await service.getValue('opds_enabled')).toBe('false');
    });

    it('returns null when key not found', async () => {
      repo.findByKey.mockResolvedValue(undefined);
      expect(await service.getValue('missing')).toBeNull();
    });
  });

  describe('update', () => {
    it('returns updated setting', async () => {
      const setting = { key: 'allow_registration', value: 'true' };
      repo.updateByKey.mockResolvedValue(setting as never);
      const result = await service.update('allow_registration', 'true');
      expect(result).toEqual(setting);
    });

    it('throws NotFoundException when key does not exist', async () => {
      repo.updateByKey.mockResolvedValue(null);
      await expect(service.update('nonexistent_key', 'value')).rejects.toThrow(NotFoundException);
    });
  });

  describe('isBookBucketAutoFetchEnabled', () => {
    it('returns true by default when setting is absent', async () => {
      repo.findByKey.mockResolvedValue(undefined);
      expect(await service.isBookBucketAutoFetchEnabled()).toBe(true);
    });

    it('returns false when value is "false"', async () => {
      repo.findByKey.mockResolvedValue({ key: 'book_bucket_auto_fetch_metadata', value: 'false' } as never);
      expect(await service.isBookBucketAutoFetchEnabled()).toBe(false);
    });

    it('returns true when value is "true"', async () => {
      repo.findByKey.mockResolvedValue({ key: 'book_bucket_auto_fetch_metadata', value: 'true' } as never);
      expect(await service.isBookBucketAutoFetchEnabled()).toBe(true);
    });

    it('returns true when value is unrecognised', async () => {
      repo.findByKey.mockResolvedValue({ key: 'book_bucket_auto_fetch_metadata', value: 'yes' } as never);
      expect(await service.isBookBucketAutoFetchEnabled()).toBe(true);
    });
  });

  describe('author settings', () => {
    it('getAuthorsAutoEnrichmentWriteMode defaults to missing_only', async () => {
      repo.findByKey.mockResolvedValue(undefined);
      expect(await service.getAuthorsAutoEnrichmentWriteMode()).toBe('missing_only');
    });

    it('getAuthorsAutoEnrichmentWriteMode accepts always_refetch', async () => {
      repo.findByKey.mockResolvedValue({ key: 'authors_auto_enrichment_write_mode', value: 'always_refetch' } as never);
      expect(await service.getAuthorsAutoEnrichmentWriteMode()).toBe('always_refetch');
    });

    it('getAuthorsAutoEnrichmentWriteMode falls back to missing_only for unknown value', async () => {
      repo.findByKey.mockResolvedValue({ key: 'authors_auto_enrichment_write_mode', value: 'unknown' } as never);
      expect(await service.getAuthorsAutoEnrichmentWriteMode()).toBe('missing_only');
    });

    it('isAuthorsProviderAudnexusEnabled defaults to true', async () => {
      repo.findByKey.mockResolvedValue(undefined);
      expect(await service.isAuthorsProviderAudnexusEnabled()).toBe(true);
    });

    it('isAuthorsProviderAudnexusEnabled returns false when stored', async () => {
      repo.findByKey.mockResolvedValue({ key: 'authors_provider_audnexus_enabled', value: 'false' } as never);
      expect(await service.isAuthorsProviderAudnexusEnabled()).toBe(false);
    });
  });

  describe('getOidcConfig', () => {
    it('returns default config when no row in db', async () => {
      repo.findByKey.mockResolvedValue(undefined);
      const config = await service.getOidcConfig();
      expect(config.enabled).toBe(false);
      expect(config.scopes).toBe('openid profile email');
      expect(config.claimMapping.username).toBe('preferred_username');
    });

    it('returns stored config when present', async () => {
      const stored = {
        enabled: true,
        providerName: 'Keycloak',
        issuerUri: 'https://kc.example.com/realms/main',
        clientId: 'projectx',
        clientSecret: 'secret',
        scopes: 'openid profile email groups',
        claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
        autoProvision: { enabled: true, allowLocalLinking: false, defaultPermissionNames: ['library_download'] },
      };
      repo.findByKey.mockResolvedValue({ key: 'oidc_config', value: JSON.stringify(stored) } as never);
      const config = await service.getOidcConfig();
      expect(config).toEqual(stored);
    });

    it('merges missing stored fields with defaults', async () => {
      const stored = {
        enabled: true,
        issuerUri: 'https://kc.example.com/realms/main',
        clientId: 'projectx',
        claimMapping: { username: 'upn' },
      };
      repo.findByKey.mockResolvedValue({ key: 'oidc_config', value: JSON.stringify(stored) } as never);

      const config = await service.getOidcConfig();
      expect(config.enabled).toBe(true);
      expect(config.providerName).toBe('');
      expect(config.clientId).toBe('projectx');
      expect(config.claimMapping.username).toBe('upn');
      expect(config.claimMapping.groups).toBe('groups');
      expect(config.autoProvision.allowLocalLinking).toBe(true);
    });

    it('returns default config and warns when stored value is corrupt JSON', async () => {
      repo.findByKey.mockResolvedValue({ key: 'oidc_config', value: 'not-json' } as never);
      const warnSpy = vi.spyOn(Logger.prototype, 'warn');
      const config = await service.getOidcConfig();
      expect(config.enabled).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('oidc_config'));
    });
  });

  describe('updateOidcConfig', () => {
    it('merges partial config into existing', async () => {
      const existing = {
        enabled: false,
        providerName: '',
        issuerUri: '',
        clientId: '',
        clientSecret: '',
        scopes: 'openid profile email',
        claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
        autoProvision: { enabled: false, allowLocalLinking: true, defaultPermissionNames: [] },
      };
      repo.findByKey.mockResolvedValue({ key: 'oidc_config', value: JSON.stringify(existing) } as never);

      const result = await service.updateOidcConfig({ enabled: true, clientId: 'new-client' });
      expect(result.enabled).toBe(true);
      expect(result.clientId).toBe('new-client');
      expect(result.scopes).toBe('openid profile email');
      expect(repo.upsert).toHaveBeenCalledOnce();
    });

    it('deep-merges claimMapping and autoProvision', async () => {
      repo.findByKey.mockResolvedValue(undefined);

      const result = await service.updateOidcConfig({
        claimMapping: { groups: 'cognito:groups', username: 'preferred_username', name: 'name', email: 'email' },
        autoProvision: { enabled: true, allowLocalLinking: true, defaultPermissionNames: [] },
      });
      expect(result.claimMapping.username).toBe('preferred_username');
      expect(result.claimMapping.groups).toBe('cognito:groups');
      expect(result.autoProvision.enabled).toBe(true);
      expect(result.autoProvision.allowLocalLinking).toBe(true);
    });
  });

  describe('testOidcConnection', () => {
    const discoveryDoc = {
      issuer: 'https://kc.example.com/realms/main',
      authorization_endpoint: 'https://kc.example.com/realms/main/protocol/openid-connect/auth',
    };

    it('throws BadRequestException when no issuer URI is configured', async () => {
      repo.findByKey.mockResolvedValue(undefined);
      await expect(service.testOidcConnection()).rejects.toThrow(BadRequestException);
    });

    it('returns success with issuer and authorizationEndpoint on valid discovery doc', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(discoveryDoc) }));
      const result = await service.testOidcConnection('https://kc.example.com/realms/main');
      expect(result.success).toBe(true);
      expect(result.issuer).toBe(discoveryDoc.issuer);
      expect(result.authorizationEndpoint).toBe(discoveryDoc.authorization_endpoint);
      vi.unstubAllGlobals();
    });

    it('throws BadRequestException when provider returns non-ok HTTP status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
      await expect(service.testOidcConnection('https://kc.example.com/realms/main')).rejects.toThrow(BadRequestException);
      vi.unstubAllGlobals();
    });

    it('throws BadRequestException when discovery doc is missing required fields', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ issuer: 'only-issuer' }) }));
      await expect(service.testOidcConnection('https://kc.example.com/realms/main')).rejects.toThrow(BadRequestException);
      vi.unstubAllGlobals();
    });

    it('throws BadRequestException when fetch rejects (network error)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
      await expect(service.testOidcConnection('https://bad.host')).rejects.toThrow(BadRequestException);
      vi.unstubAllGlobals();
    });

    it('strips trailing slash from issuer URI before building discovery URL', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(discoveryDoc) });
      vi.stubGlobal('fetch', fetchMock);
      await service.testOidcConnection('https://kc.example.com/realms/main/');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kc.example.com/realms/main/.well-known/openid-configuration',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      vi.unstubAllGlobals();
    });

    it('uses saved issuerUri when none is provided via argument', async () => {
      const stored = JSON.stringify({
        enabled: true,
        issuerUri: 'https://saved.host',
        clientId: '',
        clientSecret: '',
        providerName: '',
        scopes: '',
        claimMapping: { username: '', name: '', email: '', groups: '' },
        autoProvision: { enabled: false, allowLocalLinking: true, defaultPermissionNames: [] },
      });
      repo.findByKey.mockResolvedValue({ key: 'oidc_config', value: stored } as never);
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(discoveryDoc) });
      vi.stubGlobal('fetch', fetchMock);
      await service.testOidcConnection();
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('https://saved.host'), expect.any(Object));
      vi.unstubAllGlobals();
    });
  });

  describe('getAutoFinalizeSettings', () => {
    it('returns defaults when no rows exist', async () => {
      repo.findMany.mockResolvedValue([]);

      const result = await service.getAutoFinalizeSettings();
      expect(result.enabled).toBe(false);
      expect(result.threshold).toBe(85);
      expect(result.libraryId).toBeNull();
      expect(result.folderId).toBeNull();
      expect(result.metadataMode).toBe('safe_merge');
    });

    it('parses stored values correctly', async () => {
      repo.findMany.mockResolvedValue([
        { key: 'book_bucket_auto_finalize_enabled', value: 'true' },
        { key: 'book_bucket_auto_finalize_threshold', value: '90' },
        { key: 'book_bucket_auto_finalize_library_id', value: '5' },
        { key: 'book_bucket_auto_finalize_folder_id', value: '12' },
        { key: 'book_bucket_auto_finalize_metadata_mode', value: 'fetched_only' },
      ] as never);

      const result = await service.getAutoFinalizeSettings();
      expect(result.enabled).toBe(true);
      expect(result.threshold).toBe(90);
      expect(result.libraryId).toBe(5);
      expect(result.folderId).toBe(12);
      expect(result.metadataMode).toBe('fetched_only');
    });

    it('returns null for library/folder when values are not valid numbers', async () => {
      repo.findMany.mockResolvedValue([
        { key: 'book_bucket_auto_finalize_library_id', value: 'abc' },
        { key: 'book_bucket_auto_finalize_folder_id', value: '' },
      ] as never);

      const result = await service.getAutoFinalizeSettings();
      expect(result.libraryId).toBeNull();
      expect(result.folderId).toBeNull();
      expect(result.metadataMode).toBe('safe_merge');
    });

    it('falls back to safe_merge when metadata mode is invalid', async () => {
      repo.findMany.mockResolvedValue([{ key: 'book_bucket_auto_finalize_metadata_mode', value: 'invalid_mode' }] as never);

      const result = await service.getAutoFinalizeSettings();
      expect(result.metadataMode).toBe('safe_merge');
    });

    it('accepts embedded_only as a valid metadata mode', async () => {
      repo.findMany.mockResolvedValue([{ key: 'book_bucket_auto_finalize_metadata_mode', value: 'embedded_only' }] as never);

      const result = await service.getAutoFinalizeSettings();
      expect(result.metadataMode).toBe('embedded_only');
    });
  });

  describe('getUploadPattern / getDownloadPattern', () => {
    it('returns DEFAULT_UPLOAD_PATTERN when not set', async () => {
      repo.findByKey.mockResolvedValue(undefined);
      expect(await service.getUploadPattern()).toBe(DEFAULT_UPLOAD_PATTERN);
    });

    it('returns stored upload pattern', async () => {
      repo.findByKey.mockResolvedValue({ key: 'upload_file_pattern', value: '{title}' } as never);
      expect(await service.getUploadPattern()).toBe('{title}');
    });

    it(`returns '${DEFAULT_DOWNLOAD_PATTERN}' as default download pattern`, async () => {
      repo.findByKey.mockResolvedValue(undefined);
      expect(await service.getDownloadPattern()).toBe(DEFAULT_DOWNLOAD_PATTERN);
    });

    it('returns stored download pattern', async () => {
      repo.findByKey.mockResolvedValue({ key: 'download_file_pattern', value: '{author} - {title}' } as never);
      expect(await service.getDownloadPattern()).toBe('{author} - {title}');
    });

    it('upserts upload pattern on setUploadPattern', async () => {
      await service.setUploadPattern('{title}');
      expect(repo.upsert).toHaveBeenCalledWith('upload_file_pattern', '{title}');
    });

    it('upserts download pattern on setDownloadPattern', async () => {
      await service.setDownloadPattern('{title}');
      expect(repo.upsert).toHaveBeenCalledWith('download_file_pattern', '{title}');
    });
  });

  describe('getMetadataScoreWeights', () => {
    it('returns defaults when not configured', async () => {
      repo.findByKey.mockResolvedValue(undefined);
      const weights = await service.getMetadataScoreWeights();
      expect(typeof weights).toBe('object');
    });

    it('merges stored weights over defaults', async () => {
      const stored = { title: 99 };
      repo.findByKey.mockResolvedValue({ key: 'metadata_score_weights', value: JSON.stringify(stored) } as never);
      const weights = await service.getMetadataScoreWeights();
      expect(weights.title).toBe(99);
    });

    it('returns defaults and warns when stored weights are corrupt JSON', async () => {
      repo.findByKey.mockResolvedValue({ key: 'metadata_score_weights', value: 'bad-json' } as never);
      const warnSpy = vi.spyOn(Logger.prototype, 'warn');
      await service.getMetadataScoreWeights();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('metadata_score_weights'));
    });
  });

  describe('setMetadataScoreWeights', () => {
    it('upserts and returns the provided weights', async () => {
      const weights = { title: 10, author: 20, isbn: 30, cover: 5, description: 5, publisher: 5, year: 5, language: 5, series: 5, tags: 5 };
      const result = await service.setMetadataScoreWeights(weights as never);
      expect(result).toEqual(weights);
      expect(repo.upsert).toHaveBeenCalledOnce();
    });
  });
});
