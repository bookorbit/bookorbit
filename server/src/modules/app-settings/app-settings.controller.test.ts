import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppSettingsController } from './app-settings.controller';
import { AppSettingsService } from './app-settings.service';

function makeService(): jest.Mocked<AppSettingsService> {
  return {
    listSettings: vi.fn().mockResolvedValue([]),
    getValue: vi.fn(),
    update: vi.fn(),
    isBookBucketAutoFetchEnabled: vi.fn(),
    getAuthorsAutoEnrichmentWriteMode: vi.fn(),
    isAuthorsProviderAudnexusEnabled: vi.fn(),
    getOidcConfig: vi.fn(),
    updateOidcConfig: vi.fn(),
    testOidcConnection: vi.fn(),
    getUploadPattern: vi.fn(),
    setUploadPattern: vi.fn(),
    getDownloadPattern: vi.fn(),
    setDownloadPattern: vi.fn(),
    getAutoFinalizeSettings: vi.fn(),
    getMetadataScoreWeights: vi.fn(),
    setMetadataScoreWeights: vi.fn(),
  } as unknown as jest.Mocked<AppSettingsService>;
}

describe('AppSettingsController', () => {
  let controller: AppSettingsController;
  let service: ReturnType<typeof makeService>;

  beforeEach(async () => {
    service = makeService();
    const module = await Test.createTestingModule({
      controllers: [AppSettingsController],
      providers: [{ provide: AppSettingsService, useValue: service }],
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

  describe('getOidcPublicConfig', () => {
    it('returns only public fields, not clientSecret', async () => {
      service.getOidcConfig.mockResolvedValue({
        enabled: true,
        providerName: 'Keycloak',
        issuerUri: 'https://kc.example.com',
        clientId: 'projectx',
        clientSecret: 'supersecret',
        scopes: 'openid',
        claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
        autoProvision: { enabled: false, allowLocalLinking: true, defaultPermissionNames: [] },
      });
      const result = await controller.getOidcPublicConfig();
      expect(result).not.toHaveProperty('clientSecret');
      expect(result).not.toHaveProperty('claimMapping');
      expect(result).not.toHaveProperty('autoProvision');
      expect(result.clientId).toBe('projectx');
    });
  });

  describe('getOidcConfig', () => {
    it('masks clientSecret when present', async () => {
      service.getOidcConfig.mockResolvedValue({
        enabled: true,
        providerName: '',
        issuerUri: '',
        clientId: '',
        clientSecret: 'secret123',
        scopes: 'openid',
        claimMapping: { username: '', name: '', email: '', groups: '' },
        autoProvision: { enabled: false, allowLocalLinking: true, defaultPermissionNames: [] },
      });
      const result = await controller.getOidcConfig();
      expect(result.clientSecret).toBe('***');
    });

    it('returns empty string for clientSecret when not set', async () => {
      service.getOidcConfig.mockResolvedValue({
        enabled: false,
        providerName: '',
        issuerUri: '',
        clientId: '',
        clientSecret: '',
        scopes: 'openid',
        claimMapping: { username: '', name: '', email: '', groups: '' },
        autoProvision: { enabled: false, allowLocalLinking: true, defaultPermissionNames: [] },
      });
      const result = await controller.getOidcConfig();
      expect(result.clientSecret).toBe('');
    });
  });

  describe('testOidcConnection', () => {
    it('delegates to service.testOidcConnection with provided issuerUri', async () => {
      service.testOidcConnection.mockResolvedValue({
        success: true,
        issuer: 'https://kc.example.com',
        authorizationEndpoint: 'https://kc.example.com/auth',
      });
      const result = await controller.testOidcConnection('https://kc.example.com');
      expect(service.testOidcConnection).toHaveBeenCalledWith('https://kc.example.com');
      expect(result.success).toBe(true);
    });

    it('propagates BadRequestException from service', async () => {
      service.testOidcConnection.mockRejectedValue(new BadRequestException('Issuer URI is not configured'));
      await expect(controller.testOidcConnection()).rejects.toThrow(BadRequestException);
    });
  });
});
