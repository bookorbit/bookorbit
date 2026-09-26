import { Injectable } from '@nestjs/common';
import {
  ALL_METADATA_FIELDS,
  COMMUNITY_RATING_PROVIDER_KEYS,
  FieldPreference,
  FieldPreferenceOverrides,
  GENRE_MERGE_STRATEGIES,
  GENRE_MERGE_MODES,
  MAX_METADATA_GENRE_COUNT,
  MetadataFetchPreferences,
  MetadataFetchOptions,
  MetadataField,
  MetadataMergeStrategy,
  MetadataProviderKey,
  MERGE_STRATEGIES,
  MergeStrategy,
  PROVIDER_ID_FETCH_MODES,
  ProviderIdFetchMode,
} from '@bookorbit/types';

import { normalizeGenreBlocklist } from '../../common/utils/genre-fetch-options.utils';

const DEFAULT_PROVIDER_ORDER: MetadataProviderKey[] = [
  MetadataProviderKey.GOODREADS,
  MetadataProviderKey.GOOGLE,
  MetadataProviderKey.AMAZON,
  MetadataProviderKey.KOBO,
  MetadataProviderKey.OPEN_LIBRARY,
];

const DEFAULT_MERGE_STRATEGY: MergeStrategy = 'overwriteIfProvided';
const MERGE_STRATEGY_SET = new Set<MetadataMergeStrategy>(MERGE_STRATEGIES);
const GENRE_MERGE_STRATEGY_SET = new Set<MetadataMergeStrategy>(GENRE_MERGE_STRATEGIES);
const GENRE_MERGE_MODE_SET = new Set(GENRE_MERGE_MODES);
const PROVIDER_ID_FETCH_MODE_SET = new Set(PROVIDER_ID_FETCH_MODES);
const AUDIOBOOK_ONLY_PROVIDERS = new Set<MetadataProviderKey>([
  MetadataProviderKey.AUDIBLE,
  MetadataProviderKey.AUDNEXUS,
  MetadataProviderKey.LIBROFM,
]);

const PROVIDERS_WITH_ITUNES: MetadataProviderKey[] = [
  MetadataProviderKey.GOODREADS,
  MetadataProviderKey.GOOGLE,
  MetadataProviderKey.ITUNES,
  MetadataProviderKey.AMAZON,
  MetadataProviderKey.KOBO,
  MetadataProviderKey.OPEN_LIBRARY,
];

const FIELD_DEFAULTS: Partial<Record<MetadataField, Partial<FieldPreference>>> = {
  title: { mergeStrategy: 'overwriteIfProvided', providers: PROVIDERS_WITH_ITUNES },
  subtitle: { providers: PROVIDERS_WITH_ITUNES },
  description: { providers: PROVIDERS_WITH_ITUNES },
  cover: {
    providers: [
      MetadataProviderKey.AMAZON,
      MetadataProviderKey.ITUNES,
      MetadataProviderKey.KOBO,
      MetadataProviderKey.GOODREADS,
      MetadataProviderKey.GOOGLE,
      MetadataProviderKey.OPEN_LIBRARY,
    ],
  },
  // Audnexus is left out: it repeats the Audible request and would bring Audible's chapter
  // timings along with the art.
  audioCover: {
    providers: [
      MetadataProviderKey.AUDIBLE,
      MetadataProviderKey.LIBROFM,
      MetadataProviderKey.ITUNES,
      MetadataProviderKey.AMAZON,
      MetadataProviderKey.KOBO,
      MetadataProviderKey.GOODREADS,
      MetadataProviderKey.GOOGLE,
      MetadataProviderKey.OPEN_LIBRARY,
    ],
  },
  authors: { providers: PROVIDERS_WITH_ITUNES },
  genres: {
    mergeStrategy: 'mergeExisting',
    providers: [MetadataProviderKey.GOODREADS, MetadataProviderKey.GOOGLE, MetadataProviderKey.ITUNES, MetadataProviderKey.KOBO],
  },
  communityRating: { providers: [...COMMUNITY_RATING_PROVIDER_KEYS] },
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
        blocklist: [],
        maxCount: null,
      },
      saveProviderIds: true,
      providerIdMode: 'preferExisting',
    };
    return { fields, options };
  }

  resolve(global: MetadataFetchPreferences, libraryOverrides?: FieldPreferenceOverrides | null): MetadataFetchPreferences {
    const defaults = this.getDefaultPreferences();
    const fields = {} as Record<MetadataField, FieldPreference>;
    const globalFields = this.withSeededAudioCoverRule(global?.fields);
    for (const field of ALL_METADATA_FIELDS) {
      const chosen = (libraryOverrides && libraryOverrides[field]) ?? globalFields?.[field];
      fields[field] = this.normalizeFieldPreference(field, chosen, defaults.fields[field]);
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
      const fp = this.normalizeFieldPreference(field, preferences?.fields?.[field], fallback);
      if (!registeredKeys.length) {
        fields[field] = fp;
        continue;
      }

      const filtered = fp.providers.filter((k) => registered.has(k));
      const fallbackFiltered = fallback.providers.filter((k) => registered.has(k));

      // Preserve explicit provider selections; only drop unavailable providers.
      // If filtering removes all listed providers, fall back to the field default set.
      fields[field] = { ...fp, providers: filtered.length || fp.providers.length === 0 ? filtered : fallbackFiltered };
    }
    const options = this.normalizeOptions(preferences?.options, defaults.options!);
    return { fields, options };
  }

  /**
   * The Audiobook cover rule for a scope that stored only a Cover rule, from before the two were
   * split. A user who disabled cover fetching or chose fill-missing keeps that for audiobook art,
   * and a provider list that already names an audiobook source was tuned for audiobooks, so it is
   * kept too. Anything else starts from the audiobook-first default order.
   */
  seedAudioCoverRule(cover: unknown): FieldPreference {
    const fallback = this.getDefaultPreferences().fields.audioCover;
    const normalized = this.normalizeFieldPreference('cover', cover, this.getDefaultPreferences().fields.cover);
    const tunedForAudio = normalized.providers.some((provider) => AUDIOBOOK_ONLY_PROVIDERS.has(provider));
    return {
      enabled: normalized.enabled,
      mergeStrategy: normalized.mergeStrategy,
      providers: tunedForAudio ? [...normalized.providers] : [...fallback.providers],
    };
  }

  withSeededAudioCoverRule<T extends Partial<Record<MetadataField, unknown>>>(fields: T | null | undefined): T | null | undefined {
    if (!this.isRecord(fields) || fields.audioCover !== undefined || !this.isRecord(fields.cover)) return fields;
    return { ...fields, audioCover: this.seedAudioCoverRule(fields.cover) };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private normalizeFieldPreference(field: MetadataField, value: unknown, fallback: FieldPreference): FieldPreference {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ...fallback, providers: [...fallback.providers] };
    }

    const candidate = value as Partial<FieldPreference>;
    const enabled = typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled;
    const providers =
      Array.isArray(candidate.providers) && candidate.providers.every((p) => typeof p === 'string')
        ? [...candidate.providers]
        : [...fallback.providers];
    const mergeStrategySet = field === 'genres' ? GENRE_MERGE_STRATEGY_SET : MERGE_STRATEGY_SET;
    const mergeStrategy = mergeStrategySet.has(candidate.mergeStrategy as MetadataMergeStrategy)
      ? (candidate.mergeStrategy as MetadataMergeStrategy)
      : fallback.mergeStrategy;

    return { enabled, providers, mergeStrategy };
  }

  private normalizeOptions(value: unknown, fallback: MetadataFetchOptions): MetadataFetchOptions {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return {
        genres: { ...fallback.genres, blocklist: [...fallback.genres.blocklist] },
        saveProviderIds: fallback.saveProviderIds,
        providerIdMode: fallback.providerIdMode,
      };
    }

    const candidate = value as Partial<MetadataFetchOptions>;
    const genresCandidate: Partial<MetadataFetchOptions['genres']> =
      candidate.genres && typeof candidate.genres === 'object' && !Array.isArray(candidate.genres) ? candidate.genres : {};

    const mode = GENRE_MERGE_MODE_SET.has(genresCandidate.mode as MetadataFetchOptions['genres']['mode'])
      ? (genresCandidate.mode as MetadataFetchOptions['genres']['mode'])
      : fallback.genres.mode;
    const blocklist = normalizeGenreBlocklist(genresCandidate.blocklist, fallback.genres.blocklist);
    const maxCount = this.normalizeGenreMaxCount(genresCandidate.maxCount, fallback.genres.maxCount);
    const saveProviderIds = typeof candidate.saveProviderIds === 'boolean' ? candidate.saveProviderIds : fallback.saveProviderIds;
    const providerIdMode = PROVIDER_ID_FETCH_MODE_SET.has(candidate.providerIdMode as ProviderIdFetchMode)
      ? (candidate.providerIdMode as ProviderIdFetchMode)
      : fallback.providerIdMode;

    return {
      genres: { mode, blocklist, maxCount },
      saveProviderIds,
      providerIdMode,
    };
  }

  private normalizeGenreMaxCount(value: unknown, fallback: number | null): number | null {
    if (value === null) return null;
    return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_METADATA_GENRE_COUNT ? (value as number) : fallback;
  }
}
