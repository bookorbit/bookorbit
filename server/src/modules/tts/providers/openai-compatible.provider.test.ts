import { vi, describe, it, expect, beforeEach } from 'vitest';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';
import type { StaticVoiceConfig } from './openai-compatible.provider';

const STATIC_VOICES: StaticVoiceConfig[] = [
  { id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' },
  { id: 'am_adam', name: 'Adam', shortName: 'am_adam', language: 'English', locale: 'en-US', gender: 'Male' },
];

function makeProvider(
  overrides: Partial<{
    defaultModel: string | null;
    apiKey: string;
    baseUrl: string;
    staticVoices: StaticVoiceConfig[] | null;
    supportsVoiceDiscovery: boolean;
  }> = {},
) {
  return new OpenAiCompatibleProvider({
    providerId: '1',
    providerName: 'Test Provider',
    baseUrl: overrides.baseUrl ?? 'http://localhost:8880/v1',
    apiKey: overrides.apiKey ?? '',
    defaultModel: overrides.defaultModel,
    staticVoices: overrides.staticVoices,
    supportsVoiceDiscovery: overrides.supportsVoiceDiscovery,
  });
}

function mockFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    text: () => Promise.resolve(typeof body === 'string' ? body : ''),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('OpenAiCompatibleProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('defaultModel', () => {
    it('uses tts-1 when defaultModel is not set', async () => {
      const provider = makeProvider();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse(null));

      await provider.synthesize('hello', 'alloy', 1.0, 'mp3');

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.model).toBe('tts-1');
    });

    it('uses configured defaultModel in synthesis request', async () => {
      const provider = makeProvider({ defaultModel: 'kokoro' });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse(null));

      await provider.synthesize('hello', 'af_sky', 1.0, 'mp3');

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.model).toBe('kokoro');
    });

    it('falls back to tts-1 when defaultModel is null', async () => {
      const provider = makeProvider({ defaultModel: null });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse(null));

      await provider.synthesize('hello', 'alloy', 1.0, 'mp3');

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.model).toBe('tts-1');
    });
  });

  describe('synthesize', () => {
    it('clamps speed to 0.25 minimum', async () => {
      const provider = makeProvider();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse(null));

      await provider.synthesize('hello', 'alloy', 0.1, 'mp3');

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.speed).toBe(0.25);
    });

    it('clamps speed to 4.0 maximum', async () => {
      const provider = makeProvider();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse(null));

      await provider.synthesize('hello', 'alloy', 5.0, 'mp3');

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.speed).toBe(4.0);
    });

    it('includes Authorization header when apiKey is set', async () => {
      const provider = makeProvider({ apiKey: 'test-key' });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse(null));

      await provider.synthesize('hello', 'alloy', 1.0, 'mp3');

      const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-key');
    });

    it('omits Authorization header when apiKey is empty', async () => {
      const provider = makeProvider({ apiKey: '' });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse(null));

      await provider.synthesize('hello', 'alloy', 1.0, 'mp3');

      const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('throws when API returns non-ok response', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse('Internal Server Error', false, 500));

      await expect(provider.synthesize('hello', 'alloy', 1.0, 'mp3')).rejects.toThrow('TTS API error 500');
    });
  });

  describe('listVoices', () => {
    it('returns empty array when API returns 404 without static voices', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse('', false, 404));

      const voices = await provider.listVoices();
      expect(voices).toEqual([]);
    });

    it('returns static voices when API returns 404 and static voices are configured', async () => {
      const provider = makeProvider({ staticVoices: STATIC_VOICES });
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse('', false, 404));

      const voices = await provider.listVoices();
      expect(voices).toHaveLength(2);
      expect(voices[0]!.id).toBe('af_heart');
      expect(voices[0]!.providerId).toBe('1');
      expect(voices[0]!.providerName).toBe('Test Provider');
    });

    it('returns static voices on network error when static voices are configured', async () => {
      const provider = makeProvider({ staticVoices: STATIC_VOICES });
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const voices = await provider.listVoices();
      expect(voices).toHaveLength(2);
    });

    it('throws on network error when no static voices configured', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(provider.listVoices()).rejects.toThrow('ECONNREFUSED');
    });

    it('returns empty array when API returns 404', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse('', false, 404));

      const voices = await provider.listVoices();
      expect(voices).toEqual([]);
    });

    it('maps voices array response', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse([{ id: 'alloy', name: 'Alloy' }]));

      const voices = await provider.listVoices();
      expect(voices).toHaveLength(1);
      expect(voices[0]!.id).toBe('alloy');
      expect(voices[0]!.providerId).toBe('1');
    });

    it('maps nested voices object response', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({ voices: [{ voice_id: 'af_sky', display_name: 'Sky' }] }));

      const voices = await provider.listVoices();
      expect(voices).toHaveLength(1);
      expect(voices[0]!.id).toBe('af_sky');
      expect(voices[0]!.name).toBe('Sky');
    });

    it('maps nested Kokoro string voice entries with metadata', async () => {
      const provider = makeProvider({ defaultModel: 'kokoro' });
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({ voices: ['af_heart', 'am_adam'] }));

      const voices = await provider.listVoices();
      expect(voices).toHaveLength(2);
      expect(voices[0]).toMatchObject({
        id: 'af_heart',
        name: 'Heart',
        shortName: 'af_heart',
        language: 'English',
        locale: 'en-US',
        gender: 'Female',
      });
      expect(voices[1]).toMatchObject({
        id: 'am_adam',
        name: 'Adam',
        language: 'English',
        locale: 'en-US',
        gender: 'Male',
      });
    });

    it.each([
      ['bf_emma', 'en-GB', 'Female'],
      ['ef_dora', 'es-ES', 'Female'],
      ['ff_siwis', 'fr-FR', 'Female'],
      ['hm_omega', 'hi-IN', 'Male'],
      ['if_sara', 'it-IT', 'Female'],
      ['jm_kumo', 'ja-JP', 'Male'],
      ['pf_dora', 'pt-BR', 'Female'],
      ['zm_yunyang', 'zh-CN', 'Male'],
    ])('derives Kokoro metadata for %s', async (voiceId, locale, gender) => {
      const provider = makeProvider({ defaultModel: 'kokoro-v1.1' });
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({ voices: [voiceId] }));

      const voices = await provider.listVoices();
      expect(voices[0]).toMatchObject({ id: voiceId, locale, gender });
    });

    it('keeps safe defaults for an unknown Kokoro voice prefix', async () => {
      const provider = makeProvider({ defaultModel: 'kokoro' });
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({ voices: ['custom_voice'] }));

      const voices = await provider.listVoices();
      expect(voices[0]).toMatchObject({
        id: 'custom_voice',
        name: 'custom_voice',
        language: '',
        locale: '',
        gender: 'Unknown',
      });
    });

    it('does not derive Kokoro metadata for another model', async () => {
      const provider = makeProvider({ defaultModel: 'tts-1' });
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({ voices: ['af_heart'] }));

      const voices = await provider.listVoices();
      expect(voices[0]).toMatchObject({ id: 'af_heart', name: 'af_heart', language: '', locale: '', gender: 'Unknown' });
    });

    it('merges configured metadata into live string entries', async () => {
      const provider = makeProvider({
        defaultModel: 'kokoro',
        staticVoices: [{ ...STATIC_VOICES[0]!, name: 'Curated Heart', locale: 'en-CA' }],
      });
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({ voices: ['af_heart'] }));

      const voices = await provider.listVoices();
      expect(voices[0]).toMatchObject({
        id: 'af_heart',
        name: 'Curated Heart',
        language: 'English',
        locale: 'en-CA',
        gender: 'Female',
      });
    });

    it('keeps the curated name when the live listing names the voice after its id', async () => {
      // Kokoro answers /audio/voices with {id, name} where name is the id, so a provider that
      // trusted the live name would discard every name an admin had curated.
      const provider = makeProvider({
        defaultModel: 'kokoro',
        staticVoices: [{ ...STATIC_VOICES[0]!, name: 'Heart' }],
      });
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({ voices: [{ id: 'af_heart', name: 'af_heart' }] }));

      const voices = await provider.listVoices();
      expect(voices[0]!.name).toBe('Heart');
    });

    it('falls back to the live name for a voice the curation did not rename', async () => {
      const provider = makeProvider({
        defaultModel: 'kokoro',
        staticVoices: [{ ...STATIC_VOICES[0]!, id: 'af_bella', name: '', shortName: '' }],
      });
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({ voices: [{ id: 'af_bella', name: 'Bella Live' }] }));

      const voices = await provider.listVoices();
      expect(voices[0]!.name).toBe('Bella Live');
    });

    it('limits live voices to the curated ones', async () => {
      const provider = makeProvider({ defaultModel: 'kokoro', staticVoices: STATIC_VOICES });
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({ voices: ['af_heart', 'af_bella', 'am_adam', 'zm_yunyang'] }));

      const voices = await provider.listVoices();
      expect(voices.map((v) => v.id)).toEqual(['af_heart', 'am_adam']);
    });

    it('returns the live list unchanged when nothing is curated', async () => {
      const provider = makeProvider({ defaultModel: 'kokoro', staticVoices: [] });
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({ voices: ['af_heart', 'af_bella'] }));

      const voices = await provider.listVoices();
      expect(voices.map((v) => v.id)).toEqual(['af_heart', 'af_bella']);
    });

    it('keeps a curated voice the live listing does not report', async () => {
      const composite: StaticVoiceConfig = {
        id: 'af_sky+af_bella',
        name: 'Sky and Bella',
        shortName: 'af_sky+af_bella',
        language: 'English',
        locale: 'en-US',
        gender: 'Female',
      };
      const provider = makeProvider({ defaultModel: 'kokoro', staticVoices: [...STATIC_VOICES, composite] });
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({ voices: ['af_heart', 'af_bella', 'am_adam'] }));

      const voices = await provider.listVoices();
      expect(voices.map((v) => v.id)).toEqual(['af_heart', 'am_adam', 'af_sky+af_bella']);
      expect(voices[2]).toMatchObject({ name: 'Sky and Bella', locale: 'en-US', providerId: '1', providerName: 'Test Provider' });
    });

    it('skips curated entries without an id', async () => {
      const provider = makeProvider({
        defaultModel: 'kokoro',
        staticVoices: [{ id: '', name: 'Nameless', shortName: '', language: '', locale: '', gender: '' }, STATIC_VOICES[0]!],
      });
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({ voices: ['af_heart'] }));

      const voices = await provider.listVoices();
      expect(voices.map((v) => v.id)).toEqual(['af_heart']);
    });

    it('returns curated voices without a request when voice discovery is disabled', async () => {
      const provider = makeProvider({ staticVoices: STATIC_VOICES, supportsVoiceDiscovery: false });
      const fetchSpy = vi.spyOn(global, 'fetch');

      const voices = await provider.listVoices();
      expect(voices.map((v) => v.id)).toEqual(['af_heart', 'am_adam']);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('ignores malformed voice entries', async () => {
      const provider = makeProvider({ defaultModel: 'kokoro' });
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({ voices: [null, 42, '', {}, { id: 'af_sky' }] }));

      const voices = await provider.listVoices();
      expect(voices).toHaveLength(1);
      expect(voices[0]!.id).toBe('af_sky');
    });

    it('strips trailing slash from baseUrl', async () => {
      const provider = makeProvider({ baseUrl: 'http://localhost:8880/v1/' });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse([]));

      await provider.listVoices();

      const url = fetchSpy.mock.calls[0]![0] as string;
      expect(url).toBe('http://localhost:8880/v1/audio/voices');
    });

    it('throws when API returns non-ok non-404 response', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse('Server error', false, 500));

      await expect(provider.listVoices()).rejects.toThrow('Voice list API error 500');
    });
  });

  describe('discoverVoicesLive', () => {
    it('returns TtsVoice[] when API returns voices array', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse([{ id: 'alloy', name: 'Alloy' }]));

      const voices = await provider.discoverVoicesLive();
      expect(voices).not.toBeNull();
      expect(voices).toHaveLength(1);
      expect(voices![0]!.id).toBe('alloy');
      expect(voices![0]!.providerId).toBe('1');
    });

    it('returns TtsVoice[] when API returns nested voices object', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({ voices: [{ voice_id: 'af_sky', display_name: 'Sky' }] }));

      const voices = await provider.discoverVoicesLive();
      expect(voices).toHaveLength(1);
      expect(voices![0]!.id).toBe('af_sky');
      expect(voices![0]!.name).toBe('Sky');
    });

    it('returns TtsVoice[] when API returns nested string voice entries', async () => {
      const provider = makeProvider({ defaultModel: 'kokoro' });
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({ voices: ['af_sky'] }));

      const voices = await provider.discoverVoicesLive();
      expect(voices).toHaveLength(1);
      expect(voices![0]).toMatchObject({
        id: 'af_sky',
        name: 'Sky',
        shortName: 'af_sky',
        language: 'English',
        locale: 'en-US',
        gender: 'Female',
      });
    });

    it('returns null when API returns 404', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse('', false, 404));

      const result = await provider.discoverVoicesLive();
      expect(result).toBeNull();
    });

    it('does NOT fall back to static voices (returns null on 404 even when static voices configured)', async () => {
      const provider = makeProvider({ staticVoices: STATIC_VOICES });
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse('', false, 404));

      const result = await provider.discoverVoicesLive();
      expect(result).toBeNull();
    });

    it('throws when API returns non-ok non-404 response', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse('Server error', false, 500));

      await expect(provider.discoverVoicesLive()).rejects.toThrow('Voice discovery API error 500');
    });

    it('throws on network error (does not silently return static voices)', async () => {
      const provider = makeProvider({ staticVoices: STATIC_VOICES });
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(provider.discoverVoicesLive()).rejects.toThrow('ECONNREFUSED');
    });

    it('includes auth header when apiKey is set', async () => {
      const provider = makeProvider({ apiKey: 'sk-test' });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse([]));

      await provider.discoverVoicesLive();

      const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer sk-test');
    });
  });

  describe('testConnection', () => {
    it('returns connected=true when /models succeeds', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({}));

      const result = await provider.testConnection();
      expect(result.connected).toBe(true);
    });

    it('returns connected=false when both /models and /audio/voices fail', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'));

      const result = await provider.testConnection();
      expect(result.connected).toBe(false);
      expect(result.error).toContain('network error');
    });

    it('returns connected=true when /models fails but /audio/voices succeeds', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce(mockFetchResponse('not found', false, 404))
        .mockResolvedValueOnce(mockFetchResponse([]));

      const result = await provider.testConnection();
      expect(result.connected).toBe(true);
    });

    it('still probes the network when voice discovery is disabled', async () => {
      const provider = makeProvider({ staticVoices: STATIC_VOICES, supportsVoiceDiscovery: false });
      vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce(mockFetchResponse('not found', false, 404))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await provider.testConnection();
      expect(result.connected).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });
  });

  describe('synthesizeCaptioned', () => {
    function mockCaptionedResponse(payload: unknown, status = 200): Response {
      const encoded = Buffer.from(JSON.stringify(payload), 'utf8');
      return {
        ok: status >= 200 && status < 300,
        status,
        arrayBuffer: () => Promise.resolve(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)),
        text: () => Promise.resolve(encoded.toString('utf8')),
        json: () => Promise.resolve(payload),
      } as unknown as Response;
    }

    const CAPTIONED_PAYLOAD = {
      audio: Buffer.from('captioned-audio').toString('base64'),
      audio_format: 'audio/mpeg',
      timestamps: [
        { word: 'The', start_time: 0.0, end_time: 0.08 },
        { word: 'fox', start_time: 0.08, end_time: 0.4 },
      ],
    };

    it('posts to the captioned route beside the api base, not under it', async () => {
      const provider = makeProvider({ baseUrl: 'http://localhost:8880/v1' });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockCaptionedResponse(CAPTIONED_PAYLOAD));

      await provider.synthesizeCaptioned('The fox', 'af_heart', 1.0, 'mp3');

      expect(fetchSpy.mock.calls[0]![0]).toBe('http://localhost:8880/dev/captioned_speech');
      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.stream).toBe(false);
      expect(body.return_timestamps).toBe(true);
      expect(body.voice).toBe('af_heart');
    });

    it('decodes the audio and word timings', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockCaptionedResponse(CAPTIONED_PAYLOAD));

      const result = await provider.synthesizeCaptioned('The fox', 'af_heart', 1.0, 'mp3');

      expect(result?.audio.toString('utf8')).toBe('captioned-audio');
      expect(result?.words).toEqual([
        { word: 'The', startTime: 0.0, endTime: 0.08 },
        { word: 'fox', startTime: 0.08, endTime: 0.4 },
      ]);
    });

    it('drops malformed timing entries rather than failing the synthesis', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockCaptionedResponse({
          ...CAPTIONED_PAYLOAD,
          timestamps: [
            { word: 'kept', start_time: 0, end_time: 0.2 },
            { word: '', start_time: 0.2, end_time: 0.3 },
            { word: 'no-times' },
            { start_time: 1, end_time: 2 },
            'nonsense',
          ],
        }),
      );

      const result = await provider.synthesizeCaptioned('kept', 'af_heart', 1.0, 'mp3');

      expect(result?.words).toEqual([{ word: 'kept', startTime: 0, endTime: 0.2 }]);
    });

    it('reports no support on 404 and stops asking on later calls', async () => {
      const provider = makeProvider();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockCaptionedResponse('not found', 404));

      expect(await provider.synthesizeCaptioned('hello', 'alloy', 1.0, 'mp3')).toBeNull();
      expect(await provider.synthesizeCaptioned('hello again', 'alloy', 1.0, 'mp3')).toBeNull();

      // The second call never reaches the network, so a provider without the endpoint costs one
      // probe rather than one per paragraph.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('reports no support when the endpoint answers in an unusable shape', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockCaptionedResponse({ nothing: 'useful' }));

      expect(await provider.synthesizeCaptioned('hello', 'alloy', 1.0, 'mp3')).toBeNull();
    });

    it('propagates a genuine upstream failure instead of silently degrading', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockCaptionedResponse('boom', 500));

      await expect(provider.synthesizeCaptioned('hello', 'alloy', 1.0, 'mp3')).rejects.toThrow('Captioned speech API error 500');
    });
  });
});
