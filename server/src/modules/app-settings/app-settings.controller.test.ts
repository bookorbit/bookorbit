import { Test } from '@nestjs/testing';

import { AppSettingsController } from './app-settings.controller';
import { AppSettingsService } from './app-settings.service';
import { OidcProviderService } from './oidc-provider.service';

function makeService(): jest.Mocked<AppSettingsService> {
  return {
    listSettings: vi.fn().mockResolvedValue([]),
    getValue: vi.fn(),
    update: vi.fn(),
    isBookBucketAutoFetchEnabled: vi.fn(),
    getAuthorsAutoEnrichmentWriteMode: vi.fn(),
    isAuthorsProviderAudnexusEnabled: vi.fn(),
    getUploadPattern: vi.fn(),
    setUploadPattern: vi.fn(),
    getDownloadPattern: vi.fn(),
    setDownloadPattern: vi.fn(),
    getAutoFinalizeSettings: vi.fn(),
    getMetadataScoreWeights: vi.fn(),
    setMetadataScoreWeights: vi.fn(),
  } as unknown as jest.Mocked<AppSettingsService>;
}

function makeOidcProviderService(): jest.Mocked<OidcProviderService> {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    findEnabled: vi.fn().mockResolvedValue([]),
    findBySlugOrFail: vi.fn(),
    findByIdOrFail: vi.fn(),
    findByIssuerUri: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    reorder: vi.fn(),
    testConnection: vi.fn(),
    listGroupMappings: vi.fn().mockResolvedValue([]),
    createGroupMapping: vi.fn(),
    updateGroupMapping: vi.fn(),
    deleteGroupMapping: vi.fn(),
  } as unknown as jest.Mocked<OidcProviderService>;
}

describe('AppSettingsController', () => {
  let controller: AppSettingsController;
  let service: ReturnType<typeof makeService>;
  let oidcProviderService: ReturnType<typeof makeOidcProviderService>;

  beforeEach(async () => {
    service = makeService();
    oidcProviderService = makeOidcProviderService();
    const module = await Test.createTestingModule({
      controllers: [AppSettingsController],
      providers: [
        { provide: AppSettingsService, useValue: service },
        { provide: OidcProviderService, useValue: oidcProviderService },
      ],
    }).compile();
    controller = module.get(AppSettingsController);
  });

  describe('listSettings', () => {
    it('returns rows from service without oidc_config', async () => {
      const rows = [{ key: 'allow_registration', value: 'true' }];
      service.listSettings.mockResolvedValue(rows as never);
      expect(await controller.listSettings()).toEqual(rows);
    });
  });

  describe('update', () => {
    it('delegates to service.update', async () => {
      const setting = { key: 'allow_registration', value: 'true' };
      service.update.mockResolvedValue(setting as never);
      const result = await controller.update('allow_registration', { value: 'true' });
      expect(service.update).toHaveBeenCalledWith('allow_registration', 'true');
      expect(result).toEqual(setting);
    });
  });

  describe('getUploadPattern / setUploadPattern', () => {
    it('getUploadPattern returns pattern from service', async () => {
      service.getUploadPattern.mockResolvedValue('{title}');
      expect(await controller.getUploadPattern()).toEqual({ pattern: '{title}' });
    });

    it('setUploadPattern calls service and returns pattern', async () => {
      service.setUploadPattern.mockResolvedValue(undefined);
      const result = await controller.setUploadPattern({ pattern: '{title}' });
      expect(service.setUploadPattern).toHaveBeenCalledWith('{title}');
      expect(result).toEqual({ pattern: '{title}' });
    });
  });

  describe('getDownloadPattern / setDownloadPattern', () => {
    it('getDownloadPattern returns pattern from service', async () => {
      service.getDownloadPattern.mockResolvedValue('{originalFilename}');
      expect(await controller.getDownloadPattern()).toEqual({ pattern: '{originalFilename}' });
    });

    it('setDownloadPattern calls service and returns pattern', async () => {
      service.setDownloadPattern.mockResolvedValue(undefined);
      const result = await controller.setDownloadPattern({ pattern: '{originalFilename}' });
      expect(service.setDownloadPattern).toHaveBeenCalledWith('{originalFilename}');
      expect(result).toEqual({ pattern: '{originalFilename}' });
    });
  });

  describe('OIDC provider CRUD', () => {
    it('getOidcProvidersPublic returns enabled providers without secrets', async () => {
      oidcProviderService.findEnabled.mockResolvedValue([
        {
          id: 1,
          slug: 'keycloak',
          displayName: 'Keycloak',
          enabled: true,
          issuerUri: 'https://kc.example.com',
          clientId: 'projectx',
          clientSecret: 'secret',
          scopes: 'openid',
          iconUrl: null,
        },
      ] as never);
      const result = await controller.getOidcProvidersPublic();
      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('clientSecret');
      expect(result[0].clientId).toBe('projectx');
    });

    it('getOidcProvider masks clientSecret', async () => {
      oidcProviderService.findBySlugOrFail.mockResolvedValue({ id: 1, slug: 'keycloak', clientSecret: 'secret123' } as never);
      const result = await controller.getOidcProvider('keycloak');
      expect(result.clientSecret).toBe('***');
    });

    it('getOidcProvider returns empty clientSecret when not set', async () => {
      oidcProviderService.findBySlugOrFail.mockResolvedValue({ id: 1, slug: 'keycloak', clientSecret: '' } as never);
      const result = await controller.getOidcProvider('keycloak');
      expect(result.clientSecret).toBe('');
    });

    it('testOidcProviderConnection delegates to service', async () => {
      oidcProviderService.testConnection.mockResolvedValue({ success: true, issuer: 'https://kc.example.com' } as never);
      const result = await controller.testOidcProviderConnection('keycloak', 'https://kc.example.com');
      expect(oidcProviderService.testConnection).toHaveBeenCalledWith('https://kc.example.com');
      expect(result.success).toBe(true);
    });

    it('testOidcProviderConnection falls back to saved issuerUri', async () => {
      oidcProviderService.findBySlugOrFail.mockResolvedValue({ issuerUri: 'https://saved.example.com' } as never);
      oidcProviderService.testConnection.mockResolvedValue({ success: true } as never);
      await controller.testOidcProviderConnection('keycloak');
      expect(oidcProviderService.testConnection).toHaveBeenCalledWith('https://saved.example.com');
    });
  });
});
