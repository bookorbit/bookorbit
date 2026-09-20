import { BadGatewayException, BadRequestException } from '@nestjs/common';

import type { RequestIndexerManagerRow } from '../../../db/schema';
import { IndexerManagerService } from './indexer-manager.service';

function managerRow(overrides: Partial<RequestIndexerManagerRow> = {}): RequestIndexerManagerRow {
  return {
    id: 3,
    name: 'Prowlarr',
    color: null,
    type: 'prowlarr',
    enabled: true,
    baseUrl: 'http://127.0.0.1:9696',
    credentialsEnc: 'ciphertext',
    allowPrivateAddress: true,
    syncNewIndexers: true,
    perIndexerTimeoutSeconds: 20,
    overallSearchBudgetSeconds: 60,
    autoExpandCategories: false,
    inheritSeedLimits: true,
    networkProfile: null,
    version: null,
    lastTestedAt: null,
    lastTestOk: null,
    lastErrorMessage: null,
    lastSyncedAt: null,
    lastSyncOk: null,
    lastSyncError: null,
    createdAt: new Date('2026-09-15T00:00:00Z'),
    updatedAt: new Date('2026-09-15T00:00:00Z'),
    ...overrides,
  };
}

function makeService() {
  let current = managerRow();
  const repo = {
    findAll: vi.fn(() => Promise.resolve([{ manager: current, sources: [] }])),
    findById: vi.fn(() => Promise.resolve({ manager: current, sources: [] })),
    create: vi.fn((data: Partial<RequestIndexerManagerRow>) => {
      current = managerRow(data);
      return Promise.resolve(current);
    }),
    update: vi.fn((_id: number, data: Partial<RequestIndexerManagerRow>) => {
      current = managerRow({ ...current, ...data });
      return Promise.resolve(current);
    }),
    delete: vi.fn(() => Promise.resolve()),
    setSourcesAvailable: vi.fn(() => Promise.resolve()),
    updateSource: vi.fn(() => Promise.resolve({ id: 10 })),
    recordTestResult: vi.fn(() => Promise.resolve()),
    recordSyncFailure: vi.fn(() => Promise.resolve()),
    syncProwlarrSources: vi.fn(() => Promise.resolve({ created: 1, updated: 0, unavailable: 0 })),
  };
  const credentials = {
    encrypt: vi.fn(() => 'ciphertext'),
    decrypt: vi.fn(() => 'secret-key'),
    isConfigured: vi.fn(() => true),
  };
  const prowlarr = {
    status: vi.fn(() => Promise.resolve({ version: '1.2.3' })),
    indexers: vi.fn(() =>
      Promise.resolve([
        {
          id: 7,
          name: 'Books',
          implementation: 'Cardigann',
          protocol: 'torrent' as const,
          enabled: true,
          priority: 5,
          seedRatioGoal: 2,
          seedTimeMinutes: 120,
        },
      ]),
    ),
  };
  return { service: new IndexerManagerService(repo as never, credentials as never, prowlarr as never), repo, credentials, prowlarr };
}

describe('IndexerManagerService', () => {
  it('encrypts the API key, synchronizes children, and never returns the secret', async () => {
    const { service, repo, credentials } = makeService();

    const result = await service.create({
      name: 'Prowlarr',
      type: 'prowlarr',
      baseUrl: 'http://127.0.0.1:9696',
      credential: 'secret-key',
      allowPrivateAddress: true,
    });

    expect(credentials.encrypt).toHaveBeenCalledWith('secret-key');
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ credentialsEnc: 'ciphertext' }));
    expect(repo.syncProwlarrSources).toHaveBeenCalledOnce();
    expect(result.hasCredential).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret-key');
    expect(JSON.stringify(result)).not.toContain('ciphertext');
  });

  it('records test health and returns source count and version', async () => {
    const { service, repo } = makeService();

    await expect(service.test(3)).resolves.toEqual({ success: true, version: '1.2.3', sourceCount: 1 });
    expect(repo.recordTestResult).toHaveBeenCalledWith(3, true, null, '1.2.3');
  });

  it('lets an unreadable credential keep its own code instead of reading as a failed test', async () => {
    const { service, repo, credentials, prowlarr } = makeService();
    credentials.decrypt.mockImplementationOnce(() => {
      throw new BadRequestException({ message: 'key changed', errorCode: 'REQUEST_ENCRYPTION_KEY_CHANGED' });
    });

    await expect(service.test(3)).rejects.toBeInstanceOf(BadRequestException);
    expect(prowlarr.status).not.toHaveBeenCalled();
    expect(repo.recordTestResult).not.toHaveBeenCalled();
  });

  it('records a synchronization failure without marking missing children unavailable', async () => {
    const { service, repo, prowlarr } = makeService();
    prowlarr.indexers.mockRejectedValueOnce(new Error('Prowlarr unavailable'));

    await expect(service.sync(3)).rejects.toThrow('Prowlarr unavailable');
    expect(repo.recordSyncFailure).toHaveBeenCalledWith(3, 'Prowlarr unavailable');
    expect(repo.setSourcesAvailable).not.toHaveBeenCalled();
  });

  it('stores a failed connection test and reports it as a gateway failure', async () => {
    const { service, repo, prowlarr } = makeService();
    prowlarr.status.mockRejectedValueOnce(new Error('wrong key'));

    await expect(service.test(3)).rejects.toBeInstanceOf(BadGatewayException);
    expect(repo.recordTestResult).toHaveBeenCalledWith(3, false, 'wrong key', null);
  });

  it('accepts an update that changes nothing without asking the database to set no columns', async () => {
    const { service, repo } = makeService();

    await expect(service.update(3, {})).resolves.toEqual(expect.objectContaining({ id: 3 }));
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.syncProwlarrSources).not.toHaveBeenCalled();
  });

  it('updates only BookOrbit-owned settings on a managed source', async () => {
    const { service, repo } = makeService();

    await service.updateSource(3, 10, { color: 'orange' });

    expect(repo.updateSource).toHaveBeenCalledWith(3, 10, { color: 'orange' });
  });

  it('refuses a managed source update with no supported change', async () => {
    const { service, repo } = makeService();

    await expect(service.updateSource(3, 10, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateSource).not.toHaveBeenCalled();
  });

  it('refuses a blank API key on create', async () => {
    const { service, repo } = makeService();

    await expect(
      service.create({ name: 'Prowlarr', type: 'prowlarr', baseUrl: 'http://127.0.0.1:9696', credential: '   ', allowPrivateAddress: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });
});
