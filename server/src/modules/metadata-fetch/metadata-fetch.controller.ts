import { Controller, Get, MessageEvent, Query, Sse } from '@nestjs/common';
import {
  CoverMedia,
  METADATA_PROVIDER_STATUS_EVENT,
  MetadataCacheRequestPolicy,
  MetadataProviderInfo,
  MetadataProviderKey,
  MetadataSearchCandidateEvent,
  Permission,
  ProviderThrottleRuntimeSnapshot,
} from '@bookorbit/types';
import { filter, map, Observable } from 'rxjs';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CacheDirective } from '../../common/provider-cache/provider-cache-spec';
import type { RequestUser } from '../../common/types/request-user';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { LookupMetadataDto } from './dto/lookup-metadata.dto';
import { MetadataSearchDto } from './dto/metadata-search.dto';
import { MetadataFetchService, MetadataSearchEvent } from './metadata-fetch.service';
import { MetadataFetchPipeline } from './metadata-fetch-pipeline';
import { ProviderRegistry } from './provider-registry';
import { MetadataSearchParams } from './providers/metadata-search-params';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import { MetadataPreferencesService } from '../metadata-preferences/metadata-preferences.service';
import { applyGenreFetchOptionsToCandidate, createGenreBlocklistTokenSet } from '../../common/utils/genre-fetch-options.utils';
import { ProviderThrottleTracker } from './provider-throttle.tracker';
import { ListMetadataProvidersDto } from './dto/list-metadata-providers.dto';

function normalizeSearchTitle(title: string | undefined): string | undefined {
  if (!title) return title;
  // Normalize comic issue tags (e.g. "#007" -> "#7") before provider search.
  return title.trim().replace(/#0*(\d+)/g, '#$1');
}

/** Interactive searches answer from the cache unless the user asked for a fresh one. */
function requestDirective(policy: MetadataCacheRequestPolicy | undefined): CacheDirective {
  return { policy: policy === 'refresh' ? 'refresh' : 'default', allowFallback: true };
}

/**
 * The search box is prefilled with the book's own title, so an unchanged one carries no intent and
 * stored series context should still lead. Anything else is the user asking for something specific.
 */
function isExplicitQuery(searchTitle: string | undefined, storedTitle: string | null | undefined): boolean {
  if (!searchTitle?.trim()) return false;
  const stored = normalizeSearchTitle(storedTitle ?? undefined);
  return searchTitle.trim().toLowerCase() !== (stored ?? '').trim().toLowerCase();
}

@Controller('metadata-fetch')
export class MetadataFetchController {
  constructor(
    private readonly metadataFetchService: MetadataFetchService,
    private readonly pipeline: MetadataFetchPipeline,
    private readonly registry: ProviderRegistry,
    private readonly providerConfig: ProviderConfigService,
    private readonly throttleTracker: ProviderThrottleTracker,
    private readonly metadataPreferences: MetadataPreferencesService,
  ) {}

  @Get('providers')
  async listProviders(@Query() dto: ListMetadataProvidersDto, @CurrentUser() user: RequestUser): Promise<MetadataProviderInfo[]> {
    if (dto.bookId) {
      const { libraryId, coverMedia } = await this.metadataFetchService.getStoredProviderContext(dto.bookId, user);
      const [enabledProviderKeys, fieldRuleProviderKeys, libraryPreferences] = await Promise.all([
        this.resolveEnabledProviderKeys(),
        this.resolveFieldRuleProviderKeys(undefined, libraryId, coverMedia),
        this.metadataPreferences.getForLibrary(libraryId),
      ]);
      const { fields } = libraryPreferences.effective;
      return this.providerInfosForKeys(enabledProviderKeys, new Set(fieldRuleProviderKeys), fields.cover.providers, fields.audioCover.providers);
    }

    const [providerKeys, preferences] = await Promise.all([this.resolveEnabledProviderKeys(), this.metadataPreferences.getGlobal()]);
    return this.providerInfosForKeys(providerKeys, undefined, preferences.fields.cover.providers, preferences.fields.audioCover.providers);
  }

  @Get('providers/runtime')
  @RequirePermission(Permission.ManageMetadataConfig)
  async listProviderRuntime(): Promise<ProviderThrottleRuntimeSnapshot> {
    const config = await this.providerConfig.getConfig();
    const statuses = await this.providerConfig.getProviderStatuses(config);
    const registered = new Set(this.registry.all().map((p) => p.key));
    const keys = statuses.map((s) => s.key).filter((key) => registered.has(key));
    return this.throttleTracker.snapshot(keys);
  }

  @Sse('stream')
  async stream(@Query() dto: MetadataSearchDto, @CurrentUser() user: RequestUser): Promise<Observable<MessageEvent>> {
    const storedContext = dto.bookId ? await this.metadataFetchService.getStoredProviderContext(dto.bookId, user) : null;
    const existingProviderIds = storedContext?.providerIds ?? {};
    const [preferences, enabledProviderKeys] = await Promise.all([
      this.metadataPreferences.getGlobal(),
      this.resolveSearchProviderKeys(dto.providers, storedContext?.libraryId, storedContext?.coverMedia),
    ]);
    // A stated medium describes the book, so it settles which providers can answer at all. It
    // narrows the caller's provider list rather than widening it, and never adds a disabled one.
    const media = [...new Set([...(dto.mediaKind ? [dto.mediaKind] : []), ...(dto.mediaKinds ?? [])])];
    const providerKeys = media.length
      ? [...new Set(media.flatMap((mediaKind) => this.registry.keysForMediaKind(enabledProviderKeys, mediaKind)))]
      : enabledProviderKeys;
    const leadMediaKind = media[0];
    const servesOnlyAudiobooks = (providerKey: MetadataProviderKey) => this.registry.servesOnlyAudiobooks(providerKey);
    const requestedAudiobookProvider = (dto.providers ?? []).some(servesOnlyAudiobooks);
    const onlyAudiobookProviders = providerKeys.length > 0 && providerKeys.every(servesOnlyAudiobooks);
    const inferredIsAudiobook =
      requestedAudiobookProvider ||
      onlyAudiobookProviders ||
      Boolean(existingProviderIds[MetadataProviderKey.AUDIBLE] || existingProviderIds[MetadataProviderKey.LIBROFM]);
    const isAudiobook = dto.isAudiobook ?? (leadMediaKind ? leadMediaKind === 'audiobook' : inferredIsAudiobook);
    // The medium ranking prefers: a stated one, else the side of the book being searched.
    const mediaKind = leadMediaKind ?? (isAudiobook ? 'audiobook' : storedContext?.textMediaKind);

    const searchTitle = normalizeSearchTitle(dto.title);
    const params: MetadataSearchParams = {
      title: searchTitle,
      author: dto.author,
      isbn: dto.isbn,
      seriesName: storedContext?.seriesName ?? undefined,
      seriesIndex: storedContext?.seriesIndex ?? undefined,
      titleIsExplicitQuery: isExplicitQuery(searchTitle, storedContext?.title),
      existingProviderIds,
      isAudiobook,
      mediaKind,
      includeAudiobookProviders: isAudiobook || providerKeys.some(servesOnlyAudiobooks),
      validateCoverPlaceholders: true,
      resultsPerProvider: dto.resultsPerProvider,
    };

    const genreOptions = preferences.options?.genres;
    const blockedGenreTokens = createGenreBlocklistTokenSet(genreOptions?.blocklist);

    return this.metadataFetchService.search(params, providerKeys, { directive: requestDirective(dto.cache) }).pipe(
      // Run summaries are for internal callers; the stream carries only candidates and statuses.
      filter((event): event is Exclude<MetadataSearchEvent, { kind: 'run' }> => event.kind !== 'run'),
      map((event): MessageEvent => {
        if (event.kind === 'status') return { type: METADATA_PROVIDER_STATUS_EVENT, data: event.status };
        const candidate = applyGenreFetchOptionsToCandidate(event.candidate, blockedGenreTokens, genreOptions?.maxCount);
        const data: MetadataSearchCandidateEvent = event.cache ? { ...candidate, cache: event.cache } : candidate;
        return { data };
      }),
    );
  }

  @Get('lookup')
  async lookup(@Query() dto: LookupMetadataDto): Promise<MetadataSearchCandidateEvent | null> {
    const [enabledProvider] = await this.resolveEnabledProviderKeys([dto.provider]);
    if (!enabledProvider) return null;

    const [result, preferences] = await Promise.all([
      this.metadataFetchService.lookupById(enabledProvider, dto.id, { directive: requestDirective(dto.cache) }),
      this.metadataPreferences.getGlobal(),
    ]);
    if (!result) return null;
    const genreOptions = preferences.options?.genres;
    const blockedGenreTokens = createGenreBlocklistTokenSet(genreOptions?.blocklist);
    const candidate = applyGenreFetchOptionsToCandidate(result.candidate, blockedGenreTokens, genreOptions?.maxCount);
    return result.cache ? { ...candidate, cache: result.cache } : candidate;
  }

  private async resolveEnabledProviderKeys(requestedProviders?: MetadataProviderKey[]): Promise<MetadataProviderKey[]> {
    const config = await this.providerConfig.getConfig();
    const registeredProviders = this.registry.all();
    const enabledProviders = new Set(
      registeredProviders.filter((provider) => config[provider.key]?.enabled !== false).map((provider) => provider.key),
    );
    const providerKeys = requestedProviders ?? registeredProviders.map((provider) => provider.key);
    return providerKeys.filter((providerKey) => enabledProviders.has(providerKey));
  }

  private async resolveFieldRuleProviderKeys(
    requestedProviders: MetadataProviderKey[] | undefined,
    libraryId: number,
    coverMedia?: CoverMedia,
  ): Promise<MetadataProviderKey[]> {
    const effectiveProviderKeys = await this.pipeline.getEffectiveProviderKeys(libraryId, coverMedia);
    if (requestedProviders === undefined) return effectiveProviderKeys;
    const requested = new Set(requestedProviders);
    return effectiveProviderKeys.filter((providerKey) => requested.has(providerKey));
  }

  private async resolveSearchProviderKeys(
    requestedProviders: MetadataProviderKey[] | undefined,
    libraryId?: number,
    coverMedia?: CoverMedia,
  ): Promise<MetadataProviderKey[]> {
    if (requestedProviders !== undefined || libraryId === undefined) {
      return this.resolveEnabledProviderKeys(requestedProviders);
    }

    return this.resolveFieldRuleProviderKeys(undefined, libraryId, coverMedia);
  }

  private providerInfosForKeys(
    providerKeys: MetadataProviderKey[],
    fieldRuleProviderKeys: Set<MetadataProviderKey> | undefined,
    coverProviderKeys: MetadataProviderKey[],
    audioCoverProviderKeys: MetadataProviderKey[],
  ): MetadataProviderInfo[] {
    const keySet = new Set(providerKeys);
    const coverPriorities = new Map(coverProviderKeys.map((key, index) => [key, index]));
    const audioCoverPriorities = new Map(audioCoverProviderKeys.map((key, index) => [key, index]));
    return this.registry
      .all()
      .filter((p) => keySet.has(p.key))
      .map((p) => {
        const coverPriority = coverPriorities.get(p.key);
        const audioCoverPriority = audioCoverPriorities.get(p.key);
        return {
          key: p.key,
          label: p.label,
          identifiable: p.identifiable,
          source: p.source ?? 'builtin',
          ...(p.iconUrl ? { iconUrl: p.iconUrl } : {}),
          ...(p.color ? { color: p.color } : {}),
          ...(fieldRuleProviderKeys ? { selectedByFieldRules: fieldRuleProviderKeys.has(p.key) } : {}),
          ...(coverPriority !== undefined ? { coverPriority } : {}),
          ...(audioCoverPriority !== undefined ? { audioCoverPriority } : {}),
        };
      });
  }
}
