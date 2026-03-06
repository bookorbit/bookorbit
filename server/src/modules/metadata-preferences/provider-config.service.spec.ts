import { MetadataProviderKey } from '@projectx/types';

import { ProviderConfigService } from './provider-config.service';

function createDb() {
  const insertChain = {
    values: jest.fn().mockReturnThis(),
    onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
  };

  return {
    query: {
      appSettings: {
        findFirst: jest.fn(),
      },
    },
    insert: jest.fn().mockReturnValue(insertChain),
    __insertChain: insertChain,
  };
}

describe('ProviderConfigService', () => {
  let db: ReturnType<typeof createDb>;
  let service: ProviderConfigService;

  beforeEach(() => {
    db = createDb();
    service = new ProviderConfigService(db as never);
  });

  it('returns defaults when no stored config exists', async () => {
    db.query.appSettings.findFirst.mockResolvedValue(undefined);

    const config = await service.getConfig();

    expect(config).toEqual({
      google: { enabled: true, apiKey: '' },
      amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
      goodreads: { enabled: true },
      hardcover: { enabled: false, apiKey: '' },
      openLibrary: { enabled: true },
    });
  });

  it('returns fresh default objects to avoid cross-request mutation leaks', async () => {
    db.query.appSettings.findFirst.mockResolvedValue(undefined);

    const first = await service.getConfig();
    first.google.enabled = false;
    first.amazon.domain = 'example.invalid';

    const second = await service.getConfig();

    expect(second.google.enabled).toBe(true);
    expect(second.amazon.domain).toBe('amazon.com');
  });

  it('merges stored partial config with defaults', async () => {
    db.query.appSettings.findFirst.mockResolvedValue({
      value: JSON.stringify({
        google: { apiKey: 'key-1' },
        hardcover: { enabled: true, apiKey: 'hardcover-key' },
      }),
    });

    const config = await service.getConfig();

    expect(config.google).toEqual({ enabled: true, apiKey: 'key-1' });
    expect(config.amazon).toEqual({ enabled: true, domain: 'amazon.com', cookie: '' });
    expect(config.hardcover).toEqual({ enabled: true, apiKey: 'hardcover-key' });
  });

  it('handles malformed provider sections without discarding valid sections', async () => {
    db.query.appSettings.findFirst.mockResolvedValue({
      value: JSON.stringify({
        google: { enabled: false, apiKey: 'g-key' },
        amazon: null,
        goodreads: 'invalid',
      }),
    });

    const config = await service.getConfig();

    expect(config.google).toEqual({ enabled: false, apiKey: 'g-key' });
    expect(config.amazon).toEqual({ enabled: true, domain: 'amazon.com', cookie: '' });
    expect(config.goodreads).toEqual({ enabled: true });
  });

  it('falls back to defaults when stored JSON is invalid', async () => {
    db.query.appSettings.findFirst.mockResolvedValue({ value: '{not-json' });

    const config = await service.getConfig();

    expect(config.google.apiKey).toBe('');
    expect(config.hardcover.enabled).toBe(false);
  });

  it('updates config via deep merge and persists the complete object', async () => {
    db.query.appSettings.findFirst.mockResolvedValue({
      value: JSON.stringify({
        google: { enabled: true, apiKey: 'old' },
        amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
      }),
    });

    const updated = await service.updateConfig({
      google: { enabled: false },
      amazon: { cookie: 'session-cookie' },
      hardcover: { enabled: true, apiKey: 'h-key' },
    });

    expect(updated.google).toEqual({ enabled: false, apiKey: 'old' });
    expect(updated.amazon).toEqual({ enabled: true, domain: 'amazon.com', cookie: 'session-cookie' });
    expect(updated.hardcover).toEqual({ enabled: true, apiKey: 'h-key' });
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.__insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'metadata_provider_config',
        value: JSON.stringify(updated),
      }),
    );
  });

  it('builds provider statuses including provider-specific configuration hints', async () => {
    const statuses = await service.getProviderStatuses({
      google: { enabled: true, apiKey: '' },
      amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
      goodreads: { enabled: false },
      hardcover: { enabled: true, apiKey: '' },
      openLibrary: { enabled: true },
    });

    expect(statuses.map((s) => s.key)).toEqual([
      MetadataProviderKey.GOOGLE,
      MetadataProviderKey.AMAZON,
      MetadataProviderKey.GOODREADS,
      MetadataProviderKey.HARDCOVER,
      MetadataProviderKey.OPEN_LIBRARY,
    ]);
    expect(statuses.find((s) => s.key === MetadataProviderKey.GOOGLE)?.hint).toContain('API key recommended');
    expect(statuses.find((s) => s.key === MetadataProviderKey.AMAZON)?.hint).toContain('Cookie recommended');
    expect(statuses.find((s) => s.key === MetadataProviderKey.HARDCOVER)?.configured).toBe(false);
    expect(statuses.find((s) => s.key === MetadataProviderKey.GOODREADS)?.enabled).toBe(false);
  });

  it('reports hardcover as configured when api key is present', async () => {
    const statuses = await service.getProviderStatuses({
      google: { enabled: true, apiKey: 'g' },
      amazon: { enabled: true, domain: 'amazon.com', cookie: 'c' },
      goodreads: { enabled: true },
      hardcover: { enabled: true, apiKey: 'h-key' },
      openLibrary: { enabled: true },
    });

    expect(statuses.find((s) => s.key === MetadataProviderKey.HARDCOVER)?.configured).toBe(true);
    expect(statuses.find((s) => s.key === MetadataProviderKey.GOOGLE)?.hint).toBeUndefined();
    expect(statuses.find((s) => s.key === MetadataProviderKey.AMAZON)?.hint).toBeUndefined();
  });
});
