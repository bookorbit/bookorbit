import { Injectable, Logger } from '@nestjs/common';
import {
  AudiobookChapter,
  ComicMetadataFields,
  FieldPreference,
  MetadataCandidate,
  MetadataFetchPreferences,
  MetadataField,
  MetadataProviderKey,
} from '@projectx/types';
import { firstValueFrom, toArray } from 'rxjs';

import { MetadataPreferenceResolver } from '../metadata-preferences/metadata-preference-resolver';
import { MetadataPreferencesService } from '../metadata-preferences/metadata-preferences.service';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { ProviderThrottleTracker } from './provider-throttle.tracker';
import { MetadataSearchParams } from './providers/metadata-search-params';

export type ResolvedMetadataFields = Partial<Record<MetadataField, string | string[] | number | null>> & {
  coverUrl?: string;
  chapters?: AudiobookChapter[];
  comicMetadata?: ComicMetadataFields;
};
type ResolvedProviderIds = Partial<Record<MetadataProviderKey, string>>;

@Injectable()
export class MetadataFetchPipeline {
  private readonly logger = new Logger(MetadataFetchPipeline.name);

  constructor(
    private readonly fetchService: MetadataFetchService,
    private readonly preferencesService: MetadataPreferencesService,
    private readonly resolver: MetadataPreferenceResolver,
    private readonly registry: ProviderRegistry,
    private readonly throttleTracker: ProviderThrottleTracker,
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

  private deriveProviderSet(preferences: MetadataFetchPreferences, registeredKeys: MetadataProviderKey[]) {
    const registered = new Set(registeredKeys);
    const keys = new Set<MetadataProviderKey>();

    for (const [, fp] of Object.entries(preferences.fields) as [MetadataField, FieldPreference][]) {
      if (!fp.enabled) continue;
      fp.providers.filter((k) => registered.has(k)).forEach((k) => keys.add(k));
    }

    const active: MetadataProviderKey[] = [];
    for (const key of keys) {
      if (this.throttleTracker.isThrottled(key)) {
        this.logger.warn(`[${key}] throttled - skipping metadata fetch for this run`);
      } else {
        active.push(key);
      }
    }
    return active;
  }

  private applyPreferences(
    preferences: MetadataFetchPreferences,
    byProvider: Map<string, MetadataCandidate>,
    existing: Partial<Record<MetadataField, unknown>>,
  ): { resolved: ResolvedMetadataFields; sources: Record<string, string>; providerIds: ResolvedProviderIds } {
    const result: ResolvedMetadataFields = {};
    const sources: Record<string, string> = {};

    for (const field of Object.keys(preferences.fields) as MetadataField[]) {
      const fp = preferences.fields[field];
      if (!fp.enabled) continue;

      if (field === 'genres' && preferences.options?.genres.mode === 'merge') {
        const { genres, sourceProvider } = this.mergeGenres(fp.providers as MetadataProviderKey[], byProvider);
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

    // Pass through chapters from the first candidate that has them, using the
    // narrators field's provider preference order as the authority for audiobook data.
    const narratorProviders = preferences.fields['narrators']?.providers ?? [];
    const chapterProviders = [...narratorProviders, ...byProvider.keys()];
    for (const providerKey of chapterProviders) {
      const candidate = byProvider.get(providerKey);
      if (candidate?.chapters?.length) {
        result.chapters = candidate.chapters;
        break;
      }
    }

    const comicMetadata = this.resolveComicMetadata(preferences, byProvider);
    if (comicMetadata) result.comicMetadata = comicMetadata;

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
