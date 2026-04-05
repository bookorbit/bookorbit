import { describe, expect, it, vi } from 'vitest';

import { MigrationSourceService, resolveConnectionConfig } from './migration-source.service';

const noopEncryption = {
  encryptConfig: (c: Record<string, unknown>) => c,
  decryptConfig: (c: unknown) => c as Record<string, unknown>,
  isConfigured: () => false,
} as never;

describe('MigrationSourceService', () => {
  describe('createSource - password sentinel', () => {
    it('preserves existing password when sentinel is sent back', async () => {
      const existingSource = {
        id: 1,
        type: 'booklore',
        name: 'Existing Source',
        connectionConfig: { host: 'db.example.com', user: 'admin', password: 'real-secret-password', database: 'booklore' },
        capabilities: null,
        lastValidatedAt: new Date(),
        createdByUserId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updateSource = vi.fn((id: number, values: Record<string, unknown>) => {
        return Promise.resolve({ ...existingSource, ...values, id });
      });

      const validate = vi.fn(() =>
        Promise.resolve({
          ok: true,
          sourceType: 'booklore',
          sourceVersion: '1.0',
          warnings: [],
          counts: {},
          missingTables: [],
        }),
      );

      const repo = {
        findSourceById: vi.fn(() => Promise.resolve(existingSource)),
        listRuns: vi.fn(() => Promise.resolve([])),
        listSources: vi.fn(() => Promise.resolve([existingSource])),
        updateSource,
        createSource: vi.fn(),
        purgeRunState: vi.fn(() => Promise.resolve()),
      };

      const service = new MigrationSourceService(repo as never, { listTypes: vi.fn(), get: () => ({ validate }) } as never, noopEncryption);

      await service.createSource(
        {
          type: 'booklore',
          name: 'Existing Source',
          connectionConfig: { host: 'db.example.com', user: 'admin', password: '********', database: 'booklore' },
        },
        1,
      );

      const calledConfig = updateSource.mock.calls[0][1].connectionConfig as Record<string, unknown>;
      expect(calledConfig.password).toBe('real-secret-password');
    });

    it('uses new password when non-sentinel value is sent', async () => {
      const existingSource = {
        id: 1,
        type: 'booklore',
        name: 'Existing Source',
        connectionConfig: { host: 'db.example.com', user: 'admin', password: 'old-password', database: 'booklore' },
        capabilities: null,
        lastValidatedAt: new Date(),
        createdByUserId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updateSource = vi.fn((id: number, values: Record<string, unknown>) => {
        return Promise.resolve({ ...existingSource, ...values, id });
      });

      const validate = vi.fn(() =>
        Promise.resolve({
          ok: true,
          sourceType: 'booklore',
          sourceVersion: '1.0',
          warnings: [],
          counts: {},
          missingTables: [],
        }),
      );

      const repo = {
        findSourceById: vi.fn(() => Promise.resolve(existingSource)),
        listRuns: vi.fn(() => Promise.resolve([])),
        listSources: vi.fn(() => Promise.resolve([existingSource])),
        updateSource,
        createSource: vi.fn(),
        purgeRunState: vi.fn(() => Promise.resolve()),
      };

      const service = new MigrationSourceService(repo as never, { listTypes: vi.fn(), get: () => ({ validate }) } as never, noopEncryption);

      await service.createSource(
        {
          type: 'booklore',
          name: 'Existing Source',
          connectionConfig: { host: 'db.example.com', user: 'admin', password: 'new-password', database: 'booklore' },
        },
        1,
      );

      const calledConfig = updateSource.mock.calls[0][1].connectionConfig as Record<string, unknown>;
      expect(calledConfig.password).toBe('new-password');
    });
  });

  describe('resolveConnectionConfig - adapter-agnostic sentinel', () => {
    it('resolves sentinel in any field named with password-like keys', async () => {
      const existingSource = {
        id: 1,
        type: 'custom_source',
        name: 'Custom Source',
        connectionConfig: { host: 'db.example.com', user: 'admin', password: 'real-secret', apiKey: 'real-api-key', database: 'mydb' },
        capabilities: null,
        lastValidatedAt: new Date(),
        createdByUserId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updateSource = vi.fn((id: number, values: Record<string, unknown>) => {
        return Promise.resolve({ ...existingSource, ...values, id });
      });

      const validate = vi.fn(() =>
        Promise.resolve({
          ok: true,
          sourceType: 'custom',
          sourceVersion: '1.0',
          warnings: [],
          counts: {},
          missingTables: [],
        }),
      );

      const repo = {
        findSourceById: vi.fn(() => Promise.resolve(existingSource)),
        listRuns: vi.fn(() => Promise.resolve([])),
        listSources: vi.fn(() => Promise.resolve([existingSource])),
        updateSource,
        createSource: vi.fn(),
        purgeRunState: vi.fn(() => Promise.resolve()),
      };

      const service = new MigrationSourceService(repo as never, { listTypes: vi.fn(), get: () => ({ validate }) } as never, noopEncryption);

      await service.createSource(
        {
          type: 'custom_source',
          name: 'Custom Source',
          connectionConfig: { host: 'db.example.com', user: 'admin', password: '********', apiKey: '********', database: 'mydb' },
        },
        1,
      );

      const calledConfig = updateSource.mock.calls[0][1].connectionConfig as Record<string, unknown>;
      expect(calledConfig.password).toBe('real-secret');
      expect(calledConfig.apiKey).toBe('real-api-key');
      expect(calledConfig.host).toBe('db.example.com');
    });
  });

  describe('resolveConnectionConfig (standalone)', () => {
    it('returns incoming config when no existing source', () => {
      const result = resolveConnectionConfig({ host: 'localhost', password: 'secret' }, null, noopEncryption);
      expect(result).toEqual({ host: 'localhost', password: 'secret' });
    });

    it('replaces sentinel values from existing config', () => {
      const existing = {
        id: 1,
        type: 'booklore',
        name: 'test',
        connectionConfig: { host: 'db.local', password: 'real-pw' },
      } as never;

      const result = resolveConnectionConfig({ host: 'db.local', password: '********' }, existing, noopEncryption);
      expect(result.password).toBe('real-pw');
      expect(result.host).toBe('db.local');
    });
  });
});
