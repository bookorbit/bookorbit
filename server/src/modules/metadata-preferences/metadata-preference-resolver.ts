import { Injectable } from '@nestjs/common';
import {
  ALL_METADATA_FIELDS,
  FieldPreference,
  FieldPreferenceOverrides,
  GenreMergeMode,
  MetadataFetchPreferences,
  MetadataFetchOptions,
  MetadataField,
  MetadataProviderKey,
  MergeStrategy,
} from '@projectx/types';

const DEFAULT_PROVIDER_ORDER: MetadataProviderKey[] = [
  MetadataProviderKey.GOODREADS,
  MetadataProviderKey.GOOGLE,
  MetadataProviderKey.AMAZON,
  MetadataProviderKey.OPEN_LIBRARY,
];

const DEFAULT_MERGE_STRATEGY: MergeStrategy = 'overwriteIfProvided';
const MERGE_STRATEGIES: Set<MergeStrategy> = new Set(['fillMissing', 'overwrite', 'overwriteIfProvided']);
const GENRE_MERGE_MODES: Set<GenreMergeMode> = new Set(['firstProvider', 'merge']);

const PROVIDERS_WITH_ITUNES: MetadataProviderKey[] = [
  MetadataProviderKey.GOODREADS,
  MetadataProviderKey.GOOGLE,
  MetadataProviderKey.ITUNES,
  MetadataProviderKey.AMAZON,
  MetadataProviderKey.OPEN_LIBRARY,
];

const FIELD_DEFAULTS: Partial<Record<MetadataField, Partial<FieldPreference>>> = {
  title: { mergeStrategy: 'fillMissing', providers: PROVIDERS_WITH_ITUNES },
  subtitle: { providers: PROVIDERS_WITH_ITUNES },
  description: { providers: PROVIDERS_WITH_ITUNES },
  cover: {
    providers: [
      MetadataProviderKey.AMAZON,
      MetadataProviderKey.ITUNES,
      MetadataProviderKey.GOODREADS,
      MetadataProviderKey.GOOGLE,
      MetadataProviderKey.OPEN_LIBRARY,
    ],
  },
  authors: { providers: PROVIDERS_WITH_ITUNES },
  genres: { providers: [MetadataProviderKey.GOODREADS, MetadataProviderKey.GOOGLE, MetadataProviderKey.ITUNES] },
};

@Injectable()
export class MetadataPreferenceResolver {
  getDefaultPreferences(): MetadataFetchPreferences {
    const fields = {} as Record<MetadataField, FieldPreference>;
    for (const field of ALL_METADATA_FIELDS) {
      const fieldDefault = FIELD_DEFAULTS[field];
      fields[field] = {
        enabled: true,
        providers: fieldDefault?.providers ? [...fieldDefault.providers] : [...DEFAULT_PROVIDER_ORDER],
        mergeStrategy: DEFAULT_MERGE_STRATEGY,
        ...(fieldDefault?.mergeStrategy ? { mergeStrategy: fieldDefault.mergeStrategy } : {}),
      };
    }
    const options: MetadataFetchOptions = {
      genres: {
        mode: 'merge',
      },
      saveProviderIds: true,
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
    const registered = new Set(registeredKeys);
    for (const field of ALL_METADATA_FIELDS) {
      const fallback = defaults.fields[field];
      const fp = this.normalizeFieldPreference(preferences?.fields?.[field], fallback);
      if (!registeredKeys.length) {
        fields[field] = fp;
        continue;
      }

      const filtered = fp.providers.filter((k) => registered.has(k));
      const fallbackFiltered = fallback.providers.filter((k) => registered.has(k));

      // Preserve explicit provider selections; only drop unavailable providers.
      // If filtering removes all providers, fall back to the field default set.
      fields[field] = { ...fp, providers: filtered.length ? filtered : fallbackFiltered };
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
    const saveProviderIds = typeof candidate.saveProviderIds === 'boolean' ? candidate.saveProviderIds : fallback.saveProviderIds;

    return {
      genres: { mode },
      saveProviderIds,
    };
  }
}
