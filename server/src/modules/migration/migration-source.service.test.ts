import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { MigrationSourceService, resolveConnectionConfig } from './migration-source.service';

const noopEncryption = {
  encryptConfig: vi.fn((c: Record<string, unknown>) => c),
  decryptConfig: vi.fn((c: unknown) => c as Record<string, unknown>),
  isConfigured: () => false,
} as never;

function buildSource(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    type: 'booklore',
    name: 'Existing Source',
    connectionConfig: { host: 'db.example.com', user: 'admin', password: 'real-secret-password', database: 'booklore' },
    capabilities: null,
    lastValidatedAt: new Date(),
    createdByUserId: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function validationResult(ok: boolean) {
  return {
    ok,
    sourceType: 'booklore',
    sourceVersion: '1.0',
    warnings: ok ? [] : ['warning'],
    counts: { books: 12 },
    missingTables: ok ? [] : ['books'],
  };
}

function createService(overrides: Partial<Record<string, unknown>> = {}) {
  const adapter = {
    validate: vi.fn(() => Promise.resolve(validationResult(true))),
    fetchPathPrefixes: vi.fn(() => Promise.resolve(['/library'])),
  };
  const repo = {
    findSourceById: vi.fn(() => Promise.resolve(buildSource())),
    listRuns: vi.fn(() => Promise.resolve([])),
    listSources: vi.fn(() => Promise.resolve([buildSource()])),
    updateSource: vi.fn((id: number, values: Record<string, unknown>) => Promise.resolve({ ...buildSource(), ...values, id })),
    createSource: vi.fn((values: Record<string, unknown>) => Promise.resolve({ ...buildSource({ id: 5 }), ...values })),
    deleteSource: vi.fn((id: number) => Promise.resolve(buildSource({ id }))),
    updateSourceValidation: vi.fn(() => Promise.resolve(buildSource())),
    purgeRunState: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  const adapterRegistry = {
    listTypes: vi.fn(() => ['booklore']),
    get: vi.fn(() => adapter),
  };
  const service = new MigrationSourceService(repo as never, adapterRegistry as never, noopEncryption);
  return { service, repo, adapterRegistry, adapter };
}

describe('MigrationSourceService', () => {
  it('lists supported source types from the adapter registry', () => {
    const { service } = createService();
    expect(service.listSupportedSourceTypes()).toEqual(['booklore']);
  });

  it('tests a source through the matching adapter', async () => {
    const { service, adapterRegistry, adapter } = createService();
    const result = await service.testSource({
      type: 'booklore',
      connectionConfig: { host: 'db.local', user: 'u', password: 'pw', database: 'booklore' },
    });

    expect(adapterRegistry.get).toHaveBeenCalledWith('booklore');
    expect(adapter.validate).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('validateSourceById persists successful validation payload and clears stale run state', async () => {
    const updateSourceValidation = vi.fn(() => Promise.resolve(buildSource()));
    const { service, repo } = createService({ updateSourceValidation });

    const result = await service.validateSourceById(1);

    expect(result.ok).toBe(true);
    expect(updateSourceValidation).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        capabilities: expect.objectContaining({
          ok: true,
          sourceType: 'booklore',
          sourceVersion: '1.0',
        }),
        lastValidatedAt: expect.any(Date),
      }),
    );
    expect(repo.purgeRunState).toHaveBeenCalledWith(1);
  });

  it('validateSourceById stores null lastValidatedAt when validation fails', async () => {
    const updateSourceValidation = vi.fn(() => Promise.resolve(buildSource()));
    const { service, adapter, repo } = createService({ updateSourceValidation });
    adapter.validate.mockResolvedValue(validationResult(false));

    const result = await service.validateSourceById(1);

    expect(result.ok).toBe(false);
    expect(updateSourceValidation).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        capabilities: expect.objectContaining({
          ok: false,
          missingTables: ['books'],
        }),
        lastValidatedAt: null,
      }),
    );
    expect(repo.purgeRunState).toHaveBeenCalledWith(1);
  });

  it('throws NotFoundException when validateSourceById source is missing', async () => {
    const { service } = createService({
      findSourceById: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.validateSourceById(999)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resetSource deletes saved setup when no migration run exists', async () => {
    const { service, repo } = createService({
      listRuns: vi.fn(() => Promise.resolve([])),
    });

    await expect(service.resetSource(1)).resolves.toBeUndefined();

    expect(repo.findSourceById).toHaveBeenCalledWith(1);
    expect(repo.listRuns).toHaveBeenCalledWith(1);
    expect(repo.deleteSource).toHaveBeenCalledWith(1);
  });

  it('resetSource throws NotFoundException when source is missing', async () => {
    const { service, repo } = createService({
      findSourceById: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.resetSource(999)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.deleteSource).not.toHaveBeenCalled();
  });

  it('resetSource rejects setup reset after a migration run exists', async () => {
    const { service, repo } = createService({
      listRuns: vi.fn(() => Promise.resolve([{ id: 10, state: 'failed' }])),
    });

    await expect(service.resetSource(1)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.deleteSource).not.toHaveBeenCalled();
  });

  it('resetSource blocks when a migration run is already active', async () => {
    const { service, repo } = createService({
      listRuns: vi.fn(() => Promise.resolve([{ id: 99, state: 'running' }])),
    });

    await expect(service.resetSource(1)).rejects.toBeInstanceOf(ConflictException);
    expect(repo.findSourceById).not.toHaveBeenCalled();
    expect(repo.deleteSource).not.toHaveBeenCalled();
  });

  it('createSource updates existing source and preserves sentinel password', async () => {
    const existingSource = buildSource({
      id: 7,
      connectionConfig: {
        host: 'db.example.com',
        user: 'admin',
        password: 'keep-this',
        database: 'booklore',
      },
    });
    const updateSource = vi.fn((id: number, values: Record<string, unknown>) => Promise.resolve({ ...existingSource, ...values, id }));
    const { service } = createService({
      listSources: vi.fn(() =>
        Promise.resolve([
          existingSource,
          buildSource({
            id: 8,
            name: 'Existing Source 2',
            connectionConfig: { host: 'db.example.com', user: 'admin', password: 'x', database: 'booklore' },
          }),
        ]),
      ),
      updateSource,
    });

    const result = await service.createSource(
      {
        type: 'booklore',
        name: 'Existing Source 2',
        connectionConfig: {
          host: 'db.example.com',
          user: 'admin',
          password: '********',
          database: 'booklore',
        },
      },
      42,
    );

    const calledConfig = updateSource.mock.calls[0][1].connectionConfig as Record<string, unknown>;
    expect(calledConfig.password).toBe('keep-this');
    expect(updateSource).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        type: 'booklore',
        name: 'Existing Source 2 2',
        createdByUserId: 42,
      }),
    );
    expect((result.connectionConfig as Record<string, unknown>).password).toBe('********');
  });

  it('createSource inserts a new source when no existing source exists', async () => {
    const createSource = vi.fn((values: Record<string, unknown>) => Promise.resolve({ ...buildSource({ id: 11 }), ...values }));
    const { service, repo } = createService({
      listSources: vi.fn(() => Promise.resolve([])),
      createSource,
    });

    const result = await service.createSource(
      {
        type: '  BOOKLORE  ',
        name: ' New Source ',
        connectionConfig: {
          host: 'db.example.com',
          user: 'admin',
          password: 'new-password',
          database: 'booklore',
        },
      },
      2,
    );

    expect(createSource).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'booklore',
        name: 'New Source',
        createdByUserId: 2,
      }),
    );
    expect(repo.purgeRunState).toHaveBeenCalledWith(11);
    expect((result.connectionConfig as Record<string, unknown>).password).toBe('********');
  });

  it('createSource rejects invalid adapter validation results', async () => {
    const { service, adapter } = createService({
      listSources: vi.fn(() => Promise.resolve([])),
    });
    adapter.validate.mockResolvedValue(validationResult(false));

    await expect(
      service.createSource(
        {
          type: 'booklore',
          name: 'Source',
          connectionConfig: {
            host: 'db.example.com',
            user: 'admin',
            password: 'pw',
            database: 'booklore',
          },
        },
        1,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createSource blocks when a migration run is already active', async () => {
    const { service } = createService({
      listRuns: vi.fn(() => Promise.resolve([{ id: 99, state: 'running' }])),
    });

    await expect(
      service.createSource(
        {
          type: 'booklore',
          name: 'Source',
          connectionConfig: {
            host: 'db.example.com',
            user: 'admin',
            password: 'pw',
            database: 'booklore',
          },
        },
        1,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('createSource throws InternalServerErrorException when persistence returns null', async () => {
    const { service } = createService({
      listSources: vi.fn(() => Promise.resolve([])),
      createSource: vi.fn(() => Promise.resolve(null)),
    });

    await expect(
      service.createSource(
        {
          type: 'booklore',
          name: 'Source',
          connectionConfig: {
            host: 'db.example.com',
            user: 'admin',
            password: 'pw',
            database: 'booklore',
          },
        },
        1,
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('getSourcePathPrefixes returns empty prefixes when adapter does not support path fetching', async () => {
    const { service, adapterRegistry } = createService();
    adapterRegistry.get.mockReturnValue({
      validate: vi.fn(() => Promise.resolve(validationResult(true))),
    });

    await expect(service.getSourcePathPrefixes(1)).resolves.toEqual({ prefixes: [] });
  });

  it('getSourcePathPrefixes fetches prefixes through adapter when supported', async () => {
    const { service } = createService();

    await expect(service.getSourcePathPrefixes(1)).resolves.toEqual({ prefixes: ['/library'] });
  });

  it('getSourcePathPrefixes throws NotFoundException for missing source', async () => {
    const { service } = createService({
      findSourceById: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.getSourcePathPrefixes(404)).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('resolveConnectionConfig', () => {
    it('returns incoming config when no existing source', () => {
      const result = resolveConnectionConfig({ host: 'localhost', password: 'secret' }, null, noopEncryption);
      expect(result).toEqual({ host: 'localhost', password: 'secret' });
    });

    it('replaces sentinels from existing config and uses empty string when key is missing', () => {
      const existing = buildSource({
        connectionConfig: { host: 'db.local', password: 'real-pw' },
      }) as never;

      const result = resolveConnectionConfig({ host: 'db.local', password: '********', apiKey: '********' }, existing, noopEncryption);

      expect(result.password).toBe('real-pw');
      expect(result.apiKey).toBe('');
      expect(result.host).toBe('db.local');
    });
  });
});
