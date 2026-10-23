import { EventEmitter } from 'events';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { TtsController } from './tts.controller';
import { TtsService } from './tts.service';
import type { RequestUser } from '../../common/types/request-user';

const USER: RequestUser = { id: 42, isSuperuser: false, permissions: [], username: 'alice' };

const mockTtsService = {
  synthesize: vi.fn().mockResolvedValue(Buffer.from('audio')),
  synthesizeCaptioned: vi.fn().mockResolvedValue({ audio: '', format: 'mp3', words: [] }),
  previewVoice: vi.fn().mockResolvedValue(Buffer.from('preview')),
  getVoices: vi.fn().mockResolvedValue([]),
  getAvailableProviderInfos: vi.fn().mockResolvedValue([]),
  getUserPreferences: vi.fn().mockResolvedValue(null),
  saveUserPreferences: vi.fn().mockResolvedValue({ voiceId: null, providerId: null, speed: 1.0 }),
  getEffectiveBookPreferences: vi.fn().mockResolvedValue({ voiceId: null, providerId: null, speed: 1.0, isBookOverride: false }),
  saveBookPreferences: vi.fn().mockResolvedValue(undefined),
  deleteBookPreferences: vi.fn().mockResolvedValue(undefined),
  getPosition: vi.fn().mockResolvedValue(null),
  savePosition: vi.fn().mockResolvedValue(undefined),
  deletePosition: vi.fn().mockResolvedValue(undefined),
  getChapterText: vi.fn().mockResolvedValue({ chapterIndex: 0, sentences: [] }),
};

describe('TtsController', () => {
  let controller: TtsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TtsController],
      providers: [{ provide: TtsService, useValue: mockTtsService }],
    }).compile();

    controller = module.get<TtsController>(TtsController);
    vi.clearAllMocks();
  });

  describe('synthesize', () => {
    const dto = { text: 'Hello', providerId: '1', voiceId: 'af_heart', speed: 1.0 };

    function makeReply() {
      const raw = Object.assign(new EventEmitter(), { writableEnded: false });
      const reply = {
        raw,
        header: vi.fn().mockReturnThis(),
        send: vi.fn().mockImplementation(() => {
          raw.writableEnded = true;
          return reply;
        }),
      };
      return reply;
    }

    function holdSynthesisUntilAborted(): { signal: () => AbortSignal } {
      let captured: AbortSignal | undefined;
      mockTtsService.synthesize.mockImplementationOnce(
        (_dto: unknown, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            captured = signal;
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      );
      return { signal: () => captured! };
    }

    it('sends the synthesized audio with its content type', async () => {
      const reply = makeReply();
      await controller.synthesize(dto, reply as unknown as FastifyReply);

      expect(reply.header).toHaveBeenCalledWith('Content-Type', 'audio/mpeg');
      expect(reply.send).toHaveBeenCalledWith(Buffer.from('audio'));
      expect(reply.raw.listenerCount('close')).toBe(0);
    });

    it('cancels the synthesis and sends nothing when the client disconnects first', async () => {
      const reply = makeReply();
      const held = holdSynthesisUntilAborted();
      const pending = controller.synthesize(dto, reply as unknown as FastifyReply);
      expect(held.signal().aborted).toBe(false);

      reply.raw.emit('close');

      await expect(pending).resolves.toBeUndefined();
      expect(held.signal().aborted).toBe(true);
      expect(reply.send).not.toHaveBeenCalled();
      expect(reply.raw.listenerCount('close')).toBe(0);
    });

    it('does not cancel when the connection closes after the audio was sent', async () => {
      const reply = makeReply();
      const pending = controller.synthesize(dto, reply as unknown as FastifyReply);
      const signal = mockTtsService.synthesize.mock.calls[0]![1] as AbortSignal;
      await pending;

      reply.raw.writableEnded = true;
      reply.raw.emit('close');

      expect(signal.aborted).toBe(false);
    });

    it('rethrows a synthesis failure while the client is still connected', async () => {
      mockTtsService.synthesize.mockRejectedValueOnce(new Error('provider down'));
      const reply = makeReply();

      await expect(controller.synthesize(dto, reply as unknown as FastifyReply)).rejects.toThrow('provider down');
      expect(reply.raw.listenerCount('close')).toBe(0);
    });
  });

  describe('synthesizeCaptioned', () => {
    it('returns base64 audio with word timings as JSON, not raw bytes', async () => {
      const payload = {
        audio: Buffer.from('captioned-audio').toString('base64'),
        format: 'mp3',
        words: [{ word: 'Hello', startTime: 0, endTime: 0.3 }],
      };
      mockTtsService.synthesizeCaptioned.mockResolvedValue(payload);

      const dto = { text: 'Hello', providerId: '1', voiceId: 'af_heart', speed: 1.0 };
      const result = await controller.synthesizeCaptioned(dto);

      expect(mockTtsService.synthesizeCaptioned).toHaveBeenCalledWith(dto);
      expect(result).toEqual(payload);
    });
  });

  describe('getVoices', () => {
    it('should call ttsService.getVoices without filter', async () => {
      mockTtsService.getVoices.mockResolvedValue([{ id: 'v1' }]);
      const result = await controller.getVoices();
      expect(mockTtsService.getVoices).toHaveBeenCalledWith(undefined);
      expect(result).toEqual([{ id: 'v1' }]);
    });

    it('should call ttsService.getVoices with providerId filter', async () => {
      await controller.getVoices('1');
      expect(mockTtsService.getVoices).toHaveBeenCalledWith('1');
    });
  });

  describe('getProviders', () => {
    it('should return provider infos', async () => {
      mockTtsService.getAvailableProviderInfos.mockResolvedValue([{ id: '1', name: 'Kokoro', type: 'openai-compatible' }]);
      const result = await controller.getProviders();
      expect(result).toEqual([{ id: '1', name: 'Kokoro', type: 'openai-compatible' }]);
    });
  });

  describe('getUserPreferences', () => {
    it('should return user preferences', async () => {
      mockTtsService.getUserPreferences.mockResolvedValue({ voiceId: 'jenny', providerId: null, speed: 1.25 });
      const result = await controller.getUserPreferences(USER);
      expect(result).toEqual({ voiceId: 'jenny', providerId: null, speed: 1.25 });
    });

    it('should return null if no prefs set', async () => {
      mockTtsService.getUserPreferences.mockResolvedValue(null);
      const result = await controller.getUserPreferences(USER);
      expect(result).toBeNull();
    });
  });

  describe('saveUserPreferences', () => {
    it('should save and return updated preferences', async () => {
      const dto = { voiceId: 'jenny', speed: 1.5 };
      const result = await controller.saveUserPreferences(dto, USER);
      expect(mockTtsService.saveUserPreferences).toHaveBeenCalledWith(USER.id, dto);
      expect(result).toBeDefined();
    });
  });

  describe('getBookPreferences', () => {
    it('should return effective book preferences', async () => {
      mockTtsService.getEffectiveBookPreferences.mockResolvedValue({ voiceId: 'book-voice', providerId: null, speed: 1.0, isBookOverride: true });
      const result = await controller.getBookPreferences(1, USER);
      expect(mockTtsService.getEffectiveBookPreferences).toHaveBeenCalledWith(USER.id, 1, USER);
      expect(result).toMatchObject({ isBookOverride: true });
    });

    it('should propagate NotFoundException from service', async () => {
      mockTtsService.getEffectiveBookPreferences.mockRejectedValue(new NotFoundException());
      await expect(controller.getBookPreferences(99, USER)).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteBookPreferences', () => {
    it('should delete book preferences', async () => {
      await controller.deleteBookPreferences(1, USER);
      expect(mockTtsService.deleteBookPreferences).toHaveBeenCalledWith(USER.id, 1, USER);
    });
  });

  describe('getPosition', () => {
    it('should return null if no position saved', async () => {
      mockTtsService.getPosition.mockResolvedValue(null);
      const result = await controller.getPosition(10, USER);
      expect(result).toBeNull();
    });

    it('should return saved position', async () => {
      mockTtsService.getPosition.mockResolvedValue({ cfi: 'epubcfi(/6/2!)', chapterIndex: 2 });
      const result = await controller.getPosition(10, USER);
      expect(result).toEqual({ cfi: 'epubcfi(/6/2!)', chapterIndex: 2 });
    });
  });

  describe('savePosition', () => {
    it('should save position', async () => {
      const dto = { cfi: 'epubcfi(/6/2!)', chapterIndex: 2 };
      await controller.savePosition(10, dto, USER);
      expect(mockTtsService.savePosition).toHaveBeenCalledWith(USER.id, 10, dto, USER);
    });
  });

  describe('deletePosition', () => {
    it('should delete position', async () => {
      await controller.deletePosition(10, USER);
      expect(mockTtsService.deletePosition).toHaveBeenCalledWith(USER.id, 10, USER);
    });
  });

  describe('getChapterText', () => {
    it('should call ttsService.getChapterText with user for access control', async () => {
      mockTtsService.getChapterText.mockResolvedValue({ chapterIndex: 3, sentences: [{ text: 'Hello', index: 0 }] });
      const result = await controller.getChapterText(10, 3, USER);
      expect(mockTtsService.getChapterText).toHaveBeenCalledWith(10, 3, USER);
      expect(result).toMatchObject({ chapterIndex: 3 });
    });

    it('should propagate ForbiddenException from access check', async () => {
      const { ForbiddenException } = await import('@nestjs/common');
      mockTtsService.getChapterText.mockRejectedValue(new ForbiddenException());
      await expect(controller.getChapterText(10, 3, USER)).rejects.toThrow(ForbiddenException);
    });
  });
});
