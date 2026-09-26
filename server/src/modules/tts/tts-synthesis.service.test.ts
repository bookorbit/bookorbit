import { TtsSynthesisService } from './tts-synthesis.service';
import type { ITtsProvider } from './providers/tts-provider.interface';

function makeProvider(): ITtsProvider {
  return {
    synthesize: vi.fn().mockResolvedValue(Buffer.from('audio-data')),
    listVoices: vi.fn().mockResolvedValue([]),
    testConnection: vi.fn().mockResolvedValue({ connected: true }),
  };
}

describe('TtsSynthesisService', () => {
  let service: TtsSynthesisService;
  let provider: ITtsProvider;

  beforeEach(() => {
    service = new TtsSynthesisService();
    provider = makeProvider();
  });

  describe('synthesize', () => {
    it('should call provider.synthesize and return audio buffer', async () => {
      const result = await service.synthesize(provider, '1', 'af_heart', 1.0, 'Hello world', 'mp3');
      expect(result).toBeInstanceOf(Buffer);
      expect(provider.synthesize).toHaveBeenCalledWith('Hello world', 'af_heart', 1.0, 'mp3');
    });

    it('should cache the result with provider+voice+speed+text as key', async () => {
      await service.synthesize(provider, '1', 'af_heart', 1.0, 'Hello', 'mp3');
      await service.synthesize(provider, '1', 'af_heart', 1.0, 'Hello', 'mp3');
      expect(provider.synthesize).toHaveBeenCalledTimes(1);
    });

    it('should not use cache for different text', async () => {
      await service.synthesize(provider, '1', 'af_heart', 1.0, 'Hello', 'mp3');
      await service.synthesize(provider, '1', 'af_heart', 1.0, 'World', 'mp3');
      expect(provider.synthesize).toHaveBeenCalledTimes(2);
    });

    it('should not use cache for different voice', async () => {
      await service.synthesize(provider, '1', 'af_heart', 1.0, 'Hello', 'mp3');
      await service.synthesize(provider, '1', 'af_bella', 1.0, 'Hello', 'mp3');
      expect(provider.synthesize).toHaveBeenCalledTimes(2);
    });

    it('should not use cache for different speed', async () => {
      await service.synthesize(provider, '1', 'af_heart', 1.0, 'Hello', 'mp3');
      await service.synthesize(provider, '1', 'af_heart', 1.5, 'Hello', 'mp3');
      expect(provider.synthesize).toHaveBeenCalledTimes(2);
    });

    it('should propagate provider errors', async () => {
      (provider.synthesize as vi.Mock).mockRejectedValue(new Error('synthesis failed'));
      await expect(service.synthesize(provider, '1', 'jenny', 1.0, 'text', 'mp3')).rejects.toThrow('synthesis failed');
    });
  });

  describe('synthesizeCaptioned', () => {
    function makeCaptionedProvider(): ITtsProvider {
      return {
        ...makeProvider(),
        synthesizeCaptioned: vi.fn().mockResolvedValue({
          audio: Buffer.from('captioned-audio'),
          words: [{ word: 'Hello', startTime: 0, endTime: 0.3 }],
        }),
      };
    }

    it('returns the provider audio together with its word timings', async () => {
      const captioned = makeCaptionedProvider();

      const result = await service.synthesizeCaptioned(captioned, '1', 'af_heart', 1.0, 'Hello', 'mp3');

      expect(result.buffer.toString()).toBe('captioned-audio');
      expect(result.words).toEqual([{ word: 'Hello', startTime: 0, endTime: 0.3 }]);
      expect(captioned.synthesizeCaptioned).toHaveBeenCalledWith('Hello', 'af_heart', 1.0, 'mp3');
    });

    it('caches captioned results separately from audio-only ones', async () => {
      const captioned = makeCaptionedProvider();

      await service.synthesizeCaptioned(captioned, '1', 'af_heart', 1.0, 'Hello', 'mp3');
      await service.synthesizeCaptioned(captioned, '1', 'af_heart', 1.0, 'Hello', 'mp3');

      expect(captioned.synthesizeCaptioned).toHaveBeenCalledTimes(1);
      expect(service.getCaptionedCacheSize()).toBe(1);
      // The audio-only cache is untouched, so a later plain synthesis cannot pick up a captioned
      // entry or the other way round.
      expect(service.getCacheSize()).toBe(0);
    });

    it('falls back to plain synthesis when the provider cannot caption', async () => {
      const provider = makeProvider();

      const result = await service.synthesizeCaptioned(provider, '1', 'jenny', 1.0, 'Hello', 'mp3');

      expect(result.buffer.toString()).toBe('audio-data');
      expect(result.words).toEqual([]);
      expect(provider.synthesize).toHaveBeenCalledTimes(1);
    });

    it('falls back to plain synthesis when the provider declines at request time', async () => {
      const declining: ITtsProvider = { ...makeProvider(), synthesizeCaptioned: vi.fn().mockResolvedValue(null) };

      const result = await service.synthesizeCaptioned(declining, '1', 'af_heart', 1.0, 'Hello', 'mp3');

      expect(result.buffer.toString()).toBe('audio-data');
      expect(result.words).toEqual([]);
      expect(declining.synthesize).toHaveBeenCalledTimes(1);
    });

    it('falls back to plain synthesis when captioned synthesis fails', async () => {
      const failing: ITtsProvider = { ...makeProvider(), synthesizeCaptioned: vi.fn().mockRejectedValue(new Error('captioned failed')) };

      const result = await service.synthesizeCaptioned(failing, '1', 'af_heart', 1.0, 'Hello', 'mp3');

      expect(result.buffer.toString()).toBe('audio-data');
      expect(result.words).toEqual([]);
      expect(failing.synthesize).toHaveBeenCalledTimes(1);
    });

    it('caches the plain fallback after captioned synthesis fails', async () => {
      const failing: ITtsProvider = { ...makeProvider(), synthesizeCaptioned: vi.fn().mockRejectedValue(new Error('captioned failed')) };

      await service.synthesizeCaptioned(failing, '1', 'af_heart', 1.0, 'Hello', 'mp3');
      await service.synthesizeCaptioned(failing, '1', 'af_heart', 1.0, 'Hello', 'mp3');

      expect(failing.synthesizeCaptioned).toHaveBeenCalledTimes(1);
      expect(failing.synthesize).toHaveBeenCalledTimes(1);
      expect(service.getCaptionedCacheSize()).toBe(1);
    });

    it('propagates a plain synthesis failure after captioned synthesis fails', async () => {
      const failing: ITtsProvider = {
        ...makeProvider(),
        synthesize: vi.fn().mockRejectedValue(new Error('plain failed')),
        synthesizeCaptioned: vi.fn().mockRejectedValue(new Error('captioned failed')),
      };

      await expect(service.synthesizeCaptioned(failing, '1', 'af_heart', 1.0, 'Hello', 'mp3')).rejects.toThrow('plain failed');
    });
  });

  describe('previewVoice', () => {
    it('should synthesize a preview sentence', async () => {
      const result = await service.previewVoice(provider, '1', 'af_heart');
      expect(result).toBeInstanceOf(Buffer);
      expect(provider.synthesize).toHaveBeenCalledWith(expect.any(String), 'af_heart', 1.0, 'mp3');
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entry when cache is full', async () => {
      const smallService = new TtsSynthesisService(3);
      const p1 = makeProvider();
      const p2 = makeProvider();
      const p3 = makeProvider();
      const p4 = makeProvider();

      await smallService.synthesize(p1, '1', 'jenny', 1.0, 'text-1', 'mp3');
      await smallService.synthesize(p2, '1', 'jenny', 1.0, 'text-2', 'mp3');
      await smallService.synthesize(p3, '1', 'jenny', 1.0, 'text-3', 'mp3');
      expect(smallService.getCacheSize()).toBe(3);

      await smallService.synthesize(p4, '1', 'jenny', 1.0, 'text-4', 'mp3');
      expect(smallService.getCacheSize()).toBe(3);
    });

    it('should clear cache on clearCache()', async () => {
      await service.synthesize(provider, '1', 'jenny', 1.0, 'Hello', 'mp3');
      expect(service.getCacheSize()).toBe(1);
      service.clearCache();
      expect(service.getCacheSize()).toBe(0);
    });
  });
});
