import { Injectable } from '@nestjs/common';
import {
  ALL_AUTHOR_METADATA_FIELDS,
  AuthorAutoEnrichmentWriteMode,
  providerSupportsAuthorField,
  AuthorFieldPreference,
  AuthorMetadataField,
  AuthorMetadataPreferences,
  AuthorMetadataProviderKey,
  MERGE_STRATEGIES,
  MergeStrategy,
} from '@bookorbit/types';

// Goodreads carries the richer biography for literary and academic authors and
// was the only source with a photo for every author sampled, so it leads.
// Audnexus still wins outright for technical and business authors, where
// Goodreads pages are frequently bare, and first-wins ordering falls through to
// it whenever Goodreads has nothing.
const DESCRIPTION_PROVIDERS: AuthorMetadataProviderKey[] = [AuthorMetadataProviderKey.GOODREADS, AuthorMetadataProviderKey.AUDNEXUS];
const PHOTO_PROVIDERS: AuthorMetadataProviderKey[] = [AuthorMetadataProviderKey.GOODREADS, AuthorMetadataProviderKey.AUDNEXUS];

// Audnexus returns only asin/name/description/image, so Goodreads is the sole
// source for everything below.
const GOODREADS_ONLY: AuthorMetadataProviderKey[] = [AuthorMetadataProviderKey.GOODREADS];

const FIELD_DEFAULT_PROVIDERS: Record<AuthorMetadataField, AuthorMetadataProviderKey[]> = {
  description: DESCRIPTION_PROVIDERS,
  photo: PHOTO_PROVIDERS,
  birthDate: GOODREADS_ONLY,
  deathDate: GOODREADS_ONLY,
  website: GOODREADS_ONLY,
  genres: GOODREADS_ONLY,
  influences: GOODREADS_ONLY,
};

const DEFAULT_MERGE_STRATEGY: MergeStrategy = 'fillMissing';
const MERGE_STRATEGY_SET = new Set<MergeStrategy>(MERGE_STRATEGIES);
const PROVIDER_KEY_SET = new Set<string>(Object.values(AuthorMetadataProviderKey));

@Injectable()
export class AuthorMetadataPreferenceResolver {
  getDefaultPreferences(): AuthorMetadataPreferences {
    const fields = {} as Record<AuthorMetadataField, AuthorFieldPreference>;
    for (const field of ALL_AUTHOR_METADATA_FIELDS) {
      fields[field] = {
        enabled: true,
        providers: [...FIELD_DEFAULT_PROVIDERS[field]],
        mergeStrategy: DEFAULT_MERGE_STRATEGY,
      };
    }
    return { fields };
  }

  resolve(stored: Partial<AuthorMetadataPreferences> | null | undefined): AuthorMetadataPreferences {
    const defaults = this.getDefaultPreferences();
    const fields = {} as Record<AuthorMetadataField, AuthorFieldPreference>;
    for (const field of ALL_AUTHOR_METADATA_FIELDS) {
      fields[field] = this.normalizeFieldPreference(stored?.fields?.[field], defaults.fields[field], field);
    }
    return { fields };
  }

  // Seeds every field from the single global write mode that governed author
  // enrichment before preferences became per-field.
  fromLegacyWriteMode(writeMode: AuthorAutoEnrichmentWriteMode): AuthorMetadataPreferences {
    const mergeStrategy: MergeStrategy = writeMode === AuthorAutoEnrichmentWriteMode.ALWAYS_REFETCH ? 'overwriteIfProvided' : 'fillMissing';
    const defaults = this.getDefaultPreferences();
    const fields = {} as Record<AuthorMetadataField, AuthorFieldPreference>;
    for (const field of ALL_AUTHOR_METADATA_FIELDS) {
      fields[field] = { ...defaults.fields[field], mergeStrategy };
    }
    return { fields };
  }

  private normalizeFieldPreference(value: unknown, fallback: AuthorFieldPreference, field: AuthorMetadataField): AuthorFieldPreference {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ...fallback, providers: [...fallback.providers] };
    }

    const candidate = value as Partial<AuthorFieldPreference>;
    const enabled = typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled;
    const mergeStrategy = MERGE_STRATEGY_SET.has(candidate.mergeStrategy as MergeStrategy)
      ? (candidate.mergeStrategy as MergeStrategy)
      : fallback.mergeStrategy;

    // An explicitly empty list means "no provider for this field" and is kept;
    // only a malformed value falls back to the default order. Providers that
    // cannot return this field are dropped either way, so a stored preference
    // never promises data the provider has no way to supply.
    const providers = (
      Array.isArray(candidate.providers)
        ? [...new Set(candidate.providers.filter((key): key is AuthorMetadataProviderKey => typeof key === 'string' && PROVIDER_KEY_SET.has(key)))]
        : [...fallback.providers]
    ).filter((key) => providerSupportsAuthorField(key, field));

    return { enabled, providers, mergeStrategy };
  }
}
