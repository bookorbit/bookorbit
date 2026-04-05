import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { MigrationProfileService } from './migration-profile.service';

const noopEncryption = {
  encryptConfig: (c: Record<string, unknown>) => c,
  decryptConfig: (c: unknown) => c as Record<string, unknown>,
  isConfigured: () => false,
} as never;

function createProfileService(overrides: Partial<Record<string, unknown>> = {}): MigrationProfileService {
  const repo = {
    findSourceById: vi.fn(() =>
      Promise.resolve({
        id: 1,
        type: 'booklore',
        name: 'Booklore',
        connectionConfig: {},
        capabilities: null,
        lastValidatedAt: new Date(),
        createdByUserId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
    listTargetUsersForMapping: vi.fn(() =>
      Promise.resolve([
        {
          id: 10,
          username: 'target-user',
          name: 'Target User',
          email: 'target@example.com',
        },
      ]),
    ),
    listProfiles: vi.fn(() => Promise.resolve([])),
    createProfile: vi.fn(),
    listRuns: vi.fn(() => Promise.resolve([])),
    purgeRunState: vi.fn(() => Promise.resolve()),
    ...overrides,
  };

  return new MigrationProfileService(repo as never, { listTypes: vi.fn(), get: vi.fn() } as never, { validate: vi.fn() } as never, noopEncryption);
}

describe('MigrationProfileService', () => {
  it('rejects profile creation when target user mapping IDs are invalid', async () => {
    const service = createProfileService();

    await expect(
      service.createProfile(
        {
          sourceId: 1,
          name: 'Profile',
          userMappings: [{ sourceUserId: 'src-user', targetUserId: 999 }],
          pathMappings: [],
        },
        1,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a new profile version instead of overwriting the current one', async () => {
    const createProfile = vi.fn(() =>
      Promise.resolve({
        id: 3,
        sourceId: 1,
        name: 'Booklore Migration',
        version: 4,
        userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
        pathMappings: [],
        scope: {},
        createdByUserId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    const service = createProfileService({
      listProfiles: vi.fn(() =>
        Promise.resolve([
          {
            id: 2,
            sourceId: 1,
            name: 'Booklore Migration',
            version: 3,
            userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
            pathMappings: [],
            scope: {},
            createdByUserId: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      ),
      createProfile,
    });

    await service.createProfile(
      {
        sourceId: 1,
        name: 'Booklore Migration',
        userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
        pathMappings: [],
      },
      1,
    );

    expect(createProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 1,
        name: 'Booklore Migration',
      }),
    );
    expect(createProfile).toHaveBeenCalledWith(
      expect.not.objectContaining({
        version: expect.anything(),
      }),
    );
  });

  it('does not pass version to createProfile (repo handles it)', async () => {
    const createProfileFn = vi.fn(() =>
      Promise.resolve({
        id: 5,
        sourceId: 1,
        name: 'Booklore Migration',
        version: 1,
        userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
        pathMappings: [],
        scope: {},
        createdByUserId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const service = createProfileService({
      listProfiles: vi.fn(() =>
        Promise.resolve([
          {
            id: 3,
            sourceId: 1,
            name: 'Booklore Migration',
            version: 3,
            userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
            pathMappings: [],
            scope: {},
            createdByUserId: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      ),
      createProfile: createProfileFn,
    });

    await service.createProfile(
      {
        sourceId: 1,
        name: 'Booklore Migration',
        userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
        pathMappings: [],
      },
      1,
    );

    expect(createProfileFn).toHaveBeenCalledTimes(1);
    const callArg = (createProfileFn.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty('version');
  });
});
