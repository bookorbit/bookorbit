import { Controller, Get, MessageEvent, Query, Sse } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderInfo, MetadataProviderKey, Permission, ProviderThrottleRuntimeSnapshot } from '@bookorbit/types';
import { map, Observable } from 'rxjs';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { LookupMetadataDto } from './dto/lookup-metadata.dto';
import { MetadataSearchDto } from './dto/metadata-search.dto';
import { MetadataFetchService } from './metadata-fetch.service';
import { MetadataFetchPipeline } from './metadata-fetch-pipeline';
import { ProviderRegistry } from './provider-registry';
import { MetadataSearchParams } from './providers/metadata-search-params';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import { MetadataPreferencesService } from '../metadata-preferences/metadata-preferences.service';
import { createGenreBlocklistTokenSet, filterCandidateGenresAgainstBlocklist } from '../../common/utils/genre-blocklist.utils';
import { ProviderThrottleTracker } from './provider-throttle.tracker';
import { ListMetadataProvidersDto } from './dto/list-metadata-providers.dto';

function normalizeSearchTitle(title: string | undefined): string | undefined {
  if (!title) return title;
  // Normalize comic issue tags (e.g. "#007" -> "#7") before provider search.
  return title.trim().replace(/#0*(\d+)/g, '#$1');
}

function isAudiobookProvider(providerKey: MetadataProviderKey): boolean {
  return providerKey === MetadataProviderKey.AUDIBLE || providerKey === MetadataProviderKey.AUDNEXUS;
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
      const libraryId = await this.metadataFetchService.getAccessibleBookLibraryId(dto.bookId, user);
      const [enabledProviderKeys, fieldRuleProviderKeys] = await Promise.all([
        this.resolveEnabledProviderKeys(),
        this.resolveFieldRuleProviderKeys(undefined, libraryId),
      ]);
      return this.providerInfosForKeys(enabledProviderKeys, new Set(fieldRuleProviderKeys));
    }

    const providerKeys = await this.resolveEnabledProviderKeys();
    return this.providerInfosForKeys(providerKeys);
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
    const [preferences, providerKeys] = await Promise.all([
      this.metadataPreferences.getGlobal(),
      this.resolveSearchProviderKeys(dto.providers, storedContext?.libraryId),
    ]);
    const requestedAudiobookProvider = (dto.providers ?? []).some(isAudiobookProvider);
    const onlyAudiobookProviders = providerKeys.length > 0 && providerKeys.every(isAudiobookProvider);
    const isAudiobook =
      requestedAudiobookProvider || onlyAudiobookProviders ? true : (dto.isAudiobook ?? Boolean(existingProviderIds[MetadataProviderKey.AUDIBLE]));

    const params: MetadataSearchParams = {
      title: normalizeSearchTitle(dto.title),
      author: dto.author,
      isbn: dto.isbn,
      existingProviderIds,
      isAudiobook,
    };

    const blockedGenreTokens = createGenreBlocklistTokenSet(preferences.options?.genres.blocklist);

    return this.metadataFetchService
      .search(params, providerKeys)
      .pipe(map((candidate: MetadataCandidate) => ({ data: filterCandidateGenresAgainstBlocklist(candidate, blockedGenreTokens) })));
  }

  @Get('lookup')
  async lookup(@Query() dto: LookupMetadataDto): Promise<MetadataCandidate | null> {
    const [enabledProvider] = await this.resolveEnabledProviderKeys([dto.provider]);
    if (!enabledProvider) return null;

    const [candidate, preferences] = await Promise.all([
      this.metadataFetchService.lookupById(enabledProvider, dto.id),
      this.metadataPreferences.getGlobal(),
    ]);
    if (!candidate) return null;
    const blockedGenreTokens = createGenreBlocklistTokenSet(preferences.options?.genres.blocklist);
    return filterCandidateGenresAgainstBlocklist(candidate, blockedGenreTokens);
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
  ): Promise<MetadataProviderKey[]> {
    const effectiveProviderKeys = await this.pipeline.getEffectiveProviderKeys(libraryId);
    if (requestedProviders === undefined) return effectiveProviderKeys;
    const requested = new Set(requestedProviders);
    return effectiveProviderKeys.filter((providerKey) => requested.has(providerKey));
  }

  private async resolveSearchProviderKeys(requestedProviders: MetadataProviderKey[] | undefined, libraryId?: number): Promise<MetadataProviderKey[]> {
    if (requestedProviders !== undefined || libraryId === undefined) {
      return this.resolveEnabledProviderKeys(requestedProviders);
    }

    return this.resolveFieldRuleProviderKeys(undefined, libraryId);
  }

  private providerInfosForKeys(providerKeys: MetadataProviderKey[], fieldRuleProviderKeys?: Set<MetadataProviderKey>): MetadataProviderInfo[] {
    const keySet = new Set(providerKeys);
    return this.registry
      .all()
      .filter((p) => keySet.has(p.key))
      .map((p) => ({
        key: p.key,
        label: p.label,
        identifiable: p.identifiable,
        ...(fieldRuleProviderKeys ? { selectedByFieldRules: fieldRuleProviderKeys.has(p.key) } : {}),
      }));
  }
}
