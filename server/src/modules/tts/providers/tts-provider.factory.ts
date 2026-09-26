import { Injectable } from '@nestjs/common';

import type { TtsProvider } from '../../../db/schema';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';
import type { ITtsProvider } from './tts-provider.interface';

@Injectable()
export class TtsProviderFactory {
  private readonly openAiCache = new Map<number, OpenAiCompatibleProvider>();

  getOpenAiProvider(dbProvider: TtsProvider): ITtsProvider {
    const cached = this.openAiCache.get(dbProvider.id);
    if (cached) return cached;
    const provider = new OpenAiCompatibleProvider({
      providerId: String(dbProvider.id),
      providerName: dbProvider.name,
      baseUrl: dbProvider.baseUrl ?? '',
      apiKey: dbProvider.apiKey ?? '',
      defaultModel: dbProvider.defaultModel,
      staticVoices: dbProvider.staticVoices ?? null,
      supportsVoiceDiscovery: dbProvider.supportsVoiceDiscovery,
    });
    this.openAiCache.set(dbProvider.id, provider);
    return provider;
  }

  invalidateCache(providerId: number): void {
    this.openAiCache.delete(providerId);
  }
}
