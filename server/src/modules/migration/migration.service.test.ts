import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { MigrationService } from './migration.service';

function createService(overrides: Partial<Record<string, unknown>> = {}): MigrationService {
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
    findProfileById: vi.fn(() =>
      Promise.resolve({
        id: 2,
        sourceId: 1,
        name: 'Booklore Migration',
        version: 1,
        userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
        pathMappings: [],
        scope: { preflight: { pathValidatedAt: new Date().toISOString() } },
        createdByUserId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
    listRuns: vi.fn(() => Promise.resolve([])),
    findPlanArtifactById: vi.fn(() =>
      Promise.resolve({
        id: 100,
        sourceId: 1,
        profileId: 2,
        sourceSnapshotHash: 'a',
        profileHash: 'b',
        planHash: 'd',
        plan: {},
        summary: {},
        createdByUserId: 1,
        createdAt: new Date(Date.now() + 1000),
        updatedAt: new Date(),
      }),
    ),
    createRunWithLock: vi.fn(() =>
      Promise.resolve({
        run: null,
        activeRun: {
          id: 77,
          sourceId: 1,
          profileId: 2,
          planArtifactId: 100,
          targetKey: 'projectx',
          state: 'running',
          currentStage: 'init',
          triggeredByUserId: 1,
          startedAt: new Date(),
          endedAt: null,
          errorMessage: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }),
    ),
    purgeRunState: vi.fn(() => Promise.resolve()),
    ...overrides,
  };

  return new MigrationService(
    repo as never,
    { listTypes: vi.fn(), get: vi.fn() } as never,
    { buildPlan: vi.fn() } as never,
    { start: vi.fn() } as never,
    { getRunProgress: vi.fn(), getRunReport: vi.fn(), exportRunReport: vi.fn() } as never,
    { validate: vi.fn() } as never,
  );
}

describe('MigrationService', () => {
  it('rejects profile creation when target user mapping IDs are invalid', async () => {
    const service = createService();

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

  it('rejects live run start when another active run exists for the same source and target', async () => {
    const service = createService();

    await expect(
      service.startLiveRun(
        {
          planArtifactId: 100,
          targetKey: 'projectx',
        },
        1,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows live run start without path validation when no path mappings are configured', async () => {
    const run = {
      id: 78,
      sourceId: 1,
      profileId: 2,
      planArtifactId: 100,
      targetKey: 'projectx',
      state: 'running',
      currentStage: 'init',
      triggeredByUserId: 1,
      startedAt: new Date(),
      endedAt: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const service = createService({
      findProfileById: vi.fn(() =>
        Promise.resolve({
          id: 2,
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
      ),
      createRunWithLock: vi.fn(() => Promise.resolve({ run, activeRun: null })),
    });

    await expect(service.startLiveRun({ planArtifactId: 100, targetKey: 'projectx' }, 1)).resolves.toEqual({
      id: 78,
      sourceId: 1,
      profileId: 2,
      planArtifactId: 100,
      state: 'running',
      currentStage: 'init',
      startedAt: run.startedAt,
      endedAt: null,
      errorMessage: null,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    });
  });

  it('rejects live run start when configured path mappings have not been validated', async () => {
    const service = createService({
      findProfileById: vi.fn(() =>
        Promise.resolve({
          id: 2,
          sourceId: 1,
          name: 'Booklore Migration',
          version: 1,
          userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
          pathMappings: [{ sourcePrefix: '/source', targetPrefix: '/target' }],
          scope: {},
          createdByUserId: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
    });

    await expect(service.startLiveRun({ planArtifactId: 100, targetKey: 'projectx' }, 1)).rejects.toBeInstanceOf(BadRequestException);
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
    const service = createService({
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
        version: 4,
      }),
    );
  });
});
