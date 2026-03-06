import { Injectable } from '@nestjs/common';
import { FieldPreference, MetadataCandidate, MetadataFetchPreferences, MetadataField, MetadataProviderKey } from '@projectx/types';
import { firstValueFrom, toArray } from 'rxjs';

import { MetadataPreferenceResolver } from '../metadata-preferences/metadata-preference-resolver';
import { MetadataPreferencesService } from '../metadata-preferences/metadata-preferences.service';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { MetadataSearchParams } from './providers/metadata-search-params';

export type ResolvedMetadataFields = Partial<Record<MetadataField, string | string[] | number | null>> & { coverUrl?: string };
type ResolvedProviderIds = Partial<Record<MetadataProviderKey, string>>;

@Injectable()
export class MetadataFetchPipeline {
  constructor(
    private readonly fetchService: MetadataFetchService,
    private readonly preferencesService: MetadataPreferencesService,
    private readonly resolver: MetadataPreferenceResolver,
    private readonly providerConfigService: ProviderConfigService,
    private readonly registry: ProviderRegistry,
  ) {}

  async run(
    params: MetadataSearchParams,
    existingFields: Partial<Record<MetadataField, unknown>>,
    libraryId?: number,
  ): Promise<ResolvedMetadataFields> {
    const { resolved } = await this.runInternal(params, existingFields, libraryId);
    return resolved;
  }

  async runWithSources(
    params: MetadataSearchParams,
    existingFields: Partial<Record<MetadataField, unknown>>,
    libraryId?: number,
  ): Promise<{ resolved: ResolvedMetadataFields; sources: Record<string, string>; providerIds: ResolvedProviderIds }> {
    return this.runInternal(params, existingFields, libraryId);
  }

  private async runInternal(
    params: MetadataSearchParams,
    existingFields: Partial<Record<MetadataField, unknown>>,
    libraryId?: number,
  ): Promise<{ resolved: ResolvedMetadataFields; sources: Record<string, string>; providerIds: ResolvedProviderIds }> {
    const global = await this.preferencesService.getGlobal();
    const overrides = libraryId ? (await this.preferencesService.getForLibrary(libraryId, global)).overrides : null;
    const registeredKeys = this.registry.all().map((p) => p.key) as MetadataProviderKey[];
    const preferences: MetadataFetchPreferences = this.resolver.withForwardCompatibility(this.resolver.resolve(global, overrides), registeredKeys);

    const enabledProviders = await this.deriveProviderSet(preferences, registeredKeys);
    const candidates = await firstValueFrom(this.fetchService.search(params, enabledProviders).pipe(toArray()), {
      defaultValue: [] as MetadataCandidate[],
    });

    const byProvider = new Map<string, MetadataCandidate>();
    for (const c of candidates) {
      if (!byProvider.has(c.provider)) byProvider.set(c.provider, c);
    }
    return this.applyPreferences(preferences, byProvider, existingFields, registeredKeys);
  }

  private async deriveProviderSet(preferences: MetadataFetchPreferences, registeredKeys: MetadataProviderKey[]) {
    const registered = new Set(registeredKeys);
    const keys = new Set<MetadataProviderKey>();
    const mergeGenresFromAllConfigured =
      preferences.fields.genres.enabled &&
      preferences.options?.genres.mode === 'merge' &&
      preferences.options?.genres.providerScope === 'allConfiguredProviders';

    if (mergeGenresFromAllConfigured) {
      const configuredKeys = await this.getEnabledConfiguredProviders(registered);
      configuredKeys.forEach((k) => keys.add(k));
    }

    for (const [field, fp] of Object.entries(preferences.fields) as [MetadataField, FieldPreference][]) {
      if (!fp.enabled) continue;
      if (field === 'genres' && mergeGenresFromAllConfigured) continue;
      fp.providers.filter((k) => registered.has(k)).forEach((k) => keys.add(k));
    }
    return [...keys];
  }

  private async getEnabledConfiguredProviders(registered: Set<MetadataProviderKey>): Promise<MetadataProviderKey[]> {
    try {
      const statuses = await this.providerConfigService.getProviderStatuses();
      return statuses.filter((s) => s.enabled && s.configured && registered.has(s.key)).map((s) => s.key);
    } catch {
      return [...registered];
    }
  }

  private applyPreferences(
    preferences: MetadataFetchPreferences,
    byProvider: Map<string, MetadataCandidate>,
    existing: Partial<Record<MetadataField, unknown>>,
    providerOrder: MetadataProviderKey[],
  ): { resolved: ResolvedMetadataFields; sources: Record<string, string>; providerIds: ResolvedProviderIds } {
    const result: ResolvedMetadataFields = {};
    const sources: Record<string, string> = {};

    for (const field of Object.keys(preferences.fields) as MetadataField[]) {
      const fp = preferences.fields[field];
      if (!fp.enabled) continue;

      if (field === 'genres' && preferences.options?.genres.mode === 'merge') {
        const providerKeys =
          preferences.options.genres.providerScope === 'allConfiguredProviders' ? providerOrder : (fp.providers as MetadataProviderKey[]);
        const { genres, sourceProvider } = this.mergeGenres(providerKeys, byProvider);
        if (!genres.length) continue;

        const existingValue = existing[field];
        switch (fp.mergeStrategy) {
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

      for (const providerKey of fp.providers) {
        const candidate = byProvider.get(providerKey);
        if (!candidate) continue;

        const value = this.extractField(candidate, field);
        if (value === undefined || value === null) continue;

        if (field === 'cover') {
          result.coverUrl = candidate.coverUrl;
          sources['coverUrl'] = providerKey;
          break;
        }

        const existingValue = existing[field];
        switch (fp.mergeStrategy) {
          case 'fillMissing':
            if (this.isMissing(existingValue)) {
              (result as Record<string, unknown>)[field] = value;
              sources[field] = providerKey;
            }
            break;
          case 'overwrite':
          case 'overwriteIfProvided':
            (result as Record<string, unknown>)[field] = value;
            sources[field] = providerKey;
            break;
        }
        break;
      }
    }

    const providerIds: ResolvedProviderIds = {};
    if (preferences.options?.saveProviderIds) {
      for (const candidate of byProvider.values()) {
        if (candidate.providerId) providerIds[candidate.provider] = candidate.providerId;
      }
    }

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
    };
    const key = map[field];
    return key ? candidate[key] : undefined;
  }

  private mergeGenres(providerKeys: MetadataProviderKey[], byProvider: Map<string, MetadataCandidate>) {
    const merged: string[] = [];
    const seen = new Set<string>();
    let sourceProvider: MetadataProviderKey | undefined;

    for (const providerKey of providerKeys) {
      const candidate = byProvider.get(providerKey);
      if (!candidate?.genres?.length) continue;
      if (!sourceProvider) sourceProvider = providerKey;

      for (const raw of candidate.genres) {
        const genre = raw.trim();
        if (!genre) continue;
        const token = genre.toLowerCase();
        if (seen.has(token)) continue;
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
}
