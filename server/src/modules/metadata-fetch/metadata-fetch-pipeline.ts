import { Injectable, Logger } from '@nestjs/common';
import {
  AudiobookChapter,
  BookCommunityRating,
  ComicMetadataFields,
  FieldPreference,
  MetadataCandidate,
  MetadataFetchDiagnostics,
  MetadataFetchPreferences,
  MetadataField,
  MetadataProviderKey,
  MetadataSeriesMembership,
  ProviderConfigurations,
} from '@bookorbit/types';
import { firstValueFrom, toArray } from 'rxjs';

import { MetadataPreferenceResolver } from '../metadata-preferences/metadata-preference-resolver';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import { MetadataPreferencesService } from '../metadata-preferences/metadata-preferences.service';
import { createGenreBlocklistTokenSet, filterGenresAgainstBlocklist } from '../../common/utils/genre-blocklist.utils';
import { normalizeMetadataText, normalizeMetadataTextKey } from '../../common/utils/metadata-text-normalize.utils';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { ProviderThrottleTracker } from './provider-throttle.tracker';
import { MetadataSearchParams } from './providers/metadata-search-params';

export type ResolvedMetadataFields = Partial<Record<MetadataField, string | string[] | number | null>> & {
  coverUrl?: string;
  hardcoverEditionId?: string | null;
  publishedDate?: string | null;
  seriesMemberships?: MetadataSeriesMembership[];
  chapters?: AudiobookChapter[];
  comicMetadata?: ComicMetadataFields;
  communityRatings?: BookCommunityRating[];
};

export interface ExistingMetadataFields extends Partial<Record<MetadataField, unknown>> {
  chapters?: unknown;
  comicMetadata?: Partial<Record<keyof ComicMetadataFields, unknown>> | null;
  hardcoverEditionId?: unknown;
}

export interface MetadataFetchRunOptions {
  preserveExisting?: boolean;
}

type ResolvedProviderIds = Partial<Record<MetadataProviderKey, string>>;

type ProviderSelectionDiagnostics = Pick<
  MetadataFetchDiagnostics,
  'activeProviders' | 'fieldRuleProviders' | 'disabledFieldRuleProviders' | 'enabledUnreferencedProviders' | 'throttledProviders'
>;

type ConfiguredProviderSelection = Pick<
  MetadataFetchDiagnostics,
  'fieldRuleProviders' | 'disabledFieldRuleProviders' | 'enabledUnreferencedProviders'
> & {
  configuredFieldRuleProviders: MetadataProviderKey[];
};

type ProviderPreferenceContext = {
  preferences: MetadataFetchPreferences;
  registeredKeys: MetadataProviderKey[];
  providerConfig: ProviderConfigurations;
};

@Injectable()
export class MetadataFetchPipeline {
  private readonly logger = new Logger(MetadataFetchPipeline.name);

  constructor(
    private readonly fetchService: MetadataFetchService,
    private readonly preferencesService: MetadataPreferencesService,
    private readonly resolver: MetadataPreferenceResolver,
    private readonly registry: ProviderRegistry,
    private readonly throttleTracker: ProviderThrottleTracker,
    private readonly providerConfig: ProviderConfigService,
  ) {}

  async run(
    params: MetadataSearchParams,
    existingFields: ExistingMetadataFields,
    libraryId?: number,
    options?: MetadataFetchRunOptions,
  ): Promise<ResolvedMetadataFields> {
    const { resolved } = await this.runInternal(params, existingFields, libraryId, options);
    return resolved;
  }

  async runWithSources(
    params: MetadataSearchParams,
    existingFields: ExistingMetadataFields,
    libraryId?: number,
    options?: MetadataFetchRunOptions,
  ): Promise<{
    resolved: ResolvedMetadataFields;
    sources: Record<string, string>;
    providerIds: ResolvedProviderIds;
    diagnostics: MetadataFetchDiagnostics;
  }> {
    return this.runInternal(params, existingFields, libraryId, options);
  }

  async getEffectiveProviderKeys(libraryId?: number): Promise<MetadataProviderKey[]> {
    const { preferences, registeredKeys, providerConfig } = await this.resolveProviderPreferenceContext(libraryId);
    return this.deriveConfiguredProviderSelection(preferences, registeredKeys, providerConfig).configuredFieldRuleProviders;
  }

  private async runInternal(
    params: MetadataSearchParams,
    existingFields: ExistingMetadataFields,
    libraryId?: number,
    options?: MetadataFetchRunOptions,
  ): Promise<{
    resolved: ResolvedMetadataFields;
    sources: Record<string, string>;
    providerIds: ResolvedProviderIds;
    diagnostics: MetadataFetchDiagnostics;
  }> {
    const { preferences, registeredKeys, providerConfig } = await this.resolveProviderPreferenceContext(libraryId);
    const providerSelection = this.deriveProviderSet(preferences, registeredKeys, providerConfig);
    const candidates = providerSelection.activeProviders.length
      ? await firstValueFrom(this.fetchService.search(params, providerSelection.activeProviders).pipe(toArray()), {
          defaultValue: [] as MetadataCandidate[],
        })
      : [];

    const byProvider = new Map<string, MetadataCandidate>();
    for (const c of candidates) {
      if (!byProvider.has(c.provider)) byProvider.set(c.provider, c);
    }
    const { resolved, sources, providerIds } = this.applyPreferences(preferences, byProvider, existingFields, params.existingProviderIds, options);
    const diagnostics = this.buildDiagnostics(providerSelection, candidates, resolved);
    return { resolved, sources, providerIds, diagnostics };
  }

  private async resolveProviderPreferenceContext(libraryId?: number): Promise<ProviderPreferenceContext> {
    const [global, providerConfig] = await Promise.all([this.preferencesService.getGlobal(), this.providerConfig.getConfig()]);
    const overrides = libraryId ? (await this.preferencesService.getForLibrary(libraryId, global)).overrides : null;
    const registeredKeys = this.registry.all().map((p) => p.key) as MetadataProviderKey[];
    const preferences: MetadataFetchPreferences = this.resolver.withForwardCompatibility(this.resolver.resolve(global, overrides), registeredKeys);

    return { preferences, registeredKeys, providerConfig };
  }

  private deriveConfiguredProviderSelection(
    preferences: MetadataFetchPreferences,
    registeredKeys: MetadataProviderKey[],
    providerConfig: ProviderConfigurations,
  ): ConfiguredProviderSelection {
    const registered = new Set(registeredKeys);
    const fieldRuleProviders = new Set<MetadataProviderKey>();
    const configuredFieldRuleProviders = new Set<MetadataProviderKey>();
    const disabledFieldRuleProviders = new Set<MetadataProviderKey>();

    for (const [, fieldPreference] of Object.entries(preferences.fields) as [MetadataField, FieldPreference][]) {
      if (!fieldPreference.enabled) continue;
      for (const providerKey of fieldPreference.providers) {
        if (!registered.has(providerKey)) continue;
        fieldRuleProviders.add(providerKey);
        if (providerConfig[providerKey]?.enabled === false) {
          disabledFieldRuleProviders.add(providerKey);
        } else {
          configuredFieldRuleProviders.add(providerKey);
        }
      }
    }

    const enabledUnreferencedProviders = registeredKeys.filter(
      (providerKey) => providerConfig[providerKey]?.enabled !== false && !fieldRuleProviders.has(providerKey),
    );

    return {
      fieldRuleProviders: [...fieldRuleProviders],
      configuredFieldRuleProviders: [...configuredFieldRuleProviders],
      disabledFieldRuleProviders: [...disabledFieldRuleProviders],
      enabledUnreferencedProviders,
    };
  }

  private deriveProviderSet(
    preferences: MetadataFetchPreferences,
    registeredKeys: MetadataProviderKey[],
    providerConfig: ProviderConfigurations,
  ): ProviderSelectionDiagnostics {
    const configuredProviderSelection = this.deriveConfiguredProviderSelection(preferences, registeredKeys, providerConfig);

    const activeProviders: MetadataProviderKey[] = [];
    const throttledProviders: MetadataProviderKey[] = [];
    for (const key of configuredProviderSelection.configuredFieldRuleProviders) {
      if (this.throttleTracker.isThrottled(key)) {
        throttledProviders.push(key);
        this.logger.warn(
          `[metadata_fetch.pipeline_provider] [fail] provider=${key} durationMs=0 errorClass=ProviderThrottleError error="provider is in cooldown" - provider skipped`,
        );
      } else {
        activeProviders.push(key);
      }
    }

    return {
      activeProviders,
      fieldRuleProviders: configuredProviderSelection.fieldRuleProviders,
      disabledFieldRuleProviders: configuredProviderSelection.disabledFieldRuleProviders,
      enabledUnreferencedProviders: configuredProviderSelection.enabledUnreferencedProviders,
      throttledProviders,
    };
  }

  private buildDiagnostics(
    providerSelection: ProviderSelectionDiagnostics,
    candidates: MetadataCandidate[],
    resolved: ResolvedMetadataFields,
  ): MetadataFetchDiagnostics {
    const candidateProviders = [...new Set(candidates.map((candidate) => candidate.provider))];
    const resolvedFieldCount = Object.keys(resolved).length;

    let reason: MetadataFetchDiagnostics['reason'] = null;
    if (resolvedFieldCount === 0) {
      if (providerSelection.activeProviders.length === 0) {
        reason = providerSelection.throttledProviders.length > 0 ? 'providers_throttled' : 'no_active_providers';
      } else if (candidates.length === 0) {
        reason = 'no_candidates';
      } else {
        reason = 'no_resolved_fields';
      }
    }

    return {
      ...providerSelection,
      candidateProviders,
      candidateCount: candidates.length,
      resolvedFieldCount,
      reason,
    };
  }

  private applyPreferences(
    preferences: MetadataFetchPreferences,
    byProvider: Map<string, MetadataCandidate>,
    existing: ExistingMetadataFields,
    existingProviderIds: Partial<Record<MetadataProviderKey, string>> | undefined,
    options: MetadataFetchRunOptions | undefined,
  ): { resolved: ResolvedMetadataFields; sources: Record<string, string>; providerIds: ResolvedProviderIds } {
    const result: ResolvedMetadataFields = {};
    const sources: Record<string, string> = {};
    const blockedGenreTokens = createGenreBlocklistTokenSet(preferences.options?.genres.blocklist);

    for (const field of Object.keys(preferences.fields) as MetadataField[]) {
      const fieldPreference = preferences.fields[field];
      if (!fieldPreference.enabled) continue;
      const mergeStrategy = options?.preserveExisting ? 'fillMissing' : fieldPreference.mergeStrategy;

      if (field === 'genres' && preferences.options?.genres.mode === 'merge') {
        const { genres, sourceProvider } = this.mergeGenres(fieldPreference.providers as MetadataProviderKey[], byProvider, blockedGenreTokens);
        if (!genres.length) continue;

        const existingValue = existing[field];
        switch (mergeStrategy) {
          case 'fillMissing':
            if (this.isMissing(existingValue)) {
              result.genres = genres;
              if (sourceProvider) sources.genres = sourceProvider;
            }
            break;
          case 'overwrite':
          case 'overwriteIfProvided':
            result.genres = genres;
            if (sourceProvider) sources.genres = sourceProvider;
            break;
        }
        continue;
      }

      if (field === 'communityRating') {
        const existingValue = existing[field];
        if (mergeStrategy === 'fillMissing' && !this.isMissing(existingValue)) continue;

        const communityRatings = this.collectCommunityRatings(fieldPreference.providers as MetadataProviderKey[], byProvider);
        if (communityRatings.length > 0) {
          result.communityRatings = communityRatings;
          sources.communityRating = communityRatings.map((rating) => rating.provider).join('|');
        }
        continue;
      }

      for (const providerKey of fieldPreference.providers) {
        const candidate = byProvider.get(providerKey);
        if (!candidate) continue;

        let value = this.extractField(candidate, field);
        if (value === undefined || value === null) continue;

        if (field === 'cover') {
          const existingValue = existing[field];
          if (mergeStrategy === 'fillMissing' && !this.isMissing(existingValue)) break;
          result.coverUrl = candidate.coverUrl;
          sources['coverUrl'] = providerKey;
          break;
        }

        if (field === 'genres' && blockedGenreTokens.size > 0) {
          if (!Array.isArray(value)) continue;
          const filteredGenres = filterGenresAgainstBlocklist(value, blockedGenreTokens);
          if (!filteredGenres.length) continue;
          value = filteredGenres;
        }

        const existingValue = existing[field];
        switch (mergeStrategy) {
          case 'fillMissing':
            if (this.isMissing(existingValue)) {
              (result as Record<string, unknown>)[field] = value;
              this.copyPublishedDateForYear(result, candidate, field);
              sources[field] = providerKey;
            }
            break;
          case 'overwrite':
          case 'overwriteIfProvided':
            (result as Record<string, unknown>)[field] = value;
            this.copyPublishedDateForYear(result, candidate, field);
            sources[field] = providerKey;
            break;
        }
        break;
      }
    }

    const seriesMemberships = this.resolveSeriesMemberships(byProvider, result, sources);
    if (seriesMemberships) result.seriesMemberships = seriesMemberships;

    const providerIds: ResolvedProviderIds = {};
    if (preferences.options?.saveProviderIds) {
      for (const candidate of byProvider.values()) {
        if (candidate.providerId && (!options?.preserveExisting || !existingProviderIds?.[candidate.provider])) {
          providerIds[candidate.provider] = candidate.providerId;
        }
        if (
          candidate.provider === MetadataProviderKey.HARDCOVER &&
          candidate.hardcoverEditionId &&
          (!options?.preserveExisting || this.isMissing(existing.hardcoverEditionId))
        ) {
          result.hardcoverEditionId = candidate.hardcoverEditionId;
        }
      }
    }

    // Pass through chapters from the first candidate that has them, using the
    // narrators field's provider preference order as the authority for audiobook data.
    const narratorProviders = preferences.fields['narrators']?.providers ?? [];
    const chapterProviders = [...narratorProviders, ...byProvider.keys()];
    for (const providerKey of chapterProviders) {
      const candidate = byProvider.get(providerKey);
      if (candidate?.chapters?.length && (!options?.preserveExisting || this.isMissing(existing.chapters))) {
        result.chapters = candidate.chapters;
        break;
      }
    }

    const comicMetadata = this.resolveComicMetadata(preferences, byProvider);
    const filteredComicMetadata = options?.preserveExisting ? this.filterExistingComicMetadata(comicMetadata, existing.comicMetadata) : comicMetadata;
    if (filteredComicMetadata) result.comicMetadata = filteredComicMetadata;

    return { resolved: result, sources, providerIds };
  }

  private extractField(candidate: MetadataCandidate, field: MetadataField): unknown {
    const map: Partial<Record<MetadataField, keyof MetadataCandidate>> = {
      title: 'title',
      subtitle: 'subtitle',
      description: 'description',
      authors: 'authors',
      publisher: 'publisher',
      publishedYear: 'publishedYear',
      language: 'language',
      pageCount: 'pageCount',
      seriesName: 'seriesName',
      seriesIndex: 'seriesIndex',
      genres: 'genres',
      cover: 'coverUrl',
      narrators: 'narrators',
      duration: 'durationSeconds',
      abridged: 'abridged',
    };
    const key = map[field];
    return key ? candidate[key] : undefined;
  }

  private copyPublishedDateForYear(result: ResolvedMetadataFields, candidate: MetadataCandidate, field: MetadataField): void {
    if (field === 'publishedYear' && candidate.publishedDate !== undefined) {
      result.publishedDate = candidate.publishedDate;
    }
  }

  private collectCommunityRatings(providerKeys: MetadataProviderKey[], byProvider: Map<string, MetadataCandidate>): BookCommunityRating[] {
    const updatedAt = new Date().toISOString();
    const ratings: BookCommunityRating[] = [];
    const seen = new Set<MetadataProviderKey>();

    for (const providerKey of providerKeys) {
      if (seen.has(providerKey)) continue;
      seen.add(providerKey);

      const candidate = byProvider.get(providerKey);
      if (!candidate) continue;

      const rating = this.normalizeCommunityRating(candidate.communityRating);
      if (rating === undefined) continue;

      ratings.push({
        provider: providerKey,
        rating,
        ratingCount: this.normalizeCommunityRatingCount(candidate.communityRatingCount) ?? null,
        updatedAt,
      });
    }

    return ratings;
  }

  private normalizeCommunityRating(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5 ? value : undefined;
  }

  private normalizeCommunityRatingCount(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
  }

  private resolveSeriesMemberships(
    byProvider: Map<string, MetadataCandidate>,
    resolved: ResolvedMetadataFields,
    sources: Record<string, string>,
  ): MetadataSeriesMembership[] | undefined {
    const seriesProvider = sources.seriesName as MetadataProviderKey | undefined;
    if (!seriesProvider || resolved.seriesName === undefined) return undefined;

    const memberships = this.normalizeSeriesMemberships(byProvider.get(seriesProvider)?.seriesMemberships);
    if (!memberships.length) return undefined;

    const indexProvider = sources.seriesIndex as MetadataProviderKey | undefined;
    if (indexProvider !== seriesProvider || resolved.seriesIndex === undefined) return undefined;
    return memberships;
  }

  private normalizeSeriesMemberships(memberships: readonly MetadataSeriesMembership[] | undefined): MetadataSeriesMembership[] {
    if (!memberships?.length) return [];

    const normalized: MetadataSeriesMembership[] = [];
    const seen = new Set<string>();
    for (const membership of memberships) {
      const seriesName = normalizeMetadataText(membership.seriesName);
      const key = normalizeMetadataTextKey(seriesName);
      if (!seriesName || !key || seen.has(key)) continue;

      const seriesIndex = typeof membership.seriesIndex === 'number' && Number.isFinite(membership.seriesIndex) ? membership.seriesIndex : null;
      seen.add(key);
      normalized.push({ seriesName, seriesIndex });
    }

    return normalized;
  }

  private mergeGenres(providerKeys: MetadataProviderKey[], byProvider: Map<string, MetadataCandidate>, blockedGenreTokens: ReadonlySet<string>) {
    const merged: string[] = [];
    const seen = new Set<string>();
    let sourceProvider: MetadataProviderKey | undefined;

    for (const providerKey of providerKeys) {
      const candidate = byProvider.get(providerKey);
      if (!candidate?.genres?.length) continue;

      for (const genre of filterGenresAgainstBlocklist(candidate.genres, blockedGenreTokens)) {
        const token = genre.toLowerCase();
        if (seen.has(token)) continue;
        if (!sourceProvider) sourceProvider = providerKey;
        seen.add(token);
        merged.push(genre);
      }
    }

    return { genres: merged, sourceProvider };
  }

  private isMissing(value: unknown): boolean {
    if (value === null || value === undefined || value === '') return true;
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  private filterExistingComicMetadata(
    resolved: ComicMetadataFields | undefined,
    existing: Partial<Record<keyof ComicMetadataFields, unknown>> | null | undefined,
  ): ComicMetadataFields | undefined {
    if (!resolved || !existing) return resolved;

    const filtered: ComicMetadataFields = {};
    for (const [key, value] of Object.entries(resolved) as [keyof ComicMetadataFields, ComicMetadataFields[keyof ComicMetadataFields]][]) {
      if (value === undefined || !this.isMissing(existing[key])) continue;
      filtered[key] = value as never;
    }

    return this.hasComicMetadata(filtered) ? filtered : undefined;
  }

  private resolveComicMetadata(preferences: MetadataFetchPreferences, byProvider: Map<string, MetadataCandidate>): ComicMetadataFields | undefined {
    const preferredProviders = [
      ...(preferences.fields.seriesName?.providers ?? []),
      ...(preferences.fields.title?.providers ?? []),
      ...byProvider.keys(),
    ] as MetadataProviderKey[];

    const seen = new Set<MetadataProviderKey>();
    for (const providerKey of preferredProviders) {
      if (seen.has(providerKey)) continue;
      seen.add(providerKey);

      const comicMetadata = byProvider.get(providerKey)?.comicMetadata;
      if (comicMetadata && this.hasComicMetadata(comicMetadata)) return comicMetadata;
    }
    return undefined;
  }

  private hasComicMetadata(comicMetadata: ComicMetadataFields): boolean {
    const scalarFields: (keyof ComicMetadataFields)[] = ['issueNumber', 'volumeName'];
    for (const field of scalarFields) {
      const value = comicMetadata[field];
      if (typeof value === 'string' && value.trim().length > 0) return true;
    }

    const arrayFields: (keyof ComicMetadataFields)[] = [
      'storyArcs',
      'pencillers',
      'inkers',
      'colorists',
      'letterers',
      'coverArtists',
      'characters',
      'teams',
      'locations',
    ];
    for (const field of arrayFields) {
      const value = comicMetadata[field];
      if (Array.isArray(value) && value.length > 0) return true;
    }
    return false;
  }
}
