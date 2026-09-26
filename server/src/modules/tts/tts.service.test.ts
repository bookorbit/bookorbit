import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { TtsChapterText, TtsEffectivePreferences } from '@bookorbit/types';
import { TtsService } from './tts.service';
import type { TtsRepository } from './tts.repository';
import type { TtsSynthesisService } from './tts-synthesis.service';
import type { TtsProviderFactory } from './providers/tts-provider.factory';
import type { BookService } from '../book/book.service';
import type { TtsTextExtractorService } from './tts-text-extractor.service';
import type { RequestUser } from '../../common/types/request-user';

const USER: RequestUser = { id: 42, isSuperuser: false, permissions: [], username: 'alice' };

function makeRepo() {
  return {
    findUserPreferences: vi.fn().mockResolvedValue(null),
    upsertUserPreferences: vi.fn().mockResolvedValue({ providerId: null, voiceId: null, speed: 1.0 }),
    findBookPreferences: vi.fn().mockResolvedValue(null),
    upsertBookPreferences: vi.fn().mockResolvedValue(undefined),
    deleteBookPreferences: vi.fn().mockResolvedValue(undefined),
    findPosition: vi.fn().mockResolvedValue(null),
    upsertPosition: vi.fn().mockResolvedValue(undefined),
    deletePosition: vi.fn().mockResolvedValue(undefined),
    findProviderById: vi.fn().mockResolvedValue(null),
    findEnabledProviders: vi.fn().mockResolvedValue([]),
  } as unknown as TtsRepository;
}

function makeSynthesis() {
  return {
    synthesize: vi.fn().mockResolvedValue(Buffer.from('audio')),
    previewVoice: vi.fn().mockResolvedValue(Buffer.from('preview')),
  } as unknown as TtsSynthesisService;
}

const OPENAI_PROVIDER_MOCK = {
  synthesize: vi.fn().mockResolvedValue(Buffer.from('openai-audio')),
  listVoices: vi.fn().mockResolvedValue([
    {
      id: 'alloy',
      name: 'Alloy',
      locale: 'en-US',
      gender: 'Neutral',
      language: 'English',
      shortName: 'alloy',
      providerId: '1',
      providerName: 'Kokoro',
    },
  ]),
  testConnection: vi.fn().mockResolvedValue({ connected: true }),
};

function makeFactory() {
  return {
    getOpenAiProvider: vi.fn().mockReturnValue(OPENAI_PROVIDER_MOCK),
    invalidateCache: vi.fn(),
  } as unknown as TtsProviderFactory;
}

function makeBookService() {
  return {
    verifyBookAccess: vi.fn().mockResolvedValue(undefined),
    verifyFileAccess: vi.fn().mockResolvedValue(undefined),
  } as unknown as BookService;
}

const CHAPTER_TEXT: TtsChapterText = { chapterIndex: 0, sentences: [{ text: 'Hello world', index: 0 }] };

function makeTextExtractor() {
  return {
    extractChapterText: vi.fn().mockResolvedValue(CHAPTER_TEXT),
  } as unknown as TtsTextExtractorService;
}

const DB_PROVIDER = {
  id: 1,
  name: 'Kokoro',
  type: 'openai-compatible',
  baseUrl: 'http://localhost:8880/v1',
  apiKey: null,
  defaultModel: null,
  enabled: true,
  displayOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('TtsService', () => {
  let service: TtsService;
  let repo: ReturnType<typeof makeRepo>;
  let synthesis: ReturnType<typeof makeSynthesis>;
  let factory: ReturnType<typeof makeFactory>;
  let bookService: ReturnType<typeof makeBookService>;
  let textExtractor: ReturnType<typeof makeTextExtractor>;

  beforeEach(() => {
    repo = makeRepo();
    synthesis = makeSynthesis();
    factory = makeFactory();
    bookService = makeBookService();
    textExtractor = makeTextExtractor();
    service = new TtsService(repo, synthesis, factory, bookService, textExtractor);
  });

  describe('synthesize', () => {
    it('should use OpenAI provider for numeric providerId', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      await service.synthesize({ providerId: '1', voiceId: 'alloy', text: 'Hello', speed: 1.0 });
      expect(factory.getOpenAiProvider).toHaveBeenCalledWith(DB_PROVIDER);
      expect(synthesis.synthesize).toHaveBeenCalledWith(OPENAI_PROVIDER_MOCK, '1', 'alloy', 1.0, 'Hello', 'mp3');
    });

    it('should trim voiceId before synthesis', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      await service.synthesize({ providerId: '1', voiceId: '  alloy  ', text: 'Hello', speed: 1.0 });
      expect(synthesis.synthesize).toHaveBeenCalledWith(OPENAI_PROVIDER_MOCK, '1', 'alloy', 1.0, 'Hello', 'mp3');
    });

    it('should fall back to the first listed voice when voiceId is missing', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      await service.synthesize({ providerId: '1', voiceId: '', text: 'Hello', speed: 1.0 });
      expect(synthesis.synthesize).toHaveBeenCalledWith(OPENAI_PROVIDER_MOCK, '1', 'alloy', 1.0, 'Hello', 'mp3');
    });

    it('should throw NotFoundException when no fallback voices are available', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      (factory.getOpenAiProvider as vi.Mock).mockReturnValue({
        ...OPENAI_PROVIDER_MOCK,
        listVoices: vi.fn().mockResolvedValue([]),
      });
      await expect(service.synthesize({ providerId: '1', voiceId: '', text: 'Hello', speed: 1.0 })).rejects.toThrow(NotFoundException);
      expect(synthesis.synthesize).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for disabled provider', async () => {
      repo.findProviderById.mockResolvedValue({ ...DB_PROVIDER, enabled: false });
      await expect(service.synthesize({ providerId: '1', voiceId: 'alloy', text: 'Hello', speed: 1.0 })).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for unknown provider', async () => {
      repo.findProviderById.mockResolvedValue(null);
      await expect(service.synthesize({ providerId: '999', voiceId: 'alloy', text: 'Hello', speed: 1.0 })).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for invalid provider string', async () => {
      await expect(service.synthesize({ providerId: 'bad-id', voiceId: 'v', text: 'Hello', speed: 1.0 })).rejects.toThrow(NotFoundException);
    });
  });

  describe('getVoices', () => {
    it('should return all voices from all enabled providers', async () => {
      repo.findEnabledProviders.mockResolvedValue([DB_PROVIDER]);
      const voices = await service.getVoices();
      expect(voices.length).toBeGreaterThan(0);
    });

    it('should return only the requested provider voices', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      const voices = await service.getVoices('1');
      expect(voices.map((v) => v.id)).toEqual(['alloy']);
    });

    it('should throw NotFoundException when the requested provider is disabled', async () => {
      repo.findProviderById.mockResolvedValue({ ...DB_PROVIDER, enabled: false });
      await expect(service.getVoices('1')).rejects.toThrow(NotFoundException);
    });

    it('should skip providers that fail to list voices', async () => {
      repo.findEnabledProviders.mockResolvedValue([DB_PROVIDER]);
      (factory.getOpenAiProvider as vi.Mock).mockReturnValue({
        listVoices: vi.fn().mockRejectedValue(new Error('timeout')),
      });
      const voices = await service.getVoices();
      expect(voices).toEqual([]);
    });
  });

  describe('getEffectiveBookPreferences', () => {
    it('should return user defaults when no book override exists', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      repo.findUserPreferences.mockResolvedValue({ providerId: 1, voiceId: 'alloy', speed: 1.25 });
      repo.findBookPreferences.mockResolvedValue(null);

      const result: TtsEffectivePreferences = await service.getEffectiveBookPreferences(USER.id, 1, USER);
      expect(result.isBookOverride).toBe(false);
      expect(result.voiceId).toBe('alloy');
      expect(result.speed).toBe(1.25);
    });

    it('should return book override when it exists', async () => {
      repo.findUserPreferences.mockResolvedValue({ providerId: 1, voiceId: 'default-voice', speed: 1.0 });
      repo.findBookPreferences.mockResolvedValue({ providerId: 1, voiceId: 'book-voice', speed: 1.5 });

      const result: TtsEffectivePreferences = await service.getEffectiveBookPreferences(USER.id, 1, USER);
      expect(result.isBookOverride).toBe(true);
      expect(result.providerId).toBe('1');
      expect(result.voiceId).toBe('book-voice');
      expect(result.speed).toBe(1.5);
    });

    it('should fall back to user provider when book override has null providerId', async () => {
      repo.findUserPreferences.mockResolvedValue({ providerId: 1, voiceId: null, speed: 1.0 });
      repo.findBookPreferences.mockResolvedValue({ providerId: null, voiceId: 'book-voice', speed: 1.0 });

      const result: TtsEffectivePreferences = await service.getEffectiveBookPreferences(USER.id, 1, USER);
      expect(result.providerId).toBe('1');
      expect(result.isBookOverride).toBe(true);
    });

    it('should return null providerId when both book and user have no provider', async () => {
      repo.findUserPreferences.mockResolvedValue({ providerId: null, voiceId: null, speed: 1.0 });
      repo.findBookPreferences.mockResolvedValue(null);

      const result: TtsEffectivePreferences = await service.getEffectiveBookPreferences(USER.id, 1, USER);
      expect(result.providerId).toBeNull();
    });

    it('should return null providerId when userPrefs is undefined (no prefs saved)', async () => {
      repo.findUserPreferences.mockResolvedValue(undefined);
      repo.findBookPreferences.mockResolvedValue(null);

      const result: TtsEffectivePreferences = await service.getEffectiveBookPreferences(USER.id, 1, USER);
      expect(result.providerId).toBeNull();
      expect(result.voiceId).toBeNull();
      expect(result.speed).toBe(1.0);
    });

    it('should drop a saved voice that no longer names a provider', async () => {
      repo.findUserPreferences.mockResolvedValue(undefined);
      repo.findBookPreferences.mockResolvedValue({ providerId: null, voiceId: 'alloy', speed: 1.5 });

      const result: TtsEffectivePreferences = await service.getEffectiveBookPreferences(USER.id, 1, USER);
      expect(result.providerId).toBeNull();
      expect(result.voiceId).toBeNull();
      expect(result.isBookOverride).toBe(true);
    });

    it('should clear a curated-out voice from effective preferences', async () => {
      repo.findProviderById.mockResolvedValue({
        ...DB_PROVIDER,
        staticVoices: [{ id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' }],
      });
      repo.findUserPreferences.mockResolvedValue({ providerId: 1, voiceId: 'af_jadzia', speed: 1.0 });
      repo.findBookPreferences.mockResolvedValue(null);

      const result: TtsEffectivePreferences = await service.getEffectiveBookPreferences(USER.id, 1, USER);
      expect(result.providerId).toBe('1');
      expect(result.voiceId).toBeNull();
      expect(result.speed).toBe(1.0);
    });

    it('should propagate ForbiddenException from bookService.verifyBookAccess', async () => {
      bookService.verifyBookAccess.mockRejectedValue(new Error('Forbidden'));
      await expect(service.getEffectiveBookPreferences(USER.id, 99, USER)).rejects.toThrow('Forbidden');
    });
  });

  describe('getUserPreferences', () => {
    it('should return null when no preferences exist', async () => {
      repo.findUserPreferences.mockResolvedValue(null);
      const result = await service.getUserPreferences(42);
      expect(result).toBeNull();
    });

    it('should map numeric providerId to string', async () => {
      repo.findUserPreferences.mockResolvedValue({ providerId: 7, voiceId: 'alloy', speed: 1.5 });
      const result = await service.getUserPreferences(42);
      expect(result).toEqual({ providerId: '7', voiceId: 'alloy', speed: 1.5 });
    });

    it('should return null providerId when DB has null', async () => {
      repo.findUserPreferences.mockResolvedValue({ providerId: null, voiceId: null, speed: 1.0 });
      const result = await service.getUserPreferences(42);
      expect(result?.providerId).toBeNull();
    });

    it('should drop a saved voice that has no provider left to resolve it', async () => {
      repo.findUserPreferences.mockResolvedValue({ providerId: null, voiceId: 'alloy', speed: 1.25 });

      const result = await service.getUserPreferences(42);
      expect(result).toEqual({ providerId: null, voiceId: null, speed: 1.25 });
    });
  });

  describe('curated voice enforcement', () => {
    const CURATED = [
      { id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' },
      { id: 'am_adam', name: 'Adam', shortName: 'am_adam', language: 'English', locale: 'en-US', gender: 'Male' },
    ];

    function curateProvider() {
      repo.findProviderById.mockResolvedValue({ ...DB_PROVIDER, staticVoices: CURATED });
    }

    it('synthesizes a curated voice', async () => {
      curateProvider();
      await service.synthesize({ providerId: '1', voiceId: 'af_heart', text: 'Hello', speed: 1.0 });
      expect(synthesis.synthesize).toHaveBeenCalledWith(OPENAI_PROVIDER_MOCK, '1', 'af_heart', 1.0, 'Hello', 'mp3');
    });

    it('rejects a voice curation has withdrawn', async () => {
      curateProvider();
      await expect(service.synthesize({ providerId: '1', voiceId: 'af_jadzia', text: 'Hello', speed: 1.0 })).rejects.toThrow(BadRequestException);
      expect(synthesis.synthesize).not.toHaveBeenCalled();
    });

    it('rejects a withdrawn voice on preview too', async () => {
      curateProvider();
      await expect(service.previewVoice('1', 'af_jadzia')).rejects.toThrow(BadRequestException);
      expect(synthesis.previewVoice).not.toHaveBeenCalled();
    });

    it('accepts any voice id when the provider is not curated', async () => {
      repo.findProviderById.mockResolvedValue({ ...DB_PROVIDER, staticVoices: null });
      await service.synthesize({ providerId: '1', voiceId: 'af_sky+af_bella', text: 'Hello', speed: 1.0 });
      expect(synthesis.synthesize).toHaveBeenCalledWith(OPENAI_PROVIDER_MOCK, '1', 'af_sky+af_bella', 1.0, 'Hello', 'mp3');
    });

    it('clears a withdrawn voice from saved preferences', async () => {
      curateProvider();
      repo.findUserPreferences.mockResolvedValue({ providerId: 1, voiceId: 'af_jadzia', speed: 1.25 });

      const result = await service.getUserPreferences(42);
      expect(result).toEqual({ providerId: '1', voiceId: null, speed: 1.25 });
    });

    it('keeps a curated voice in saved preferences', async () => {
      curateProvider();
      repo.findUserPreferences.mockResolvedValue({ providerId: 1, voiceId: 'am_adam', speed: 1.25 });

      const result = await service.getUserPreferences(42);
      expect(result).toEqual({ providerId: '1', voiceId: 'am_adam', speed: 1.25 });
    });

    it('leaves preferences alone for an uncurated provider', async () => {
      repo.findProviderById.mockResolvedValue({ ...DB_PROVIDER, staticVoices: [] });
      repo.findUserPreferences.mockResolvedValue({ providerId: 1, voiceId: 'af_sky+af_bella', speed: 1.0 });

      const result = await service.getUserPreferences(42);
      expect(result).toEqual({ providerId: '1', voiceId: 'af_sky+af_bella', speed: 1.0 });
    });
  });

  describe('saveUserPreferences', () => {
    it('should call repo with correct shape', async () => {
      await service.saveUserPreferences(42, { providerId: '1', voiceId: 'alloy', speed: 1.5 });
      expect(repo.upsertUserPreferences).toHaveBeenCalledWith(42, {
        providerId: 1,
        voiceId: 'alloy',
        speed: 1.5,
      });
    });

    it('should store a null providerId for an unparseable provider', async () => {
      await service.saveUserPreferences(42, { providerId: 'bad-id', voiceId: 'alloy', speed: 1.5 });
      expect(repo.upsertUserPreferences).toHaveBeenCalledWith(42, {
        providerId: null,
        voiceId: 'alloy',
        speed: 1.5,
      });
    });

    it('should handle partial preferences update', async () => {
      await service.saveUserPreferences(42, { speed: 2.0 });
      expect(repo.upsertUserPreferences).toHaveBeenCalledWith(42, { speed: 2.0 });
    });

    it('should return mapped TtsUserPreferences with string providerId', async () => {
      repo.upsertUserPreferences.mockResolvedValue({ providerId: 3, voiceId: 'alloy', speed: 1.25 });
      const result = await service.saveUserPreferences(42, { providerId: '3', voiceId: 'alloy', speed: 1.25 });
      expect(result).toEqual({ providerId: '3', voiceId: 'alloy', speed: 1.25 });
    });
  });

  describe('TTS position', () => {
    it('should save position after verifying file access', async () => {
      await service.savePosition(42, 10, { cfi: 'epubcfi(/6/2!)', chapterIndex: 3 }, USER);
      expect(bookService.verifyFileAccess).toHaveBeenCalledWith(10, USER);
      expect(repo.upsertPosition).toHaveBeenCalledWith(42, 10, 'epubcfi(/6/2!)', 3);
    });

    it('should delete position after verifying file access', async () => {
      await service.deletePosition(42, 10, USER);
      expect(bookService.verifyFileAccess).toHaveBeenCalledWith(10, USER);
      expect(repo.deletePosition).toHaveBeenCalledWith(42, 10);
    });

    it('should get position after verifying file access', async () => {
      repo.findPosition.mockResolvedValue({ cfi: 'epubcfi(/6/2!)', chapterIndex: 3 });
      const result = await service.getPosition(42, 10, USER);
      expect(bookService.verifyFileAccess).toHaveBeenCalledWith(10, USER);
      expect(result).toEqual({ cfi: 'epubcfi(/6/2!)', chapterIndex: 3 });
    });
  });

  describe('getAvailableProviderInfos', () => {
    it('should return an empty list when nothing is enabled', async () => {
      repo.findEnabledProviders.mockResolvedValue([]);
      const infos = await service.getAvailableProviderInfos();
      expect(infos).toEqual([]);
    });

    it('should return enabled providers in the order the repository gives them', async () => {
      repo.findEnabledProviders.mockResolvedValue([
        { ...DB_PROVIDER, id: 2, name: 'Piper', displayOrder: 0 },
        { ...DB_PROVIDER, id: 1, name: 'Kokoro', displayOrder: 1 },
      ]);

      const infos = await service.getAvailableProviderInfos();

      expect(infos).toEqual([
        { id: '2', name: 'Piper', type: 'openai-compatible' },
        { id: '1', name: 'Kokoro', type: 'openai-compatible' },
      ]);
    });
  });

  describe('getChapterText', () => {
    it('should verify file access before extracting text', async () => {
      const result = await service.getChapterText(10, 0, USER);
      expect(bookService.verifyFileAccess).toHaveBeenCalledWith(10, USER);
      expect(textExtractor.extractChapterText).toHaveBeenCalledWith(10, 0);
      expect(result).toEqual(CHAPTER_TEXT);
    });

    it('should propagate ForbiddenException when user does not own the file', async () => {
      const { ForbiddenException } = await import('@nestjs/common');
      bookService.verifyFileAccess.mockRejectedValue(new ForbiddenException());
      await expect(service.getChapterText(10, 0, USER)).rejects.toThrow(ForbiddenException);
      expect(textExtractor.extractChapterText).not.toHaveBeenCalled();
    });

    it('should propagate NotFoundException from extractor when chapter not found', async () => {
      textExtractor.extractChapterText.mockRejectedValue(new NotFoundException('Chapter 99 not found'));
      await expect(service.getChapterText(10, 99, USER)).rejects.toThrow(NotFoundException);
    });
  });
});
