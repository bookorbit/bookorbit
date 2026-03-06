import { NotFoundException } from '@nestjs/common';

import { AppSettingsService } from './app-settings.service';

function makeDb() {
  return {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
    returning: jest.fn().mockResolvedValue([]),
    query: {
      appSettings: {
        findFirst: jest.fn(),
      },
    },
  };
}

describe('AppSettingsService', () => {
  let service: AppSettingsService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
    service = new AppSettingsService(db as never);
  });

  describe('update', () => {
    it('returns updated setting', async () => {
      const setting = { key: 'allow_registration', value: 'true' };
      db.returning.mockResolvedValue([setting]);

      const result = await service.update('allow_registration', 'true');
      expect(result).toEqual(setting);
    });

    it('throws NotFoundException when key does not exist', async () => {
      db.returning.mockResolvedValue([]);
      await expect(service.update('nonexistent_key', 'value')).rejects.toThrow(NotFoundException);
    });
  });

  describe('isStagingAutoFetchEnabled', () => {
    it('returns true by default when setting is absent', async () => {
      db.query.appSettings.findFirst.mockResolvedValue(undefined);
      expect(await service.isStagingAutoFetchEnabled()).toBe(true);
    });

    it('returns false when value is "false"', async () => {
      db.query.appSettings.findFirst.mockResolvedValue({ key: 'staging_auto_fetch_metadata', value: 'false' });
      expect(await service.isStagingAutoFetchEnabled()).toBe(false);
    });

    it('returns true when value is "true"', async () => {
      db.query.appSettings.findFirst.mockResolvedValue({ key: 'staging_auto_fetch_metadata', value: 'true' });
      expect(await service.isStagingAutoFetchEnabled()).toBe(true);
    });
  });

  describe('getOidcConfig', () => {
    it('returns default config when no row in db', async () => {
      db.query.appSettings.findFirst.mockResolvedValue(undefined);
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
        autoProvision: { enabled: true, allowLocalLinking: false, defaultRoleId: 2 },
      };
      db.query.appSettings.findFirst.mockResolvedValue({ key: 'oidc_config', value: JSON.stringify(stored) });
      const config = await service.getOidcConfig();
      expect(config).toEqual(stored);
    });

    it('returns default config when stored value is corrupt JSON', async () => {
      db.query.appSettings.findFirst.mockResolvedValue({ key: 'oidc_config', value: 'not-json' });
      const config = await service.getOidcConfig();
      expect(config.enabled).toBe(false);
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
        autoProvision: { enabled: false, allowLocalLinking: true, defaultRoleId: null },
      };
      db.query.appSettings.findFirst.mockResolvedValue({ key: 'oidc_config', value: JSON.stringify(existing) });
      db.onConflictDoUpdate.mockResolvedValue(undefined);

      const result = await service.updateOidcConfig({ enabled: true, clientId: 'new-client' });
      expect(result.enabled).toBe(true);
      expect(result.clientId).toBe('new-client');
      expect(result.scopes).toBe('openid profile email');
    });

    it('deep-merges claimMapping and autoProvision', async () => {
      db.query.appSettings.findFirst.mockResolvedValue(undefined);
      db.onConflictDoUpdate.mockResolvedValue(undefined);

      const result = await service.updateOidcConfig({
        claimMapping: { groups: 'cognito:groups' } as never,
        autoProvision: { enabled: true } as never,
      });
      expect(result.claimMapping.username).toBe('preferred_username');
      expect(result.claimMapping.groups).toBe('cognito:groups');
      expect(result.autoProvision.enabled).toBe(true);
      expect(result.autoProvision.allowLocalLinking).toBe(true);
    });
  });

  describe('getAutoFinalizeSettings', () => {
    it('returns defaults when no rows exist', async () => {
      db.where.mockResolvedValue([]);

      const result = await service.getAutoFinalizeSettings();
      expect(result.enabled).toBe(false);
      expect(result.threshold).toBe(85);
      expect(result.libraryId).toBeNull();
      expect(result.folderId).toBeNull();
    });

    it('parses stored values correctly', async () => {
      db.where.mockResolvedValue([
        { key: 'staging_auto_finalize_enabled', value: 'true' },
        { key: 'staging_auto_finalize_threshold', value: '90' },
        { key: 'staging_auto_finalize_library_id', value: '5' },
        { key: 'staging_auto_finalize_folder_id', value: '12' },
      ]);

      const result = await service.getAutoFinalizeSettings();
      expect(result.enabled).toBe(true);
      expect(result.threshold).toBe(90);
      expect(result.libraryId).toBe(5);
      expect(result.folderId).toBe(12);
    });

    it('returns null for library/folder when values are not valid numbers', async () => {
      db.where.mockResolvedValue([
        { key: 'staging_auto_finalize_library_id', value: 'abc' },
        { key: 'staging_auto_finalize_folder_id', value: '' },
      ]);

      const result = await service.getAutoFinalizeSettings();
      expect(result.libraryId).toBeNull();
      expect(result.folderId).toBeNull();
    });
  });

  describe('getUploadPattern / getDownloadPattern', () => {
    it('returns DEFAULT_UPLOAD_PATTERN when not set', async () => {
      db.query.appSettings.findFirst.mockResolvedValue(undefined);
      const pattern = await service.getUploadPattern();
      expect(typeof pattern).toBe('string');
      expect(pattern.length).toBeGreaterThan(0);
    });

    it('returns stored upload pattern', async () => {
      db.query.appSettings.findFirst.mockResolvedValue({ key: 'upload_file_pattern', value: '{title}' });
      expect(await service.getUploadPattern()).toBe('{title}');
    });

    it('returns {originalFilename} as default download pattern', async () => {
      db.query.appSettings.findFirst.mockResolvedValue(undefined);
      expect(await service.getDownloadPattern()).toBe('{originalFilename}');
    });

    it('returns stored download pattern', async () => {
      db.query.appSettings.findFirst.mockResolvedValue({ key: 'download_file_pattern', value: '{author} - {title}' });
      expect(await service.getDownloadPattern()).toBe('{author} - {title}');
    });
  });

  describe('getFileWriteSettings', () => {
    it('returns default settings when not configured', async () => {
      db.query.appSettings.findFirst.mockResolvedValue(undefined);
      const settings = await service.getFileWriteSettings();
      expect(settings).toHaveProperty('epub');
      expect(settings).toHaveProperty('pdf');
      expect(settings).toHaveProperty('cbx');
    });

    it('merges stored partial settings with defaults', async () => {
      const stored = { epub: { writeMetadata: true } };
      db.query.appSettings.findFirst.mockResolvedValue({ key: 'file_write_settings', value: JSON.stringify(stored) });
      const settings = await service.getFileWriteSettings();
      expect(settings.epub.writeMetadata).toBe(true);
      expect(settings.pdf).toBeDefined();
    });

    it('returns defaults when stored value is corrupt JSON', async () => {
      db.query.appSettings.findFirst.mockResolvedValue({ key: 'file_write_settings', value: '{broken' });
      const settings = await service.getFileWriteSettings();
      expect(settings).toHaveProperty('epub');
    });
  });

  describe('updateFileWriteSettings', () => {
    it('deep-merges epub patch without overwriting pdf/cbx', async () => {
      db.query.appSettings.findFirst.mockResolvedValue(undefined);
      db.onConflictDoUpdate.mockResolvedValue(undefined);

      const result = await service.updateFileWriteSettings({ epub: { writeMetadata: true } as never });
      expect(result.epub.writeMetadata).toBe(true);
      expect(result.pdf).toBeDefined();
    });
  });
});
