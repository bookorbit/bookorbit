import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

vi.mock('../../common/utils/ssrf.utils', () => ({
  ensureSafeUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(new URL(url.replace(/\/$/, '')))),
}));

import { OidcProviderRepository } from './oidc-provider.repository';
import { OidcProviderService } from './oidc-provider.service';

function makeRepo(): jest.Mocked<OidcProviderRepository> {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    findEnabled: vi.fn().mockResolvedValue([]),
    findBySlug: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
    findByIssuerUri: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 1, slug: 'keycloak' }),
    update: vi.fn().mockResolvedValue({ id: 1, slug: 'keycloak' }),
    remove: vi.fn().mockResolvedValue({ id: 1 }),
    countLinkedIdentities: vi.fn().mockResolvedValue(0),
    reorder: vi.fn().mockResolvedValue(undefined),
    findGroupMappingsByProvider: vi.fn().mockResolvedValue([]),
    createGroupMapping: vi.fn().mockResolvedValue({ id: 1 }),
    updateGroupMapping: vi.fn().mockResolvedValue({ id: 1 }),
    deleteGroupMapping: vi.fn().mockResolvedValue({ id: 1 }),
  } as unknown as jest.Mocked<OidcProviderRepository>;
}

function makeConfig(nodeEnv = 'development'): ConfigService {
  return { get: vi.fn().mockReturnValue(nodeEnv) } as unknown as ConfigService;
}

describe('OidcProviderService', () => {
  let service: OidcProviderService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    service = new OidcProviderService(repo, makeConfig());
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findBySlugOrFail', () => {
    it('returns provider when found', async () => {
      const provider = { id: 1, slug: 'keycloak' };
      repo.findBySlug.mockResolvedValue(provider as never);
      await expect(service.findBySlugOrFail('keycloak')).resolves.toEqual(provider);
    });

    it('throws NotFoundException when not found', async () => {
      repo.findBySlug.mockResolvedValue(null as never);
      await expect(service.findBySlugOrFail('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByIdOrFail', () => {
    it('returns provider when found', async () => {
      const provider = { id: 1, slug: 'keycloak' };
      repo.findById.mockResolvedValue(provider as never);
      await expect(service.findByIdOrFail(1)).resolves.toEqual(provider);
    });

    it('throws NotFoundException when not found', async () => {
      repo.findById.mockResolvedValue(null as never);
      await expect(service.findByIdOrFail(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a provider with valid slug', async () => {
      await service.create({ slug: 'keycloak', displayName: 'Keycloak', issuerUri: 'https://kc.example.com', clientId: 'client' });
      expect(repo.create).toHaveBeenCalled();
    });

    it('rejects slug that is too short', async () => {
      await expect(service.create({ slug: 'a', displayName: 'X', issuerUri: 'https://x.com', clientId: 'c' })).rejects.toThrow(BadRequestException);
    });

    it('rejects slug with uppercase characters', async () => {
      await expect(service.create({ slug: 'MyProvider', displayName: 'X', issuerUri: 'https://x.com', clientId: 'c' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects slug that starts with a hyphen', async () => {
      await expect(service.create({ slug: '-keycloak', displayName: 'X', issuerUri: 'https://x.com', clientId: 'c' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects duplicate slug', async () => {
      repo.findBySlug.mockResolvedValue({ id: 1, slug: 'keycloak' } as never);
      await expect(service.create({ slug: 'keycloak', displayName: 'Keycloak', issuerUri: 'https://kc.example.com', clientId: 'c' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    it('updates an existing provider', async () => {
      repo.findBySlug.mockResolvedValue({ id: 1, slug: 'keycloak' } as never);
      await service.update('keycloak', { displayName: 'Keycloak Updated' });
      expect(repo.update).toHaveBeenCalledWith(1, { displayName: 'Keycloak Updated' });
    });

    it('throws when provider not found', async () => {
      repo.findBySlug.mockResolvedValue(null as never);
      await expect(service.update('missing', { displayName: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes a provider with no linked identities', async () => {
      repo.findBySlug.mockResolvedValue({ id: 1, slug: 'keycloak' } as never);
      repo.countLinkedIdentities.mockResolvedValue(0);
      await service.remove('keycloak');
      expect(repo.remove).toHaveBeenCalledWith(1);
    });

    it('rejects deletion when identities are linked', async () => {
      repo.findBySlug.mockResolvedValue({ id: 1, slug: 'keycloak' } as never);
      repo.countLinkedIdentities.mockResolvedValue(5);
      await expect(service.remove('keycloak')).rejects.toThrow(BadRequestException);
    });

    it('throws when provider not found', async () => {
      repo.findBySlug.mockResolvedValue(null as never);
      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('reorder', () => {
    it('reorders providers by slug', async () => {
      repo.findAll.mockResolvedValue([
        { id: 1, slug: 'keycloak' },
        { id: 2, slug: 'authentik' },
      ] as never);
      await service.reorder(['authentik', 'keycloak']);
      expect(repo.reorder).toHaveBeenCalledWith([2, 1]);
    });

    it('throws for unknown slug', async () => {
      repo.findAll.mockResolvedValue([{ id: 1, slug: 'keycloak' }] as never);
      await expect(service.reorder(['unknown'])).rejects.toThrow(BadRequestException);
    });
  });

  describe('group mappings', () => {
    it('listGroupMappings delegates to repo', async () => {
      repo.findBySlug.mockResolvedValue({ id: 1, slug: 'keycloak' } as never);
      await service.listGroupMappings('keycloak');
      expect(repo.findGroupMappingsByProvider).toHaveBeenCalledWith(1);
    });

    it('createGroupMapping delegates to repo', async () => {
      repo.findBySlug.mockResolvedValue({ id: 1, slug: 'keycloak' } as never);
      await service.createGroupMapping('keycloak', 'admins', 'manage_users');
      expect(repo.createGroupMapping).toHaveBeenCalledWith(1, 'admins', 'manage_users');
    });

    it('deleteGroupMapping throws when not found', async () => {
      repo.findBySlug.mockResolvedValue({ id: 1, slug: 'keycloak' } as never);
      repo.deleteGroupMapping.mockResolvedValue(null as never);
      await expect(service.deleteGroupMapping('keycloak', 999)).rejects.toThrow(NotFoundException);
    });
  });
});
