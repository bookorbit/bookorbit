import { Logger } from '@nestjs/common';
import { MetadataProviderKey } from '@bookorbit/types';

import { ProviderConfigService } from './provider-config.service';

function createInsertChain() {
  return {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  };
}

function createDb() {
  const insertChain = createInsertChain();
  const txInsertChain = createInsertChain();

  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    query: {
      appSettings: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn().mockReturnValue(txInsertChain),
  };

  return {
    query: {
      appSettings: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn().mockReturnValue(insertChain),
    transaction: vi.fn((cb) => Promise.resolve(cb(tx))),
    __insertChain: insertChain,
    __tx: tx,
    __txInsertChain: txInsertChain,
  };
}

describe('ProviderConfigService', () => {
  let db: ReturnType<typeof createDb>;
  let service: ProviderConfigService;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = createDb();
    service = new ProviderConfigService(db as never);
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('returns defaults when no stored config exists', async () => {
    db.query.appSettings.findFirst.mockResolvedValue(undefined);

    const config = await service.getConfig();

    expect(config).toEqual({
      google: { enabled: false, apiKey: '' },
      amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
      goodreads: { enabled: true },
      hardcover: { enabled: false, apiKey: '' },
      openLibrary: { enabled: true },
      itunes: { enabled: true, coverResolution: 'high' },
      audible: { enabled: false, domain: 'com' },
      audnexus: { enabled: false },
      comicvine: { enabled: false, apiKey: '' },
      ranobedb: { enabled: false },
    });
  });

  it('returns fresh default objects to avoid cross-request mutation leaks', async () => {
    db.query.appSettings.findFirst.mockResolvedValue(undefined);

    const first = await service.getConfig();
    first.google.enabled = false;
    first.amazon.domain = 'example.invalid';

    const second = await service.getConfig();

    expect(second.google.enabled).toBe(false);
    expect(second.amazon.domain).toBe('amazon.com');
  });

  it('merges stored partial config with defaults', async () => {
    db.query.appSettings.findFirst.mockResolvedValue({
      value: JSON.stringify({
        google: { apiKey: 'key-1' },
        hardcover: { enabled: true, apiKey: 'hardcover-key' },
        itunes: { enabled: false },
      }),
    });

    const config = await service.getConfig();

    expect(config.google).toEqual({ enabled: false, apiKey: 'key-1' });
    expect(config.amazon).toEqual({ enabled: true, domain: 'amazon.com', cookie: '' });
    expect(config.hardcover).toEqual({ enabled: true, apiKey: 'hardcover-key' });
    expect(config.itunes).toEqual({ enabled: false, coverResolution: 'high' });
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

  it('normalizes stored Google Books config to disabled when API key is missing', async () => {
    db.query.appSettings.findFirst.mockResolvedValue({
      value: JSON.stringify({
        google: { enabled: true, apiKey: '' },
      }),
    });

    const config = await service.getConfig();

    expect(config.google).toEqual({ enabled: false, apiKey: '' });
  });

  it('drops unsupported properties from stored provider sections', async () => {
    db.query.appSettings.findFirst.mockResolvedValue({
      value: JSON.stringify({
        google: { enabled: true, apiKey: 'g-key', extra: 'ignored' },
        audible: { enabled: true, domain: 'audible.com', cookie: 'legacy-cookie' },
      }),
    });

    const config = await service.getConfig();

    expect(config.google).toEqual({ enabled: true, apiKey: 'g-key' });
    expect(config.audible).toEqual({ enabled: true, domain: 'audible.com' });
    expect((config.audible as Record<string, unknown>).cookie).toBeUndefined();
  });

  it('falls back to defaults when stored JSON is invalid', async () => {
    db.query.appSettings.findFirst.mockResolvedValue({ value: '{not-json' });

    const config = await service.getConfig();

    expect(config.google.apiKey).toBe('');
    expect(config.hardcover.enabled).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[metadata_provider_config.parse] [fail] key=metadata_provider_config source=get durationMs='),
    );
  });

  it('escapes quotes in parse errors before logging', async () => {
    db.query.appSettings.findFirst.mockResolvedValue({ value: '{"google":{"enabled":true}}' });
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw new Error('bad "json" value');
    });

    await service.getConfig();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('error="bad \\"json\\" value"'));
    parseSpy.mockRestore();
  });

  it('updates config via deep merge and persists the complete object', async () => {
    db.__tx.query.appSettings.findFirst.mockResolvedValue({
      value: JSON.stringify({
        google: { enabled: true, apiKey: 'old' },
        amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
      }),
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { me: [{ username: 'reader' }] },
        }),
        { status: 200 },
      ),
    );

    const updated = await service.updateConfig({
      google: { enabled: false },
      amazon: { cookie: 'session-cookie' },
      hardcover: { enabled: true, apiKey: 'h-key' },
      itunes: { coverResolution: 'standard' },
    });

    expect(updated.google).toEqual({ enabled: false, apiKey: 'old' });
    expect(updated.amazon).toEqual({ enabled: true, domain: 'amazon.com', cookie: 'session-cookie' });
    expect(updated.hardcover).toEqual({ enabled: true, apiKey: 'h-key' });
    expect(updated.itunes).toEqual({ enabled: true, coverResolution: 'standard' });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.__tx.execute).toHaveBeenCalledTimes(1);
    expect(db.__tx.insert).toHaveBeenCalledTimes(1);
    expect(db.__txInsertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'metadata_provider_config',
        value: JSON.stringify(updated),
      }),
    );
  });

  it('normalizes enabling Google Books without an API key back to disabled', async () => {
    db.__tx.query.appSettings.findFirst.mockResolvedValue({
      value: JSON.stringify({
        google: { enabled: false, apiKey: '' },
      }),
    });

    const updated = await service.updateConfig({ google: { enabled: true } });
    expect(updated.google).toEqual({ enabled: false, apiKey: '' });
    expect(db.__tx.insert).toHaveBeenCalledTimes(1);
  });

  it('rejects enabling Hardcover without an API key', async () => {
    db.__tx.query.appSettings.findFirst.mockResolvedValue(undefined);

    await expect(service.updateConfig({ hardcover: { enabled: true } })).rejects.toThrow('Hardcover requires an API key before it can be enabled');
    expect(db.__tx.insert).not.toHaveBeenCalled();
  });

  it('rejects enabling ComicVine without an API key', async () => {
    db.__tx.query.appSettings.findFirst.mockResolvedValue(undefined);

    await expect(service.updateConfig({ comicvine: { enabled: true } })).rejects.toThrow('ComicVine requires an API key before it can be enabled');
    expect(db.__tx.insert).not.toHaveBeenCalled();
  });

  it('rejects enabling Hardcover when live token validation fails', async () => {
    db.__tx.query.appSettings.findFirst.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [{ message: 'Malformed Authorization header' }],
        }),
        { status: 200 },
      ),
    );

    await expect(service.updateConfig({ hardcover: { enabled: true, apiKey: 'invalid-token' } })).rejects.toThrow(
      'Hardcover API error: Malformed Authorization header',
    );
    expect(db.__tx.insert).not.toHaveBeenCalled();
  });

  it('rejects enabling Hardcover when the live validation request times out', async () => {
    db.__tx.query.appSettings.findFirst.mockResolvedValue(undefined);
    const timeout = new Error('aborted');
    timeout.name = 'TimeoutError';
    fetchMock.mockRejectedValue(timeout);

    await expect(service.updateConfig({ hardcover: { enabled: true, apiKey: 'token-123' } })).rejects.toThrow(
      'Hardcover validation timed out. Please try again.',
    );
    expect(db.__tx.insert).not.toHaveBeenCalled();
  });

  it('rejects enabling Hardcover when the live validation request errors', async () => {
    db.__tx.query.appSettings.findFirst.mockResolvedValue(undefined);
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(service.updateConfig({ hardcover: { enabled: true, apiKey: 'token-123' } })).rejects.toThrow(
      'Could not reach Hardcover to validate the token.',
    );
    expect(db.__tx.insert).not.toHaveBeenCalled();
  });

  it('does not revalidate unchanged enabled Hardcover credentials for unrelated updates', async () => {
    db.__tx.query.appSettings.findFirst.mockResolvedValue({
      value: JSON.stringify({
        hardcover: { enabled: true, apiKey: 'existing-token' },
        amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
      }),
    });

    const updated = await service.updateConfig({
      amazon: { cookie: 'session-cookie' },
    });

    expect(updated.hardcover).toEqual({ enabled: true, apiKey: 'existing-token' });
    expect(updated.amazon.cookie).toBe('session-cookie');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes legacy enabled Google Books config during unrelated updates', async () => {
    db.__tx.query.appSettings.findFirst.mockResolvedValue({
      value: JSON.stringify({
        google: { enabled: true, apiKey: '' },
      }),
    });

    const updated = await service.updateConfig({ amazon: { cookie: 'session-cookie' } });

    expect(updated.google).toEqual({ enabled: false, apiKey: '' });
    expect(updated.amazon.cookie).toBe('session-cookie');
  });

  it('normalizes Amazon cookie and Hardcover token formats before persisting', async () => {
    db.__tx.query.appSettings.findFirst.mockResolvedValue(undefined);

    const updated = await service.updateConfig({
      amazon: { cookie: 'Cookie: session-id=abc; ubid-main=xyz' },
      hardcover: { apiKey: 'Bearer hardcover-token' },
    });

    expect(updated.amazon.cookie).toBe('session-id=abc; ubid-main=xyz');
    expect(updated.hardcover.apiKey).toBe('hardcover-token');
  });

  it('acquires advisory lock before reading config inside update transaction', async () => {
    db.__tx.query.appSettings.findFirst.mockResolvedValue(undefined);

    const updated = await service.updateConfig({
      google: { enabled: false },
    });

    expect(updated.google.enabled).toBe(false);
    expect(db.__tx.execute.mock.invocationCallOrder[0]).toBeLessThan(db.__tx.query.appSettings.findFirst.mock.invocationCallOrder[0]);
  });

  it('falls back to defaults and logs parse failures during update', async () => {
    db.__tx.query.appSettings.findFirst.mockResolvedValue({ value: '{bad-json' });

    const updated = await service.updateConfig({
      audible: { enabled: true },
    });

    expect(updated.audible.enabled).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[metadata_provider_config.parse] [fail] key=metadata_provider_config source=update durationMs='),
    );
  });

  it('builds provider statuses including provider-specific configuration hints', async () => {
    const statuses = await service.getProviderStatuses({
      google: { enabled: true, apiKey: '' },
      amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
      goodreads: { enabled: false },
      hardcover: { enabled: true, apiKey: '' },
      openLibrary: { enabled: true },
      itunes: { enabled: true, coverResolution: 'high' },
      audible: { enabled: false, domain: 'com' },
      audnexus: { enabled: false },
      comicvine: { enabled: false, apiKey: '' },
      ranobedb: { enabled: false },
    });

    expect(statuses.map((s) => s.key)).toEqual([
      MetadataProviderKey.GOOGLE,
      MetadataProviderKey.AMAZON,
      MetadataProviderKey.GOODREADS,
      MetadataProviderKey.HARDCOVER,
      MetadataProviderKey.OPEN_LIBRARY,
      MetadataProviderKey.ITUNES,
      MetadataProviderKey.AUDIBLE,
      MetadataProviderKey.AUDNEXUS,
      MetadataProviderKey.COMICVINE,
      MetadataProviderKey.RANOBEDB,
    ]);
    expect(statuses.find((s) => s.key === MetadataProviderKey.GOOGLE)?.configured).toBe(false);
    expect(statuses.find((s) => s.key === MetadataProviderKey.GOOGLE)?.hint).toContain('API key required');
    expect(statuses.find((s) => s.key === MetadataProviderKey.AMAZON)?.hint).toContain('Cookie recommended');
    expect(statuses.find((s) => s.key === MetadataProviderKey.HARDCOVER)?.configured).toBe(false);
    expect(statuses.find((s) => s.key === MetadataProviderKey.HARDCOVER)?.hint).toContain('Run Test');
    expect(statuses.find((s) => s.key === MetadataProviderKey.COMICVINE)?.configured).toBe(false);
    expect(statuses.find((s) => s.key === MetadataProviderKey.COMICVINE)?.hint).toContain('API key required');
    expect(statuses.find((s) => s.key === MetadataProviderKey.GOODREADS)?.enabled).toBe(false);
  });

  it('reports hardcover as configured when api key is present', async () => {
    const statuses = await service.getProviderStatuses({
      google: { enabled: true, apiKey: 'g' },
      amazon: { enabled: true, domain: 'amazon.com', cookie: 'c' },
      goodreads: { enabled: true },
      hardcover: { enabled: true, apiKey: 'h-key' },
      openLibrary: { enabled: true },
      itunes: { enabled: true, coverResolution: 'high' },
      audible: { enabled: false, domain: 'com' },
      audnexus: { enabled: false },
      comicvine: { enabled: false, apiKey: '' },
      ranobedb: { enabled: false },
    });

    expect(statuses.find((s) => s.key === MetadataProviderKey.HARDCOVER)?.configured).toBe(true);
    expect(statuses.find((s) => s.key === MetadataProviderKey.GOOGLE)?.hint).toBeUndefined();
    expect(statuses.find((s) => s.key === MetadataProviderKey.AMAZON)?.hint).toBeUndefined();
  });

  it('tests Hardcover provider using bearer-stripped token from patch config', async () => {
    db.query.appSettings.findFirst.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { me: [{ username: 'reader' }] },
        }),
        { status: 200 },
      ),
    );

    const result = await service.testProvider(MetadataProviderKey.HARDCOVER, {
      hardcover: { apiKey: 'Bearer token-123' },
    });

    expect(result).toEqual({
      key: MetadataProviderKey.HARDCOVER,
      ok: true,
      status: 'success',
      message: 'Connected as reader.',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.hardcover.app/v1/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      }),
    );
  });

  it('tests Hardcover provider with quoted bearer token input', async () => {
    db.query.appSettings.findFirst.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { me: [{ username: 'reader' }] },
        }),
        { status: 200 },
      ),
    );

    await service.testProvider(MetadataProviderKey.HARDCOVER, {
      hardcover: { apiKey: '"Bearer token-123"' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.hardcover.app/v1/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      }),
    );
  });

  it('returns warning for Amazon bot-check responses', async () => {
    db.query.appSettings.findFirst.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(
      new Response('<html><title>Robot Check</title>Sorry, we just need to make sure you are not a robot.</html>', {
        status: 200,
      }),
    );

    const result = await service.testProvider(MetadataProviderKey.AMAZON, {
      amazon: { cookie: 'Cookie: x-main=abc' },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('warning');
    expect(result.message).toContain('bot-check');
  });

  it('rejects unsupported provider test requests', async () => {
    await expect(service.testProvider(MetadataProviderKey.GOODREADS, {})).rejects.toThrow('Provider test not supported');
  });
});
