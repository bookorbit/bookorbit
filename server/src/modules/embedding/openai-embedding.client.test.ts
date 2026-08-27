import { Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import { embeddingConfig } from '../../config/config';
import { OpenAiEmbeddingClient } from './openai-embedding.client';

type EmbeddingConfig = ConfigType<typeof embeddingConfig>;

function makeConfig(overrides: Partial<EmbeddingConfig> = {}): EmbeddingConfig {
  return {
    apiBaseUrl: 'https://x/v1',
    apiKey: 'k',
    model: 'm',
    timeoutMs: 30000,
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('OpenAiEmbeddingClient', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts to the /embeddings endpoint and returns a 256-length vector', async () => {
    const client = new OpenAiEmbeddingClient(makeConfig());
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ data: [{ embedding: Array(256).fill(0.01) }] }));

    const result = await client.embed('t');

    expect(result).toHaveLength(256);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://x/v1/embeddings');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer k');
    const parsed = JSON.parse(init?.body as string);
    expect(parsed.dimensions).toBe(256);
    expect(parsed.model).toBe('m');
  });

  it('truncates a longer response to 256 dimensions', async () => {
    const client = new OpenAiEmbeddingClient(makeConfig());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ data: [{ embedding: Array(512).fill(0.02) }] }));

    const result = await client.embed('t');

    expect(result.length).toBe(256);
  });

  it('rejects when the response has fewer than 256 dimensions', async () => {
    const client = new OpenAiEmbeddingClient(makeConfig());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ data: [{ embedding: Array(128).fill(0) }] }));

    await expect(client.embed('t')).rejects.toThrow('dims=128');
  });

  it('omits the Authorization header when no api key is set', async () => {
    const client = new OpenAiEmbeddingClient(makeConfig({ apiKey: undefined }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ data: [{ embedding: Array(256).fill(0.01) }] }));

    await client.embed('t');

    const [, init] = fetchSpy.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('reports disabled when apiBaseUrl or model is missing', () => {
    expect(new OpenAiEmbeddingClient(makeConfig()).isEnabled()).toBe(true);
    expect(new OpenAiEmbeddingClient(makeConfig({ apiBaseUrl: undefined })).isEnabled()).toBe(false);
    expect(new OpenAiEmbeddingClient(makeConfig({ model: undefined })).isEnabled()).toBe(false);
  });
});
