import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DEFAULT_INDEXER_CATEGORIES, INDEXER_COLORS } from '@bookorbit/types';

import type { RequestIndexerRow } from '../../../db/schema';
import { IndexerConfigService } from './indexer-config.service';

function indexerRow(overrides: Partial<RequestIndexerRow> = {}): RequestIndexerRow {
  return {
    id: 9,
    name: 'jackett',
    adapterType: 'torznab',
    enabled: true,
    // TEST-NET-3 literal: no DNS lookup in tests, and not a private address.
    baseUrl: 'http://203.0.113.10:9117',
    credentialsEnc: 'cipher',
    allowPrivateAddress: false,
    categories: null,
    settings: null,
    lastTestedAt: null,
    lastTestOk: null,
    lastErrorMessage: null,
    createdAt: new Date('2026-08-18T00:00:00Z'),
    updatedAt: new Date('2026-08-18T00:00:00Z'),
    ...overrides,
  };
}

function makeService(
  overrides: {
    repo?: Record<string, unknown>;
    credentials?: Record<string, unknown>;
    adapter?: Record<string, unknown>;
    registry?: Record<string, unknown>;
  } = {},
) {
  const repo = {
    findAll: vi.fn().mockResolvedValue([indexerRow()]),
    findAssignedColors: vi.fn().mockResolvedValue([null]),
    findById: vi.fn().mockResolvedValue(indexerRow()),
    findAllEnabled: vi.fn().mockResolvedValue([indexerRow()]),
    create: vi.fn().mockResolvedValue(indexerRow()),
    update: vi.fn().mockResolvedValue(indexerRow()),
    delete: vi.fn().mockResolvedValue(undefined),
    recordTestResult: vi.fn().mockResolvedValue(undefined),
    ...overrides.repo,
  };
  const credentials = {
    encrypt: vi.fn().mockReturnValue('cipher'),
    decrypt: vi.fn().mockReturnValue('api-key'),
    isConfigured: vi.fn().mockReturnValue(true),
    ...overrides.credentials,
  };
  const adapter = {
    label: 'Torznab',
    requiresCredential: false,
    test: vi.fn().mockResolvedValue({ success: true, indexerName: 'Jackett' }),
    forget: vi.fn(),
    ...overrides.adapter,
  };
  const registry = {
    require: vi.fn().mockReturnValue(adapter),
    find: vi.fn().mockReturnValue(adapter),
    defaultCategories: vi.fn().mockReturnValue(DEFAULT_INDEXER_CATEGORIES.torznab),
    ...overrides.registry,
  };
  return {
    service: new IndexerConfigService(repo as never, credentials as never, registry as never),
    repo,
    credentials,
    registry,
    adapter,
  };
}

const createDto = { name: 'jackett', adapterType: 'torznab' as const, baseUrl: 'http://203.0.113.10:9117' };

describe('IndexerConfigService', () => {
  it('never returns the stored credential, only whether there is one', async () => {
    const { service } = makeService();

    const { indexers } = await service.findAll();

    expect(indexers[0].hasCredential).toBe(true);
    expect(JSON.stringify(indexers[0])).not.toContain('cipher');
  });

  it('encrypts a credential rather than storing it in the clear', async () => {
    const { service, credentials, repo } = makeService();

    await service.create({ ...createDto, credential: 'api-key' });

    expect(credentials.encrypt).toHaveBeenCalledWith('api-key');
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ credentialsEnc: 'cipher' }));
  });

  it('assigns a random unused color when a new indexer does not name one', async () => {
    const existing = INDEXER_COLORS.filter((color) => color !== 'teal');
    const { service, repo } = makeService({ repo: { findAssignedColors: vi.fn().mockResolvedValue(existing) } });

    await service.create(createDto);

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ color: 'teal' }));
  });

  it('preserves an explicit no-color choice on a new indexer', async () => {
    const { service, repo } = makeService();

    await service.create({ ...createDto, color: null });

    expect(repo.findAssignedColors).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ color: null }));
  });

  /** The refusal is the point: a tracker key in the clear is worse than a form that will not save. */
  it('lets the refusal to encrypt without a key surface instead of saving plaintext', async () => {
    const { service, repo } = makeService({
      credentials: {
        encrypt: vi.fn(() => {
          throw new BadRequestException({ message: 'no key', errorCode: 'REQUEST_ENCRYPTION_KEY_MISSING' });
        }),
      },
    });

    await expect(service.create({ ...createDto, credential: 'api-key' })).rejects.toThrow(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  /**
   * Unlike a download client this defaults to off: a public tracker has no business resolving to a
   * private address, and a self-hosted torznab proxy is the one case worth opting into.
   */
  it('refuses a private address unless the row opts in', async () => {
    const { service, repo } = makeService();

    await expect(service.create({ ...createDto, baseUrl: 'http://192.168.1.10:9117' })).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'INDEXER_URL_PRIVATE' }),
    });
    expect(repo.create).not.toHaveBeenCalled();

    await expect(service.create({ ...createDto, baseUrl: 'http://192.168.1.10:9117', allowPrivateAddress: true })).resolves.toBeDefined();
  });

  it('keeps the stored credential when the form omits one', async () => {
    const { service, repo } = makeService();

    await service.update(9, { enabled: false });

    expect(repo.update).toHaveBeenCalledWith(9, { enabled: false });
  });

  it('clears the credential when the form sends an empty one', async () => {
    const { service, repo } = makeService();

    await service.update(9, { credential: '' });

    expect(repo.update).toHaveBeenCalledWith(9, { credentialsEnc: null });
  });

  /**
   * A rotated or unset `BOOK_REQUEST_ENCRYPTION_KEY` leaves stored credentials unreadable. One such
   * row used to abort the whole resolve, so a search fanned out over nothing and the picker showed
   * an error with no sources in it.
   */
  it('carries the refusal on the row rather than abandoning every other enabled source', async () => {
    const { service, credentials } = makeService({
      repo: { findAllEnabled: vi.fn().mockResolvedValue([indexerRow({ id: 1 }), indexerRow({ id: 2, credentialsEnc: null })]) },
    });
    credentials.decrypt.mockImplementation(() => {
      throw new BadRequestException('Stored credentials could not be decrypted');
    });

    const configs = await service.resolveEnabledConfigs();

    expect(configs).toHaveLength(2);
    expect(configs[0]).toMatchObject({ id: 1, credential: null, credentialError: expect.stringContaining('could not be decrypted') });
    // A source holding no credential never touched the key, so it is unaffected.
    expect(configs[1]).toMatchObject({ id: 2, credential: null, credentialError: null });
  });

  /** The single-indexer resolve is about that one indexer, so its caller wants the refusal thrown. */
  it('still throws when a single indexer is resolved by id', async () => {
    const { service, credentials } = makeService();
    credentials.decrypt.mockImplementation(() => {
      throw new BadRequestException('Stored credentials could not be decrypted');
    });

    await expect(service.resolveConfig(9)).rejects.toThrow(BadRequestException);
  });

  /** A cached session outliving its config would keep talking to the old host with the old key. */
  it('drops the adapter session when the connection details change', async () => {
    const { service, adapter } = makeService();

    await service.update(9, { baseUrl: 'http://203.0.113.11:9117' });
    expect(adapter.forget).toHaveBeenCalledWith(9);

    adapter.forget.mockClear();
    await service.update(9, { enabled: false });
    expect(adapter.forget).not.toHaveBeenCalled();
  });

  it('falls back to the adapter default categories for a medium left blank', async () => {
    const { service, repo } = makeService();

    await service.create({ ...createDto, categories: { ebook: [8010] } });

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ categories: { ebook: [8010], audiobook: [3030], comic: [7030] } }));
  });

  /** A key for one tracker is not a key for another, and its settings are the old adapter's. */
  it('drops the stored credential and settings when the adapter type changes', async () => {
    const { service, repo } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(indexerRow({ adapterType: 'torznab', credentialsEnc: 'cipher', settings: { seedTime: 4 } })) },
    });

    await service.update(1, { adapterType: 'newznab' as never });

    expect(repo.update).toHaveBeenCalledWith(1, expect.objectContaining({ credentialsEnc: null, settings: null }));
  });

  it('does not carry an overlapping setting key into a different adapter', async () => {
    const { service, repo } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(indexerRow({ adapterType: 'old-plugin', settings: { minSeeders: 4 } })) },
      registry: {
        require: vi.fn().mockReturnValue({ settingsFields: [{ key: 'minSeeders', label: 'Minimum seeders', type: 'number' }] }),
      },
    });

    await service.update(1, { adapterType: 'new-plugin' as never });

    expect(repo.update).toHaveBeenCalledWith(1, expect.objectContaining({ settings: null }));
  });

  it('keeps the stored credential when the adapter type is unchanged', async () => {
    const { service, repo } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(indexerRow({ adapterType: 'torznab', credentialsEnc: 'cipher' })) },
    });

    await service.update(1, { name: 'renamed' });

    expect(repo.update).toHaveBeenCalledWith(1, { name: 'renamed' });
  });

  /** A plugin declares its own; the compile-time map only knows the built-ins. */
  it('falls back to a plugin adapter default categories rather than to nothing', async () => {
    const { service, repo } = makeService({
      registry: { defaultCategories: vi.fn().mockReturnValue({ ebook: [4040], audiobook: [4050], comic: [] }) },
    });

    await service.create({ ...createDto, adapterType: 'librivox' as never, categories: undefined });

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ categories: { ebook: [4040], audiobook: [4050], comic: [] } }));
  });

  it('reports a duplicate name as a conflict rather than a 500', async () => {
    const { service } = makeService({
      repo: { create: vi.fn().mockRejectedValue(new Error('Failed query', { cause: Object.assign(new Error('dupe'), { code: '23505' }) })) },
    });

    await expect(service.create(createDto)).rejects.toThrow(ConflictException);
  });

  it('404s an indexer that does not exist', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(undefined) } });

    await expect(service.findOne(9)).rejects.toThrow(NotFoundException);
  });

  it('refuses a source-only delete for a plugin-backed indexer', async () => {
    const { service, repo } = makeService({ repo: { findById: vi.fn().mockResolvedValue(indexerRow({ adapterType: 'demo-tracker' })) } });

    await expect(service.remove(9)).rejects.toThrow(/deleted with its plugin/i);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  /**
   * An indexer that needs a key rejects every search without one, and doing so as a per-indexer
   * failure in the picker hides it from the one person who could fix it.
   */
  it('refuses to save an adapter that cannot work without a credential', async () => {
    const { service, repo } = makeService({ adapter: { label: 'Torznab', requiresCredential: true } });

    await expect(service.create({ ...createDto, adapterType: 'torznab' })).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'INDEXER_CREDENTIAL_REQUIRED' }),
    });
    expect(repo.create).not.toHaveBeenCalled();

    await expect(service.create({ ...createDto, adapterType: 'torznab', credential: 'an-api-key' })).resolves.toBeDefined();
  });

  /** Editing an unrelated field must not trip the rule on a row that already holds a session. */
  it('counts the stored credential when the form omits one', async () => {
    const { service, repo } = makeService({ adapter: { label: 'Torznab', requiresCredential: true } });

    await expect(service.update(9, { enabled: false })).resolves.toBeDefined();
    expect(repo.update).toHaveBeenCalledWith(9, { enabled: false });

    await expect(service.update(9, { credential: '' })).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'INDEXER_CREDENTIAL_REQUIRED' }),
    });
  });

  it('stamps the row with the test outcome so the settings card can show it', async () => {
    const { service, repo } = makeService();

    await expect(service.test(9)).resolves.toMatchObject({ success: true });
    expect(repo.recordTestResult).toHaveBeenCalledWith(9, true, null);
  });

  it('keeps bounded plugin strings large enough for challenge cookies', async () => {
    const { service, repo } = makeService({
      adapter: { settingsFields: [{ key: 'challengeCookies', type: 'string', label: 'Challenge cookies' }] },
    });
    const challengeCookies = 'x'.repeat(2_048);

    await service.create({ ...createDto, settings: { challengeCookies } });

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ settings: { challengeCookies } }));
  });

  it('drops plugin strings above the bounded setting limit', async () => {
    const { service, repo } = makeService({
      adapter: { settingsFields: [{ key: 'challengeCookies', type: 'string', label: 'Challenge cookies' }] },
    });

    await service.create({ ...createDto, settings: { challengeCookies: 'x'.repeat(2_049) } });

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ settings: null }));
  });

  it('canonicalizes a constrained plugin list before storing it', async () => {
    const { service, repo } = makeService({
      adapter: {
        settingsFields: [
          {
            key: 'ebookFormats',
            type: 'string',
            format: 'list',
            label: 'Ebook formats',
            options: ['epub', 'mobi', 'pdf'],
            minItems: 1,
          },
        ],
      },
    });

    await service.create({ ...createDto, settings: { ebookFormats: ' EPUB, mobi,epub ' } });

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ settings: { ebookFormats: 'epub,mobi' } }));
  });

  it.each(['epubdsdsd', ''])('refuses an unusable constrained plugin list: %s', async (ebookFormats) => {
    const { service, repo } = makeService({
      adapter: {
        settingsFields: [
          {
            key: 'ebookFormats',
            type: 'string',
            format: 'list',
            label: 'Ebook formats',
            options: ['epub', 'mobi', 'pdf'],
            minItems: 1,
          },
        ],
      },
    });

    await expect(service.create({ ...createDto, settings: { ebookFormats } })).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'INDEXER_SETTINGS_INVALID' }),
    });
    expect(repo.create).not.toHaveBeenCalled();
  });
});
