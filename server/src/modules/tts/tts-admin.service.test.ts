import { BadRequestException, NotFoundException } from '@nestjs/common';

import { TtsAdminService } from './tts-admin.service';
import type { TtsRepository } from './tts.repository';
import type { TtsProviderFactory } from './providers/tts-provider.factory';

function makeRepo() {
  return {
    findAllProviders: vi.fn().mockResolvedValue([]),
    findProviderById: vi.fn().mockResolvedValue(null),
    insertProvider: vi.fn(),
    updateProvider: vi.fn(),
    updateProviderOrder: vi.fn().mockResolvedValue(undefined),
    deleteProvider: vi.fn(),
  } as unknown as TtsRepository;
}

function makeProviderFactory() {
  return {
    getOpenAiProvider: vi.fn(),
    invalidateCache: vi.fn(),
  } as unknown as TtsProviderFactory;
}

const DB_PROVIDER = {
  id: 1,
  name: 'Kokoro',
  type: 'openai-compatible',
  baseUrl: 'http://localhost:8880/v1',
  apiKey: null,
  defaultModel: null,
  staticVoices: null,
  enabled: true,
  supportsVoiceDiscovery: true,
  displayOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('TtsAdminService', () => {
  let service: TtsAdminService;
  let repo: ReturnType<typeof makeRepo>;
  let factory: ReturnType<typeof makeProviderFactory>;

  beforeEach(() => {
    repo = makeRepo();
    factory = makeProviderFactory();
    service = new TtsAdminService(repo, factory);
  });

  describe('getAllProviders', () => {
    it('should return all providers', async () => {
      repo.findAllProviders.mockResolvedValue([DB_PROVIDER]);
      const result = await service.getAllProviders();
      expect(result).toHaveLength(1);
    });
  });

  describe('addProvider', () => {
    it('should create and return provider', async () => {
      repo.insertProvider.mockResolvedValue(DB_PROVIDER);
      const result = await service.addProvider({ name: 'Kokoro', baseUrl: 'http://localhost:8880/v1' });
      expect(result).toEqual(DB_PROVIDER);
      expect(repo.insertProvider).toHaveBeenCalled();
    });

    it('should pass staticVoices to repository when provided', async () => {
      const staticVoices = [{ id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' }];
      repo.insertProvider.mockResolvedValue({ ...DB_PROVIDER, staticVoices });
      await service.addProvider({ name: 'Kokoro', baseUrl: 'http://localhost:8880/v1', staticVoices });
      expect(repo.insertProvider).toHaveBeenCalledWith(expect.objectContaining({ staticVoices }));
    });

    it('should pass null staticVoices when not provided', async () => {
      repo.insertProvider.mockResolvedValue(DB_PROVIDER);
      await service.addProvider({ name: 'Kokoro', baseUrl: 'http://localhost:8880/v1' });
      expect(repo.insertProvider).toHaveBeenCalledWith(expect.objectContaining({ staticVoices: null }));
    });

    it('should default supportsVoiceDiscovery to true when not provided', async () => {
      repo.insertProvider.mockResolvedValue(DB_PROVIDER);
      await service.addProvider({ name: 'Kokoro', baseUrl: 'http://localhost:8880/v1' });
      expect(repo.insertProvider).toHaveBeenCalledWith(expect.objectContaining({ supportsVoiceDiscovery: true }));
    });

    it('should pass supportsVoiceDiscovery: false when explicitly set', async () => {
      repo.insertProvider.mockResolvedValue({ ...DB_PROVIDER, supportsVoiceDiscovery: false });
      await service.addProvider({ name: 'Kokoro', baseUrl: 'http://localhost:8880/v1', supportsVoiceDiscovery: false });
      expect(repo.insertProvider).toHaveBeenCalledWith(expect.objectContaining({ supportsVoiceDiscovery: false }));
    });
  });

  describe('reorderProviders', () => {
    const SECOND_PROVIDER = { ...DB_PROVIDER, id: 2, name: 'Piper' };

    beforeEach(() => {
      repo.findAllProviders.mockResolvedValue([DB_PROVIDER, SECOND_PROVIDER]);
    });

    it('should assign positions by list index', async () => {
      await service.reorderProviders(['2', '1']);

      expect(repo.updateProviderOrder).toHaveBeenCalledWith([
        { id: 2, displayOrder: 0 },
        { id: 1, displayOrder: 1 },
      ]);
    });

    it('should invalidate the cache for every reordered provider', async () => {
      await service.reorderProviders(['1', '2']);

      expect(factory.invalidateCache).toHaveBeenCalledWith(1);
      expect(factory.invalidateCache).toHaveBeenCalledWith(2);
    });

    it('should reject an order that omits a provider', async () => {
      await expect(service.reorderProviders(['1'])).rejects.toThrow(BadRequestException);
      expect(repo.updateProviderOrder).not.toHaveBeenCalled();
    });

    it('should reject an order naming an unknown provider', async () => {
      await expect(service.reorderProviders(['1', '2', '99'])).rejects.toThrow(BadRequestException);
      expect(repo.updateProviderOrder).not.toHaveBeenCalled();
    });

    it('should reject duplicate entries', async () => {
      await expect(service.reorderProviders(['1', '1'])).rejects.toThrow(BadRequestException);
      expect(repo.updateProviderOrder).not.toHaveBeenCalled();
    });
  });

  describe('updateProvider', () => {
    it('should throw NotFoundException if provider not found', async () => {
      repo.findProviderById.mockResolvedValue(null);
      await expect(service.updateProvider(99, { name: 'Updated' })).rejects.toThrow(NotFoundException);
    });

    it('should update and return provider', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      const updated = { ...DB_PROVIDER, name: 'Updated' };
      repo.updateProvider.mockResolvedValue(updated);
      const result = await service.updateProvider(1, { name: 'Updated' });
      expect(result).toEqual(updated);
      expect(factory.invalidateCache).toHaveBeenCalledWith(1);
    });

    it('should invalidate the provider cache only after the write commits', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      const order: string[] = [];
      repo.updateProvider.mockImplementation(() => {
        order.push('write');
        return Promise.resolve(DB_PROVIDER);
      });
      factory.invalidateCache.mockImplementation(() => {
        order.push('invalidate');
      });

      await service.updateProvider(1, { name: 'Updated' });
      expect(order).toEqual(['write', 'invalidate']);
    });

    it('should update staticVoices when provided', async () => {
      const staticVoices = [{ id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' }];
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      repo.updateProvider.mockResolvedValue({ ...DB_PROVIDER, staticVoices });
      await service.updateProvider(1, { staticVoices });
      expect(repo.updateProvider).toHaveBeenCalledWith(1, expect.objectContaining({ staticVoices }));
    });

    it('should clear staticVoices when empty array provided', async () => {
      repo.findProviderById.mockResolvedValue({
        ...DB_PROVIDER,
        staticVoices: [{ id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' }],
      });
      repo.updateProvider.mockResolvedValue({ ...DB_PROVIDER, staticVoices: [] });
      await service.updateProvider(1, { staticVoices: [] });
      expect(repo.updateProvider).toHaveBeenCalledWith(1, expect.objectContaining({ staticVoices: [] }));
    });

    it('should update supportsVoiceDiscovery to false', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      repo.updateProvider.mockResolvedValue({ ...DB_PROVIDER, supportsVoiceDiscovery: false });
      await service.updateProvider(1, { supportsVoiceDiscovery: false });
      expect(repo.updateProvider).toHaveBeenCalledWith(1, expect.objectContaining({ supportsVoiceDiscovery: false }));
    });

    it('should not include supportsVoiceDiscovery in update when not provided', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      repo.updateProvider.mockResolvedValue(DB_PROVIDER);
      await service.updateProvider(1, { name: 'Updated' });
      expect(repo.updateProvider).toHaveBeenCalledWith(1, expect.not.objectContaining({ supportsVoiceDiscovery: expect.anything() }));
    });
  });

  describe('deleteProvider', () => {
    it('should throw NotFoundException if provider not found', async () => {
      repo.findProviderById.mockResolvedValue(null);
      await expect(service.deleteProvider(99)).rejects.toThrow(NotFoundException);
    });

    it('should delete provider and invalidate cache', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      repo.deleteProvider.mockResolvedValue(undefined);
      await service.deleteProvider(1);
      expect(repo.deleteProvider).toHaveBeenCalledWith(1);
      expect(factory.invalidateCache).toHaveBeenCalledWith(1);
    });
  });

  describe('testProvider', () => {
    it('should return test result for existing provider', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      const openAiMock = {
        testConnection: vi.fn().mockResolvedValue({ connected: true }),
        listVoices: vi.fn().mockResolvedValue([{ id: 'v1' }, { id: 'v2' }]),
        synthesize: vi.fn(),
      };
      (factory.getOpenAiProvider as vi.Mock).mockReturnValue(openAiMock);

      const result = await service.testProvider(1);
      expect(result.connected).toBe(true);
      expect(result.voiceCount).toBe(2);
    });

    it('should return error result when connection fails', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      const openAiMock = {
        testConnection: vi.fn().mockResolvedValue({ connected: false, error: 'refused' }),
        listVoices: vi.fn(),
        synthesize: vi.fn(),
      };
      (factory.getOpenAiProvider as vi.Mock).mockReturnValue(openAiMock);

      const result = await service.testProvider(1);
      expect(result.connected).toBe(false);
    });

    it('should throw NotFoundException if provider not found', async () => {
      repo.findProviderById.mockResolvedValue(null);
      await expect(service.testProvider(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('discoverProviderVoices', () => {
    it('should throw NotFoundException when provider not found', async () => {
      repo.findProviderById.mockResolvedValue(null);
      await expect(service.discoverProviderVoices(99)).rejects.toThrow(NotFoundException);
    });

    it('should return {supported:false, voices:[]} immediately when supportsVoiceDiscovery is false, without calling fetch', async () => {
      repo.findProviderById.mockResolvedValue({ ...DB_PROVIDER, supportsVoiceDiscovery: false });
      const fetchSpy = vi.spyOn(global, 'fetch');

      const result = await service.discoverProviderVoices(1);
      expect(result.supported).toBe(false);
      expect(result.voices).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should return voices and supported=true when provider exposes /audio/voices', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ id: 'alloy', name: 'Alloy' }]),
      } as unknown as Response);

      const result = await service.discoverProviderVoices(1);
      expect(result.supported).toBe(true);
      expect(result.voices).toHaveLength(1);
      expect(result.voices[0]!.id).toBe('alloy');
    });

    it('should return empty voices and supported=false when provider returns 404', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
      } as unknown as Response);

      const result = await service.discoverProviderVoices(1);
      expect(result.supported).toBe(false);
      expect(result.voices).toEqual([]);
    });

    it('should throw BadGatewayException when provider is unreachable', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const { BadGatewayException } = await import('@nestjs/common');
      await expect(service.discoverProviderVoices(1)).rejects.toThrow(BadGatewayException);
    });

    it('should throw BadGatewayException on non-404 upstream error', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve('Service Unavailable'),
      } as unknown as Response);

      const { BadGatewayException } = await import('@nestjs/common');
      await expect(service.discoverProviderVoices(1)).rejects.toThrow(BadGatewayException);
    });

    it('should not use staticVoices for discovery (bypasses static fallback)', async () => {
      const providerWithStatic = {
        ...DB_PROVIDER,
        staticVoices: [{ id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' }],
      };
      repo.findProviderById.mockResolvedValue(providerWithStatic);
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
      } as unknown as Response);

      const result = await service.discoverProviderVoices(1);
      expect(result.supported).toBe(false);
      expect(result.voices).toEqual([]);
    });
  });
});
