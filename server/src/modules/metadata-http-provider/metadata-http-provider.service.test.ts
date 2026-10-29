import { BadRequestException, ConflictException } from '@nestjs/common';

import type { MetadataHttpProviderRow } from '../../db/schema';
import { HttpProviderError, type HttpProviderClient } from './http-provider.client';
import { MetadataHttpProviderCatalog } from './metadata-http-provider.catalog';
import type { MetadataHttpProviderRepository } from './metadata-http-provider.repository';
import type { MetadataHttpProviderSecrets } from './metadata-http-provider-secrets.service';
import { MetadataHttpProviderService } from './metadata-http-provider.service';

const INFO = { name: 'FantLab', key: 'fantlab', version: '0.1.0', lookup: true };

function setup() {
  let rows: MetadataHttpProviderRow[] = [];
  let nextId = 1;
  const repository = {
    findAll: vi.fn(() => Promise.resolve(rows)),
    findById: vi.fn((id: number) => Promise.resolve(rows.find((row) => row.id === id) ?? null)),
    findByKey: vi.fn((key: string) => Promise.resolve(rows.find((row) => row.key === key) ?? null)),
    insert: vi.fn((row: Partial<MetadataHttpProviderRow>) => {
      const created = { id: nextId++, createdAt: new Date(), updatedAt: new Date(), lastError: null, ...row } as MetadataHttpProviderRow;
      rows.push(created);
      return Promise.resolve(created);
    }),
    update: vi.fn((id: number, patch: Partial<MetadataHttpProviderRow>) => {
      rows = rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
      return Promise.resolve(rows.find((row) => row.id === id) ?? null);
    }),
    updateIfConnectionUnchanged: vi.fn((read: MetadataHttpProviderRow, patch: Partial<MetadataHttpProviderRow>) => {
      const current = rows.find((row) => row.id === read.id);
      if (!current || current.baseUrl !== read.baseUrl || current.authorizationEnc !== read.authorizationEnc) return Promise.resolve(false);
      rows = rows.map((row) => (row.id === read.id ? { ...row, ...patch } : row));
      return Promise.resolve(true);
    }),
    delete: vi.fn((id: number, purgeKey: string | null) => {
      rows = rows.filter((row) => row.id !== id);
      icons.delete(id);
      return Promise.resolve(purgeKey ? { providerIds: 3, ratings: 2, cacheEntries: 1 } : null);
    }),
    findIconVersions: vi.fn(() => Promise.resolve(new Map([...icons].map(([id, icon]) => [id, { hash: icon.hash, sourceUrl: icon.sourceUrl }])))),
    saveIcon: vi.fn((id: number, icon: { sourceUrl: string; contentType: string; hash: string; data: Buffer }) => {
      icons.set(id, icon);
      return Promise.resolve();
    }),
    deleteIcon: vi.fn((id: number) => {
      icons.delete(id);
      return Promise.resolve();
    }),
  };
  const icons = new Map<number, { sourceUrl: string; contentType: string; hash: string; data: Buffer }>();
  const client = {
    getInfo: vi.fn().mockResolvedValue(INFO),
    search: vi.fn(),
    forget: vi.fn(),
    getIcon: vi.fn().mockResolvedValue({ data: Buffer.from('png-bytes'), contentType: 'image/png' }),
  };
  const secrets = { encrypt: vi.fn((value: string) => `enc(${value})`), decrypt: vi.fn((value: string) => value.slice(4, -1)) };
  const catalog = new MetadataHttpProviderCatalog();
  const service = new MetadataHttpProviderService(
    repository as unknown as MetadataHttpProviderRepository,
    client as unknown as HttpProviderClient,
    catalog,
    secrets as unknown as MetadataHttpProviderSecrets,
  );
  /** Another request changing a row while one is in flight. */
  const edit = (id: number, patch: Partial<MetadataHttpProviderRow>) => {
    rows = rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
  };
  return { service, repository, client, secrets, catalog, rows: () => rows, edit, icons };
}

const NOT_FOUND = new HttpProviderError('failed', 'provider answered 404', 404);

describe('MetadataHttpProviderService', () => {
  it('registers a provider disabled, under the key it reports, with the header encrypted', async () => {
    const { service, client, catalog, rows } = setup();

    const view = await service.create({ baseUrl: 'http://fantlab:8080', authorization: 'Bearer x', allowPrivateAddress: true }, 4);

    expect(client.getInfo).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://fantlab:8080/', authorization: 'Bearer x', allowPrivateAddress: true }),
    );
    expect(view).toMatchObject({ key: 'fantlab', enabled: false, hasAuthorization: true, status: 'ok', baseUrl: 'http://fantlab:8080/' });
    expect(view).not.toHaveProperty('authorization');
    expect(rows()[0]).toMatchObject({ authorizationEnc: 'enc(Bearer x)', createdBy: 4 });
    expect(catalog.registered().map((p) => p.key)).toEqual(['fantlab']);
    expect(catalog.active()).toEqual([]);
    // The limiter used to reach an address under trial is dropped with it.
    expect(client.forget).toHaveBeenCalledWith('new:http://fantlab:8080/');
  });

  it('answers a lost registration race with the same conflict as a known key', async () => {
    const { service, repository } = setup();
    repository.insert.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { cause: { code: '23505' } }));

    await expect(service.create({ baseUrl: 'http://fantlab/' }, null)).rejects.toMatchObject({
      response: { errorCode: 'METADATA_PROVIDER_KEY_TAKEN' },
    });
  });

  it('refuses a second provider with the same key, a built-in key, credentials in the URL, and unusable info', async () => {
    const { service, client } = setup();
    await service.create({ baseUrl: 'http://a/' }, null);
    await expect(service.create({ baseUrl: 'http://b/' }, null)).rejects.toBeInstanceOf(ConflictException);

    client.getInfo.mockResolvedValue({ name: 'Goodreads', key: 'goodreads' });
    await expect(service.create({ baseUrl: 'http://c/' }, null)).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.create({ baseUrl: 'http://user:pw@d/' }, null)).rejects.toMatchObject({
      response: { errorCode: 'METADATA_PROVIDER_INVALID_URL' },
    });

    client.getInfo.mockRejectedValue(new HttpProviderError('failed', 'provider response is not JSON'));
    await expect(service.create({ baseUrl: 'http://e/' }, null)).rejects.toMatchObject({ response: { errorCode: 'METADATA_PROVIDER_INVALID_INFO' } });
  });

  it('registers a source that moved out under its old key, only when its ids fit the column it kept', async () => {
    const { service, client, catalog } = setup();

    client.getInfo.mockResolvedValue({ name: 'Aladin', key: 'aladin' });
    await expect(service.create({ baseUrl: 'http://wide/' }, null)).rejects.toBeInstanceOf(BadRequestException);

    client.getInfo.mockResolvedValue({ name: 'Aladin', key: 'aladin', idMaxLength: 20 });
    await service.create({ baseUrl: 'http://aladin/' }, null);
    expect(catalog.registered().map((p) => p.key)).toEqual(['aladin']);
  });

  it('puts an enabled provider into the active catalog with its decrypted header', async () => {
    const { service, catalog } = setup();
    const { id } = await service.create({ baseUrl: 'http://fantlab/', authorization: 'Bearer x' }, null);

    await service.update(id, { enabled: true });

    expect(catalog.active()).toEqual([expect.objectContaining({ key: 'fantlab', target: expect.objectContaining({ authorization: 'Bearer x' }) })]);
  });

  it('refuses to move a registration to an address that serves another provider', async () => {
    const { service, client } = setup();
    const { id } = await service.create({ baseUrl: 'http://fantlab/' }, null);
    client.getInfo.mockResolvedValue({ name: 'Libris', key: 'libris' });

    await expect(service.update(id, { baseUrl: 'http://libris/' })).rejects.toMatchObject({
      response: { errorCode: 'METADATA_PROVIDER_KEY_CHANGED' },
    });
  });

  it('keeps serving through a failed refresh, then drops out after three, then comes back', async () => {
    const { service, client, catalog, rows } = setup();
    const { id } = await service.create({ baseUrl: 'http://fantlab/' }, null);
    await service.update(id, { enabled: true });

    client.getInfo.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await service.refreshAll();
    expect(rows()[0]).toMatchObject({ status: 'stale', consecutiveFailures: 1 });
    expect(catalog.active()).toHaveLength(1);

    await service.refreshAll();
    await service.refreshAll();
    expect(rows()[0]).toMatchObject({ status: 'unreachable', consecutiveFailures: 3 });
    expect(catalog.active()).toEqual([]);

    client.getInfo.mockResolvedValue(INFO);
    await service.refreshAll();
    expect(rows()[0]).toMatchObject({ status: 'ok', consecutiveFailures: 0 });
    expect(catalog.active()).toHaveLength(1);
  });

  it('takes a provider that changed its key out of searches', async () => {
    const { service, client, catalog, rows } = setup();
    const { id } = await service.create({ baseUrl: 'http://fantlab/' }, null);
    await service.update(id, { enabled: true });
    client.getInfo.mockResolvedValue({ ...INFO, key: 'fantlab-ru' });

    await service.refreshAll();

    expect(rows()[0].status).toBe('key_changed');
    expect(catalog.active()).toEqual([]);
    await expect(service.update(id, { enabled: true })).rejects.toMatchObject({ response: { errorCode: 'METADATA_PROVIDER_NOT_READY' } });
  });

  it('keeps stored data on removal unless asked to purge it, in the same step as the removal', async () => {
    const { service, repository } = setup();
    const first = await service.create({ baseUrl: 'http://fantlab/' }, null);
    await expect(service.remove(first.id, false)).resolves.toEqual({ purged: null });
    expect(repository.delete).toHaveBeenLastCalledWith(first.id, null);

    const second = await service.create({ baseUrl: 'http://fantlab/' }, null);
    await expect(service.remove(second.id, true)).resolves.toEqual({ purged: { providerIds: 3, ratings: 2, cacheEntries: 1 } });
    expect(repository.delete).toHaveBeenLastCalledWith(second.id, 'fantlab');
  });

  it('accepts providers from before /provider/info, named after their address and search-only', async () => {
    const { service, client } = setup();
    client.getInfo.mockRejectedValue(NOT_FOUND);
    client.search.mockResolvedValue({ matches: [] });

    const first = await service.create({ baseUrl: 'http://pack:3000/a/' }, null);
    const second = await service.create({ baseUrl: 'http://pack:3000/b/' }, null);

    expect(first).toMatchObject({ key: 'pack-3000-a', info: { name: 'pack:3000/a', specVersion: '0', lookup: false } });
    expect(second.key).toBe('pack-3000-b');
  });

  it('refuses an address that answers neither /provider/info nor /search', async () => {
    const { service, client, rows } = setup();
    client.getInfo.mockRejectedValue(NOT_FOUND);
    client.search.mockRejectedValue(NOT_FOUND);

    await expect(service.create({ baseUrl: 'http://fantlab:8080/api/' }, null)).rejects.toMatchObject({
      response: { errorCode: 'METADATA_PROVIDER_INVALID_INFO' },
    });
    client.search.mockResolvedValue({ results: [] });
    await expect(service.create({ baseUrl: 'http://fantlab:8080/api/' }, null)).rejects.toMatchObject({
      response: { errorCode: 'METADATA_PROVIDER_INVALID_INFO' },
    });
    expect(rows()).toEqual([]);
  });

  it('keeps the key of a provider without /provider/info when its address changes', async () => {
    const { service, client, catalog, rows } = setup();
    client.getInfo.mockRejectedValue(NOT_FOUND);
    client.search.mockResolvedValue({ matches: [] });
    const { id } = await service.create({ baseUrl: 'http://pack:3000/a/' }, null);

    const moved = await service.update(id, { baseUrl: 'http://pack:3001/a/', enabled: true });
    expect(moved).toMatchObject({ key: 'pack-3000-a', baseUrl: 'http://pack:3001/a/', info: { name: 'pack:3001/a' } });

    await service.refreshAll();
    expect(rows()[0]).toMatchObject({ status: 'ok', key: 'pack-3000-a' });
    expect(catalog.active().map((provider) => provider.key)).toEqual(['pack-3000-a']);
  });

  it('flags a provider whose saved header no longer decrypts, keeps it out of searches and will not enable it', async () => {
    const { service, secrets, catalog } = setup();
    const { id } = await service.create({ baseUrl: 'http://fantlab/', authorization: 'Bearer x' }, null);
    await service.update(id, { enabled: true });
    expect(catalog.active()).toHaveLength(1);

    // BOOK_REQUEST_ENCRYPTION_KEY changed and the server restarted.
    secrets.decrypt.mockReturnValue(null as unknown as string);
    await service.onModuleInit();

    expect(catalog.active()).toEqual([]);
    expect(catalog.registered()[0]).toMatchObject({ enabled: true, authorizationUnreadable: true });
    expect((await service.list())[0]).toMatchObject({ authorizationUnreadable: true });
    await expect(service.update(id, { enabled: false })).resolves.toMatchObject({ enabled: false });
    await expect(service.update(id, { enabled: true })).rejects.toMatchObject({
      response: { errorCode: 'METADATA_PROVIDER_AUTHORIZATION_UNREADABLE' },
    });
    await expect(service.test(id)).resolves.toMatchObject({ ok: false });

    // Entering the header again is the way back.
    secrets.decrypt.mockImplementation((value: string) => value.slice(4, -1));
    await expect(service.update(id, { authorization: 'Bearer y', enabled: true })).resolves.toMatchObject({ enabled: true });
    expect(catalog.active()).toHaveLength(1);
  });

  it('drops a refresh outcome for an address the admin changed while it was being checked', async () => {
    const { service, client, rows, edit } = setup();
    const { id } = await service.create({ baseUrl: 'http://fantlab/' }, null);
    await service.update(id, { enabled: true });

    client.getInfo.mockImplementationOnce(() => {
      edit(id, { baseUrl: 'http://fantlab-new/' });
      return Promise.reject(new Error('connect ECONNREFUSED'));
    });
    await service.refreshAll();

    expect(rows()[0]).toMatchObject({ baseUrl: 'http://fantlab-new/', status: 'ok', consecutiveFailures: 0 });
  });

  it('labels providers that share a name, or a built-in name, so they can be told apart', async () => {
    const { service, client, catalog } = setup();
    client.getInfo.mockResolvedValueOnce({ name: 'FantLab', key: 'fantlab' });
    await service.create({ baseUrl: 'http://fantlab:8080/' }, null);
    client.getInfo.mockResolvedValueOnce({ name: 'FantLab', key: 'fantlab-mirror' });
    await service.create({ baseUrl: 'http://mirror.example/' }, null);
    client.getInfo.mockResolvedValueOnce({ name: 'Goodreads', key: 'goodreads-mirror' });
    await service.create({ baseUrl: 'http://gr.example/' }, null);

    expect(Object.fromEntries(catalog.registered().map((provider) => [provider.key, provider.label]))).toEqual({
      fantlab: 'FantLab (fantlab:8080)',
      'fantlab-mirror': 'FantLab (mirror.example)',
      'goodreads-mirror': 'Goodreads (gr.example)',
    });
  });

  it("keeps its own copy of the provider's icon and colour, and shows them everywhere the provider is listed", async () => {
    const { service, client, catalog, icons, repository } = setup();
    client.getInfo.mockResolvedValue({ ...INFO, avatarUrl: 'https://fantlab.ru/favicon.ico', color: '#8B1E1E' });

    const view = await service.create({ baseUrl: 'http://fantlab/' }, null);

    expect(client.getIcon).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'http://fantlab/' }), 'https://fantlab.ru/favicon.ico');
    expect(icons.get(view.id)).toMatchObject({ sourceUrl: 'https://fantlab.ru/favicon.ico', contentType: 'image/png' });
    const hash = icons.get(view.id)!.hash;
    expect(view.iconUrl).toBe(`/api/v1/metadata-providers/fantlab/icon?v=${hash}`);
    expect(view.info?.color).toBe('#8b1e1e');
    expect(catalog.registered()[0]).toMatchObject({ iconUrl: view.iconUrl, color: '#8b1e1e' });

    // The same image again is not written again.
    await service.test(view.id);
    expect(repository.saveIcon).toHaveBeenCalledTimes(1);

    // An icon that cannot be fetched now keeps the one BookOrbit has.
    client.getIcon.mockRejectedValueOnce(new HttpProviderError('failed', 'icon answered 503', 503));
    await service.test(view.id);
    expect(icons.has(view.id)).toBe(true);

    // A provider that stops declaring one loses it.
    client.getInfo.mockResolvedValue(INFO);
    await service.test(view.id);
    expect(icons.has(view.id)).toBe(false);
    expect(catalog.registered()[0]).toMatchObject({ iconUrl: null, color: null });
  });

  it('registers a provider whose icon cannot be fetched, without one', async () => {
    const { service, client } = setup();
    client.getInfo.mockResolvedValue({ ...INFO, avatarUrl: 'https://fantlab.ru/logo.svg' });
    client.getIcon.mockRejectedValue(new HttpProviderError('failed', 'icon is not a PNG, WebP, JPEG, GIF or ICO image'));

    await expect(service.create({ baseUrl: 'http://fantlab/' }, null)).resolves.toMatchObject({ key: 'fantlab', iconUrl: null });
  });

  it('tests a provider with a real search and reports what came back', async () => {
    const { service, client } = setup();
    const { id } = await service.create({ baseUrl: 'http://fantlab/' }, null);
    client.search.mockResolvedValue({ matches: [{ title: 'Солярис' }, { title: 'Эдем' }] });

    const result = await service.test(id, 'Солярис');

    expect(result).toMatchObject({ ok: true, name: 'FantLab', version: '0.1.0', resultCount: 2, sampleTitle: 'Солярис', error: null });
    expect(Object.fromEntries(client.search.mock.calls[0][1])).toEqual({ query: 'Солярис', mediaType: 'book' });
  });
});
