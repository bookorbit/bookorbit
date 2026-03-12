import { Injectable } from '@nestjs/common';
import {
  ALL_METADATA_FIELDS,
  FieldPreference,
  FieldPreferenceOverrides,
  GenreMergeMode,
  GenreProviderScope,
  MetadataFetchPreferences,
  MetadataFetchOptions,
  MetadataField,
  MetadataProviderKey,
  MergeStrategy,
} from '@projectx/types';

const DEFAULT_PROVIDER_ORDER: MetadataProviderKey[] = [
  MetadataProviderKey.GOOGLE,
  MetadataProviderKey.AMAZON,
  MetadataProviderKey.GOODREADS,
  MetadataProviderKey.OPEN_LIBRARY,
  MetadataProviderKey.ITUNES,
];

const DEFAULT_MERGE_STRATEGY: MergeStrategy = 'overwriteIfProvided';
const MERGE_STRATEGIES: Set<MergeStrategy> = new Set(['fillMissing', 'overwrite', 'overwriteIfProvided']);
const GENRE_MERGE_MODES: Set<GenreMergeMode> = new Set(['firstProvider', 'merge']);
const GENRE_PROVIDER_SCOPES: Set<GenreProviderScope> = new Set(['selectedProviders', 'allConfiguredProviders']);

const FIELD_DEFAULTS: Partial<Record<MetadataField, Partial<FieldPreference>>> = {
  title: { mergeStrategy: 'fillMissing' },
};

@Injectable()
export class MetadataPreferenceResolver {
  getDefaultPreferences(): MetadataFetchPreferences {
    const fields = {} as Record<MetadataField, FieldPreference>;
    for (const field of ALL_METADATA_FIELDS) {
      fields[field] = {
        enabled: true,
        providers: [...DEFAULT_PROVIDER_ORDER],
        mergeStrategy: DEFAULT_MERGE_STRATEGY,
        ...FIELD_DEFAULTS[field],
      };
    }
    const options: MetadataFetchOptions = {
      genres: {
        mode: 'firstProvider',
        providerScope: 'selectedProviders',
      },
      saveProviderIds: false,
    };
    return { fields, options };
  }

  resolve(global: MetadataFetchPreferences, libraryOverrides?: FieldPreferenceOverrides | null): MetadataFetchPreferences {
    const defaults = this.getDefaultPreferences();
    const fields = {} as Record<MetadataField, FieldPreference>;
    for (const field of ALL_METADATA_FIELDS) {
      const chosen = (libraryOverrides && libraryOverrides[field]) ?? global?.fields?.[field];
      fields[field] = this.normalizeFieldPreference(chosen, defaults.fields[field]);
    }
    const options = this.normalizeOptions(global?.options, defaults.options!);
    return { fields, options };
  }

  withForwardCompatibility(preferences: MetadataFetchPreferences, registeredKeys: MetadataProviderKey[]): MetadataFetchPreferences {
    const defaults = this.getDefaultPreferences();
    const fields = {} as Record<MetadataField, FieldPreference>;
    for (const field of ALL_METADATA_FIELDS) {
      const fp = this.normalizeFieldPreference(preferences?.fields?.[field], defaults.fields[field]);
      if (!registeredKeys.length) {
        fields[field] = fp;
        continue;
      }
      const existing = new Set(fp.providers);
      const missing = registeredKeys.filter((k) => !existing.has(k));
      fields[field] = missing.length ? { ...fp, providers: [...fp.providers, ...missing] } : fp;
    }
    const options = this.normalizeOptions(preferences?.options, defaults.options!);
    return { fields, options };
  }

  resolveField(preferences: MetadataFetchPreferences, field: MetadataField): FieldPreference {
    return preferences.fields[field];
  }

  private normalizeFieldPreference(value: unknown, fallback: FieldPreference): FieldPreference {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ...fallback, providers: [...fallback.providers] };
    }

    const candidate = value as Partial<FieldPreference>;
    const enabled = typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled;
    const providers =
      Array.isArray(candidate.providers) && candidate.providers.every((p) => typeof p === 'string')
        ? [...candidate.providers]
        : [...fallback.providers];
    const mergeStrategy = MERGE_STRATEGIES.has(candidate.mergeStrategy as MergeStrategy)
      ? (candidate.mergeStrategy as MergeStrategy)
      : fallback.mergeStrategy;

    return { enabled, providers, mergeStrategy };
  }

  private normalizeOptions(value: unknown, fallback: MetadataFetchOptions): MetadataFetchOptions {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { genres: { ...fallback.genres }, saveProviderIds: fallback.saveProviderIds };
    }

    const candidate = value as Partial<MetadataFetchOptions>;
    const genresCandidate: Partial<MetadataFetchOptions['genres']> =
      candidate.genres && typeof candidate.genres === 'object' && !Array.isArray(candidate.genres) ? candidate.genres : {};

    const mode = GENRE_MERGE_MODES.has(genresCandidate.mode as GenreMergeMode) ? (genresCandidate.mode as GenreMergeMode) : fallback.genres.mode;
    const providerScope = GENRE_PROVIDER_SCOPES.has(genresCandidate.providerScope as GenreProviderScope)
      ? (genresCandidate.providerScope as GenreProviderScope)
      : fallback.genres.providerScope;
    const saveProviderIds = typeof candidate.saveProviderIds === 'boolean' ? candidate.saveProviderIds : fallback.saveProviderIds;

    return {
      genres: { mode, providerScope },
      saveProviderIds,
    };
  }
}
