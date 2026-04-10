import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { MigrationProfileService } from './migration-profile.service';

const noopEncryption = {
  encryptConfig: (c: Record<string, unknown>) => c,
  decryptConfig: (c: unknown) => c as Record<string, unknown>,
  isConfigured: () => false,
} as never;

function buildSource(id = 1) {
  return {
    id,
    type: 'booklore',
    name: 'Booklore',
    connectionConfig: {
      host: 'db.local',
      user: 'booklore',
      password: 'secret',
      database: 'booklore',
    },
    capabilities: null,
    lastValidatedAt: new Date(),
    createdByUserId: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildProfile(id: number, sourceId: number, pathMappings: Array<{ sourcePrefix: string; targetPrefix: string }>) {
  return {
    id,
    sourceId,
    name: `Profile ${id}`,
    version: 1,
    userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
    pathMappings,
    scope: { preflight: { existing: true } },
    createdByUserId: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createProfileService(overrides: Partial<Record<string, unknown>> = {}) {
  const adapter = {
    exportData: vi.fn(() => Promise.resolve({ users: [], books: [] })),
  };
  const repo = {
    findSourceById: vi.fn(() => Promise.resolve(buildSource())),
    listTargetUsersForMapping: vi.fn(() =>
      Promise.resolve([
        { id: 10, username: 'target-user', name: 'Target User', email: 'target@example.com' },
        { id: 11, username: 'reader11', name: 'Reader Eleven', email: 'reader11@example.com' },
        { id: 12, username: 'reader12', name: 'Reader Twelve', email: 'reader12@example.com' },
        { id: 13, username: 'reader13', name: 'Reader Thirteen', email: 'reader13@example.com' },
      ]),
    ),
    listProfiles: vi.fn(() => Promise.resolve([])),
    createProfile: vi.fn(() =>
      Promise.resolve({
        id: 3,
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
    updateProfileScope: vi.fn(() => Promise.resolve(null)),
    listRuns: vi.fn(() => Promise.resolve([])),
    purgeRunState: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  const adapterRegistry = {
    listTypes: vi.fn(),
    get: vi.fn(() => adapter),
  };
  const pathValidator = {
    validate: vi.fn(() =>
      Promise.resolve({
        summary: {
          totalSourceBooks: 1,
          booksWithFilePath: 1,
          mappedByPrefix: 1,
          matchedTargetPaths: 1,
          unmatchedTargetPaths: 0,
          unchangedPaths: 0,
        },
        mappings: [],
      }),
    ),
  };
  const service = new MigrationProfileService(repo as never, adapterRegistry as never, pathValidator as never, noopEncryption);
  return { service, repo, adapter, adapterRegistry, pathValidator };
}

describe('MigrationProfileService', () => {
  it('rejects profile creation when target user mapping IDs are invalid', async () => {
    const { service } = createProfileService();

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

  it('blocks profile creation when a live run is active', async () => {
    const { service } = createProfileService({
      listRuns: vi.fn(() => Promise.resolve([{ id: 77, state: 'running' }])),
    });

    await expect(
      service.createProfile(
        {
          sourceId: 1,
          name: 'Profile',
          userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
          pathMappings: [],
        },
        1,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException when creating a profile for missing source', async () => {
    const { service } = createProfileService({
      findSourceById: vi.fn(() => Promise.resolve(null)),
    });

    await expect(
      service.createProfile(
        {
          sourceId: 123,
          name: 'Profile',
          userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
          pathMappings: [],
        },
        1,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws InternalServerErrorException when profile persistence fails', async () => {
    const { service } = createProfileService({
      createProfile: vi.fn(() => Promise.resolve(null)),
    });

    await expect(
      service.createProfile(
        {
          sourceId: 1,
          name: 'Profile',
          userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
          pathMappings: [],
        },
        1,
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('normalizes createProfile input, purges run state, and returns sanitized profile fields', async () => {
    const createdProfile = {
      id: 8,
      sourceId: 1,
      name: 'My Profile',
      version: 1,
      userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
      pathMappings: [],
      scope: {},
      createdByUserId: 9,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const createProfile = vi.fn(() => Promise.resolve(createdProfile));
    const { service, repo } = createProfileService({ createProfile });

    const result = await service.createProfile(
      {
        sourceId: 1,
        name: '  My Profile  ',
        userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
      } as never,
      9,
    );

    expect(createProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 1,
        name: 'My Profile',
        pathMappings: [],
        scope: {},
        createdByUserId: 9,
      }),
    );
    expect(repo.purgeRunState).toHaveBeenCalledWith(1);
    expect(result).toEqual({
      id: 8,
      sourceId: 1,
      name: 'My Profile',
      userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
      pathMappings: [],
      scope: {},
      createdAt: createdProfile.createdAt,
      updatedAt: createdProfile.updatedAt,
    });
  });

  it('suggestUserMappings ranks and limits candidates based on score confidence', async () => {
    const { service, adapter, adapterRegistry } = createProfileService();
    adapter.exportData.mockResolvedValue({
      users: [
        { sourceUserId: 'u-email', username: 'any', email: 'reader11@example.com', name: 'No Match' },
        { sourceUserId: 'u-username', username: 'reader12', email: null, name: null },
        { sourceUserId: 'u-name', username: 'zzz', email: null, name: 'Reader Thirteen' },
        { sourceUserId: 'u-top3', username: 'reader', email: null, name: 'Reader' },
      ],
      books: [],
    });

    const result = await service.suggestUserMappings(1);

    expect(adapterRegistry.get).toHaveBeenCalledWith('booklore');
    const [emailSuggestion, usernameSuggestion, nameSuggestion, topThreeSuggestion] = result.suggestions;
    expect(emailSuggestion.suggestedTargetUserId).toBe(11);
    expect(emailSuggestion.confidence).toBe('high');
    expect(usernameSuggestion.suggestedTargetUserId).toBe(12);
    expect(usernameSuggestion.confidence).toBe('high');
    expect(nameSuggestion.suggestedTargetUserId).toBe(13);
    expect(nameSuggestion.confidence).toBe('medium');
    expect(topThreeSuggestion.candidates).toHaveLength(3);
  });

  it('throws NotFoundException when suggestUserMappings source is missing', async () => {
    const { service } = createProfileService({
      findSourceById: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.suggestUserMappings(55)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('validatePathMappings persists preflight metadata for matching profile hash', async () => {
    const matchingPathMappings = [{ sourcePrefix: '/source', targetPrefix: '/target' }];
    const updateProfileScope = vi.fn(() => Promise.resolve(buildProfile(4, 1, matchingPathMappings)));
    const { service, repo, adapter, pathValidator } = createProfileService({
      listProfiles: vi.fn(() =>
        Promise.resolve([buildProfile(3, 1, [{ sourcePrefix: '/else', targetPrefix: '/other' }]), buildProfile(4, 1, matchingPathMappings)]),
      ),
      updateProfileScope,
    });
    adapter.exportData.mockResolvedValue({
      users: [],
      books: [{ sourceBookId: 'b1', filePath: '/source/book.epub' }],
    });

    const result = await service.validatePathMappings(1, {
      pathMappings: matchingPathMappings,
      sampleLimit: 3,
    });

    expect(pathValidator.validate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceBooks: [{ sourceBookId: 'b1', filePath: '/source/book.epub' }],
        pathMappings: matchingPathMappings,
        sampleLimit: 3,
      }),
    );
    expect(updateProfileScope).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        preflight: expect.objectContaining({
          existing: true,
          pathValidatedAt: result.validatedAt,
          pathMappingsHash: result.pathMappingsHash,
        }),
      }),
    );
    expect(result.persistedProfileId).toBe(4);
    expect(repo.findSourceById).toHaveBeenCalledWith(1);
  });

  it('returns persistedProfileId null when no profile has matching path mapping hash', async () => {
    const { service, repo, adapter } = createProfileService({
      listProfiles: vi.fn(() => Promise.resolve([buildProfile(4, 1, [{ sourcePrefix: '/x', targetPrefix: '/y' }])])),
    });
    adapter.exportData.mockResolvedValue({ users: [], books: [] });

    const result = await service.validatePathMappings(1, {
      pathMappings: [{ sourcePrefix: '/source', targetPrefix: '/target' }],
    });

    expect(result.persistedProfileId).toBeNull();
    expect(repo.updateProfileScope).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when validatePathMappings source is missing', async () => {
    const { service } = createProfileService({
      findSourceById: vi.fn(() => Promise.resolve(null)),
    });

    await expect(
      service.validatePathMappings(42, {
        pathMappings: [{ sourcePrefix: '/source', targetPrefix: '/target' }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
