import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { TtsProviderStatus, TtsVoice } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { AddTtsProviderDto, UpdateTtsProviderDto } from './dto/tts-admin.dto';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider';
import { TtsProviderFactory } from './providers/tts-provider.factory';
import { TtsRepository } from './tts.repository';

@Injectable()
export class TtsAdminService {
  private readonly logger = new Logger(TtsAdminService.name);

  constructor(
    private readonly ttsRepo: TtsRepository,
    private readonly providerFactory: TtsProviderFactory,
  ) {}

  async getAllProviders() {
    return this.ttsRepo.findAllProviders();
  }

  async addProvider(dto: AddTtsProviderDto) {
    return this.ttsRepo.insertProvider({
      name: dto.name,
      type: 'openai-compatible',
      baseUrl: dto.baseUrl,
      apiKey: dto.apiKey ?? null,
      defaultModel: dto.defaultModel ?? null,
      staticVoices: dto.staticVoices ?? null,
      enabled: true,
      supportsVoiceDiscovery: dto.supportsVoiceDiscovery ?? true,
    });
  }

  async updateProvider(id: number, dto: UpdateTtsProviderDto) {
    const existing = await this.ttsRepo.findProviderById(id);
    if (!existing) throw new NotFoundException(`TTS provider ${id} not found`);
    const updated = await this.ttsRepo.updateProvider(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.baseUrl !== undefined && { baseUrl: dto.baseUrl }),
      ...(dto.apiKey !== undefined && { apiKey: dto.apiKey }),
      ...(dto.enabled !== undefined && { enabled: dto.enabled }),
      ...(dto.defaultModel !== undefined && { defaultModel: dto.defaultModel }),
      ...(dto.staticVoices !== undefined && { staticVoices: dto.staticVoices }),
      ...(dto.supportsVoiceDiscovery !== undefined && { supportsVoiceDiscovery: dto.supportsVoiceDiscovery }),
    });
    // Invalidated after the write: a request landing between an earlier eviction and the commit
    // would otherwise re-cache the pre-update row and serve the old curation until the next edit.
    this.providerFactory.invalidateCache(id);
    return updated;
  }

  /**
   * Order is submitted as one list covering every provider, because a partial list cannot say where
   * the providers it leaves out belong. Anything short of the full set is rejected rather than
   * merged, so a stale client cannot silently leave two providers sharing a slot.
   */
  async reorderProviders(order: string[]): Promise<void> {
    const providers = await this.ttsRepo.findAllProviders();
    const expected = new Set<string>(providers.map((p) => String(p.id)));
    const submitted = new Set(order);

    if (submitted.size !== order.length) {
      throw new BadRequestException('Provider order contains duplicate entries');
    }
    if (submitted.size !== expected.size || [...expected].some((key) => !submitted.has(key))) {
      throw new BadRequestException('Provider order must list every provider exactly once');
    }

    const providerEntries = order.map((key, index) => ({ id: Number(key), displayOrder: index }));
    await this.ttsRepo.updateProviderOrder(providerEntries);
    for (const entry of providerEntries) this.providerFactory.invalidateCache(entry.id);
  }

  async deleteProvider(id: number): Promise<void> {
    const existing = await this.ttsRepo.findProviderById(id);
    if (!existing) throw new NotFoundException(`TTS provider ${id} not found`);
    await this.ttsRepo.deleteProvider(id);
    this.providerFactory.invalidateCache(id);
  }

  async discoverProviderVoices(id: number): Promise<{ voices: TtsVoice[]; supported: boolean }> {
    const event = 'tts.admin.discover_voices';
    const startMs = Date.now();
    this.logger.log(`[${event}] [start] providerId=${id} - discovering provider voices`);
    const dbProvider = await this.ttsRepo.findProviderById(id);
    if (!dbProvider) throw new NotFoundException(`TTS provider ${id} not found`);
    if (!dbProvider.supportsVoiceDiscovery) {
      this.logger.log(
        `[${event}] [end] providerId=${id} durationMs=${Date.now() - startMs} supported=false count=0 - voice discovery skipped (disabled)`,
      );
      return { voices: [], supported: false };
    }
    const provider = new OpenAiCompatibleProvider({
      providerId: String(dbProvider.id),
      providerName: dbProvider.name,
      baseUrl: dbProvider.baseUrl ?? '',
      apiKey: dbProvider.apiKey ?? '',
      defaultModel: dbProvider.defaultModel,
      staticVoices: null,
      supportsVoiceDiscovery: dbProvider.supportsVoiceDiscovery,
    });
    try {
      const voices = await provider.discoverVoicesLive();
      const supported = voices !== null;
      this.logger.log(
        `[${event}] [end] providerId=${id} durationMs=${Date.now() - startMs} supported=${supported} count=${voices?.length ?? 0} - voice discovery completed`,
      );
      return { voices: voices ?? [], supported };
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = err instanceof Error ? sanitizeLogValue(err.message) : 'unknown';
      this.logger.error(
        `[${event}] [fail] providerId=${id} durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - voice discovery failed`,
      );
      throw new BadGatewayException('Failed to reach TTS provider');
    }
  }

  async testProvider(id: number): Promise<TtsProviderStatus> {
    const event = 'tts.admin.test_provider';
    const startMs = Date.now();
    this.logger.log(`[${event}] [start] providerId=${id} - testing provider connection`);
    try {
      const dbProvider = await this.ttsRepo.findProviderById(id);
      if (!dbProvider) throw new NotFoundException(`TTS provider ${id} not found`);
      const provider = this.providerFactory.getOpenAiProvider(dbProvider);
      const result = await provider.testConnection();
      let voiceCount = 0;
      if (result.connected) {
        const voices = await provider.listVoices().catch(() => []);
        voiceCount = voices.length;
      }
      this.logger.log(
        `[${event}] [end] providerId=${id} durationMs=${Date.now() - startMs} connected=${result.connected} voiceCount=${voiceCount} - provider test completed`,
      );
      return { id: String(id), name: dbProvider.name, connected: result.connected, voiceCount, error: result.error };
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = err instanceof Error ? sanitizeLogValue(err.message) : 'unknown';
      this.logger.error(
        `[${event}] [fail] providerId=${id} durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - provider test failed`,
      );
      if (err instanceof NotFoundException) throw err;
      return { id: String(id), name: 'Unknown', connected: false, voiceCount: 0, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }
}
