import { Injectable } from '@nestjs/common';
import { MetadataCandidate, MetadataFetchPreferences, MetadataField } from '@projectx/types';
import { firstValueFrom, toArray } from 'rxjs';

import { MetadataPreferenceResolver } from '../metadata-preferences/metadata-preference-resolver';
import { MetadataPreferencesService } from '../metadata-preferences/metadata-preferences.service';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { MetadataSearchParams } from './providers/metadata-search-params';

export type ResolvedMetadataFields = Partial<Record<MetadataField, string | string[] | number | null>> & { coverUrl?: string };

@Injectable()
export class MetadataFetchPipeline {
  constructor(
    private readonly fetchService: MetadataFetchService,
    private readonly preferencesService: MetadataPreferencesService,
    private readonly resolver: MetadataPreferenceResolver,
    private readonly registry: ProviderRegistry,
  ) {}

  async run(
    params: MetadataSearchParams,
    existingFields: Partial<Record<MetadataField, unknown>>,
    libraryId?: number,
  ): Promise<ResolvedMetadataFields> {
    const global = await this.preferencesService.getGlobal();
    const overrides = libraryId ? (await this.preferencesService.getForLibrary(libraryId, global)).overrides : null;
    const registeredKeys = this.registry.all().map((p) => p.key);
    const preferences: MetadataFetchPreferences = this.resolver.withForwardCompatibility(this.resolver.resolve(global, overrides), registeredKeys);

    const enabledProviders = this.deriveProviderSet(preferences, registeredKeys);
    const candidates = await firstValueFrom(this.fetchService.search(params, enabledProviders).pipe(toArray()), {
      defaultValue: [] as MetadataCandidate[],
    });

    const byProvider = new Map<string, MetadataCandidate>();
    for (const c of candidates) {
      if (!byProvider.has(c.provider)) byProvider.set(c.provider, c);
    }
    return this.applyPreferences(preferences, byProvider, existingFields);
  }

  private deriveProviderSet(preferences: MetadataFetchPreferences, registeredKeys: string[]) {
    const registered = new Set(registeredKeys);
    const keys = new Set<string>();
    for (const fp of Object.values(preferences.fields)) {
      if (fp.enabled) fp.providers.filter((k) => registered.has(k)).forEach((k) => keys.add(k));
    }
    return [...keys] as Parameters<typeof this.fetchService.search>[1];
  }

  private applyPreferences(
    preferences: MetadataFetchPreferences,
    byProvider: Map<string, MetadataCandidate>,
    existing: Partial<Record<MetadataField, unknown>>,
  ): ResolvedMetadataFields {
    const result: ResolvedMetadataFields = {};

    for (const field of Object.keys(preferences.fields) as MetadataField[]) {
      const fp = preferences.fields[field];
      if (!fp.enabled) continue;

      for (const providerKey of fp.providers) {
        const candidate = byProvider.get(providerKey);
        if (!candidate) continue;

        const value = this.extractField(candidate, field);
        if (value === undefined || value === null) continue;

        if (field === 'cover') {
          result.coverUrl = candidate.coverUrl;
          break;
        }

        const existingValue = existing[field];
        switch (fp.mergeStrategy) {
          case 'fillMissing':
            if (existingValue === null || existingValue === undefined || existingValue === '') {
              (result as Record<string, unknown>)[field] = value;
            }
            break;
          case 'overwrite':
          case 'overwriteIfProvided':
            (result as Record<string, unknown>)[field] = value;
            break;
        }
        break;
      }
    }

    return result;
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
}
