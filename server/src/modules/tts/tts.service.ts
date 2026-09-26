import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { TtsCaptionedSpeech, TtsChapterText, TtsEffectivePreferences, TtsUserPreferences, TtsVoice } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import type { StaticVoice } from '../../db/schema';
import { BookService } from '../book/book.service';
import type { UpdateTtsPreferencesDto } from './dto/tts-preferences.dto';
import type { SaveTtsPositionDto } from './dto/tts-position.dto';
import type { SynthesizeDto } from './dto/synthesize.dto';
import type { ITtsProvider } from './providers/tts-provider.interface';
import { TtsProviderFactory } from './providers/tts-provider.factory';
import { DEFAULT_TTS_AUDIO_FORMAT } from './tts-audio-format';
import { TtsRepository } from './tts.repository';
import { TtsSynthesisService } from './tts-synthesis.service';
import { TtsTextExtractorService } from './tts-text-extractor.service';

/**
 * A provider ready to synthesize, plus the allow-list it is curated to.
 *
 * `curatedVoiceIds` is null when the provider has no curation and is therefore trusted to accept
 * any id it recognises, which includes ids that never appear in its own listing such as Kokoro's
 * composite `af_sky+af_bella`.
 */
interface ResolvedTtsProvider {
  provider: ITtsProvider;
  curatedVoiceIds: Set<string> | null;
}

/** The curated ids of an openai-compatible provider, or null when it has not been curated. */
function curatedVoiceIds(staticVoices: StaticVoice[] | null): Set<string> | null {
  const curated = (staticVoices ?? []).map((voice) => voice.id).filter((id) => !!id);
  return curated.length > 0 ? new Set(curated) : null;
}

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  constructor(
    private readonly ttsRepo: TtsRepository,
    private readonly synthesisService: TtsSynthesisService,
    private readonly providerFactory: TtsProviderFactory,
    private readonly bookService: BookService,
    private readonly textExtractor: TtsTextExtractorService,
  ) {}

  // ---- Synthesis ----

  async synthesize(dto: SynthesizeDto): Promise<Buffer> {
    const resolved = await this.resolveProvider(dto.providerId);
    const voiceId = await this.resolveSynthesisVoiceId(dto.providerId, dto.voiceId, resolved);
    return this.synthesisService.synthesize(resolved.provider, dto.providerId, voiceId, dto.speed, dto.text, dto.format ?? DEFAULT_TTS_AUDIO_FORMAT);
  }

  /**
   * Same audio as `synthesize`, plus word timings where the provider reports them. Callers that
   * cannot use timings should keep using `synthesize`, which returns the audio bytes directly
   * rather than paying for base64.
   */
  async synthesizeCaptioned(dto: SynthesizeDto): Promise<TtsCaptionedSpeech> {
    const format = dto.format ?? DEFAULT_TTS_AUDIO_FORMAT;
    const resolved = await this.resolveProvider(dto.providerId);
    const voiceId = await this.resolveSynthesisVoiceId(dto.providerId, dto.voiceId, resolved);
    const result = await this.synthesisService.synthesizeCaptioned(resolved.provider, dto.providerId, voiceId, dto.speed, dto.text, format);
    return { audio: result.buffer.toString('base64'), format, words: result.words };
  }

  async previewVoice(providerId: string, voiceId: string): Promise<Buffer> {
    const resolved = await this.resolveProvider(providerId);
    const previewVoiceId = await this.resolveSynthesisVoiceId(providerId, voiceId, resolved);
    return this.synthesisService.previewVoice(resolved.provider, providerId, previewVoiceId);
  }

  // ---- Voice listing ----

  async getVoices(providerId?: string): Promise<TtsVoice[]> {
    if (providerId) {
      return this.getVoicesForProvider(providerId);
    }
    return this.getAllAvailableVoices();
  }

  private async getVoicesForProvider(providerId: string): Promise<TtsVoice[]> {
    const dbProvider = await this.ttsRepo.findProviderById(Number(providerId));
    if (!dbProvider || !dbProvider.enabled) throw new NotFoundException(`TTS provider ${providerId} not found or disabled`);
    const provider = this.providerFactory.getOpenAiProvider(dbProvider);
    return provider.listVoices();
  }

  private async getAllAvailableVoices(): Promise<TtsVoice[]> {
    const voices: TtsVoice[] = [];
    const enabledProviders = await this.ttsRepo.findEnabledProviders();
    for (const dbProvider of enabledProviders) {
      const provider = this.providerFactory.getOpenAiProvider(dbProvider);
      const providerVoices = await provider.listVoices().catch((err: Error) => {
        this.logger.warn(`Failed to list voices for provider ${dbProvider.id}: ${err.message}`);
        return [];
      });
      voices.push(...providerVoices);
    }
    return voices;
  }

  async getAvailableProviderInfos() {
    const enabledProviders = await this.ttsRepo.findEnabledProviders();
    return enabledProviders.map((provider) => ({ id: String(provider.id), name: provider.name, type: provider.type }));
  }

  // ---- User preferences ----

  async getUserPreferences(userId: number): Promise<TtsUserPreferences | null> {
    const row = await this.ttsRepo.findUserPreferences(userId);
    if (!row) return null;
    const normalized = await this.normalizePreferenceVoiceForProvider(row.providerId != null ? String(row.providerId) : null, row.voiceId ?? null);
    return {
      providerId: normalized.providerId,
      voiceId: normalized.voiceId,
      speed: row.speed,
    };
  }

  async saveUserPreferences(userId: number, dto: UpdateTtsPreferencesDto): Promise<TtsUserPreferences> {
    const row = await this.ttsRepo.upsertUserPreferences(userId, {
      ...(dto.providerId !== undefined && { providerId: this.providerIdToInt(dto.providerId) }),
      ...(dto.voiceId !== undefined && { voiceId: dto.voiceId }),
      ...(dto.speed !== undefined && { speed: dto.speed }),
    });
    return {
      providerId: row.providerId != null ? String(row.providerId) : null,
      voiceId: row.voiceId ?? null,
      speed: row.speed,
    };
  }

  async getEffectiveBookPreferences(userId: number, bookId: number, user: RequestUser): Promise<TtsEffectivePreferences> {
    await this.bookService.verifyBookAccess(bookId, user);
    const [userPrefs, bookPrefs] = await Promise.all([this.ttsRepo.findUserPreferences(userId), this.ttsRepo.findBookPreferences(userId, bookId)]);
    if (bookPrefs) {
      const normalized = await this.normalizePreferenceVoiceForProvider(
        bookPrefs.providerId != null ? String(bookPrefs.providerId) : userPrefs?.providerId != null ? String(userPrefs.providerId) : null,
        bookPrefs.voiceId ?? userPrefs?.voiceId ?? null,
      );
      return {
        providerId: normalized.providerId,
        voiceId: normalized.voiceId,
        speed: bookPrefs.speed ?? userPrefs?.speed ?? 1.0,
        isBookOverride: true,
      };
    }
    const normalized = await this.normalizePreferenceVoiceForProvider(
      userPrefs?.providerId != null ? String(userPrefs.providerId) : null,
      userPrefs?.voiceId ?? null,
    );
    return {
      providerId: normalized.providerId,
      voiceId: normalized.voiceId,
      speed: userPrefs?.speed ?? 1.0,
      isBookOverride: false,
    };
  }

  async saveBookPreferences(userId: number, bookId: number, dto: UpdateTtsPreferencesDto, user: RequestUser) {
    await this.bookService.verifyBookAccess(bookId, user);
    return this.ttsRepo.upsertBookPreferences(userId, bookId, {
      ...(dto.providerId !== undefined && { providerId: this.providerIdToInt(dto.providerId) }),
      ...(dto.voiceId !== undefined && { voiceId: dto.voiceId }),
      ...(dto.speed !== undefined && { speed: dto.speed }),
    });
  }

  async deleteBookPreferences(userId: number, bookId: number, user: RequestUser) {
    await this.bookService.verifyBookAccess(bookId, user);
    await this.ttsRepo.deleteBookPreferences(userId, bookId);
  }

  // ---- TTS position ----

  async getPosition(userId: number, bookFileId: number, user: RequestUser) {
    await this.bookService.verifyFileAccess(bookFileId, user);
    return this.ttsRepo.findPosition(userId, bookFileId);
  }

  async savePosition(userId: number, bookFileId: number, dto: SaveTtsPositionDto, user: RequestUser) {
    await this.bookService.verifyFileAccess(bookFileId, user);
    return this.ttsRepo.upsertPosition(userId, bookFileId, dto.cfi, dto.chapterIndex ?? null);
  }

  async deletePosition(userId: number, bookFileId: number, user: RequestUser) {
    await this.bookService.verifyFileAccess(bookFileId, user);
    await this.ttsRepo.deletePosition(userId, bookFileId);
  }

  async getChapterText(bookFileId: number, chapterIndex: number, user: RequestUser): Promise<TtsChapterText> {
    await this.bookService.verifyFileAccess(bookFileId, user);
    return this.textExtractor.extractChapterText(bookFileId, chapterIndex);
  }

  // ---- Helpers ----

  private async resolveProvider(providerId: string): Promise<ResolvedTtsProvider> {
    const numId = Number(providerId);
    if (isNaN(numId)) throw new NotFoundException(`Invalid provider ID: ${providerId}`);
    const dbProvider = await this.ttsRepo.findProviderById(numId);
    if (!dbProvider || !dbProvider.enabled) throw new NotFoundException(`TTS provider ${providerId} not found or disabled`);
    return {
      provider: this.providerFactory.getOpenAiProvider(dbProvider),
      curatedVoiceIds: curatedVoiceIds(dbProvider.staticVoices),
    };
  }

  private async resolveSynthesisVoiceId(providerId: string, requestedVoiceId: string | undefined, resolved: ResolvedTtsProvider): Promise<string> {
    const trimmedVoiceId = requestedVoiceId?.trim();
    if (trimmedVoiceId) {
      this.assertVoiceAvailable(providerId, trimmedVoiceId, resolved);
      return trimmedVoiceId;
    }

    const availableVoices = await resolved.provider.listVoices();
    const fallbackVoiceId = availableVoices[0]?.id?.trim();
    if (!fallbackVoiceId) {
      throw new NotFoundException(`No voices available for provider ${providerId}`);
    }

    this.logger.warn(`Missing voiceId for provider ${providerId}; falling back to voice ${fallbackVoiceId}`);
    return fallbackVoiceId;
  }

  /**
   * Curation is what users are offered, so it also has to be what they can play. Without this a
   * de-curated voice stays reachable through a stale saved preference and narrates with a voice the
   * picker can no longer show.
   *
   * The rejection is a 400 rather than a 404 because the request named a voice that is not on
   * offer; the route and the provider both exist. Clients probe the optional captioned-synthesis
   * route by treating its 404 as "this server cannot caption" and latching that for the session, so
   * answering 404 here would cost every voice its word timings over one bad voice id.
   */
  private assertVoiceAvailable(providerId: string, voiceId: string, resolved: ResolvedTtsProvider): void {
    if (!resolved.curatedVoiceIds) return;
    if (!resolved.curatedVoiceIds.has(voiceId)) {
      throw new BadRequestException(`Voice ${voiceId} is not available for provider ${providerId}`);
    }
  }

  private async normalizePreferenceVoiceForProvider(
    providerId: string | null,
    voiceId: string | null,
  ): Promise<{ providerId: string | null; voiceId: string | null }> {
    // A voice without a provider has nothing left to resolve it against, so it is dropped rather
    // than handed back for the client to try.
    const trimmedVoiceId = voiceId?.trim() || null;
    if (!providerId) return { providerId: null, voiceId: null };
    if (!trimmedVoiceId) return { providerId, voiceId: null };

    // A saved voice that curation has since withdrawn is cleared rather than handed back, so the
    // client falls back to a voice it can actually show as selected. Only curated providers are
    // checked, which keeps this off the network: the ids are already on the provider row.
    const curated = await this.curatedVoiceIdsForProvider(providerId);
    if (curated && !curated.has(trimmedVoiceId)) {
      return { providerId, voiceId: null };
    }
    return { providerId, voiceId: trimmedVoiceId };
  }

  private async curatedVoiceIdsForProvider(providerId: string): Promise<Set<string> | null> {
    const numId = Number(providerId);
    if (isNaN(numId)) return null;
    const dbProvider = await this.ttsRepo.findProviderById(numId);
    return dbProvider ? curatedVoiceIds(dbProvider.staticVoices) : null;
  }

  private providerIdToInt(providerId: string | undefined): number | null {
    if (!providerId) return null;
    const n = Number(providerId);
    return isNaN(n) ? null : n;
  }
}
