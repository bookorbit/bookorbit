import { Injectable } from '@nestjs/common';
import {
  ALL_METADATA_FIELDS,
  FieldPreference,
  FieldPreferenceOverrides,
  MetadataFetchPreferences,
  MetadataField,
  MetadataProviderKey,
  MergeStrategy,
} from '@projectx/types';

const DEFAULT_PROVIDER_ORDER: MetadataProviderKey[] = [
  MetadataProviderKey.GOOGLE,
  MetadataProviderKey.AMAZON,
  MetadataProviderKey.GOODREADS,
  MetadataProviderKey.HARDCOVER,
  MetadataProviderKey.OPEN_LIBRARY,
];

const DEFAULT_MERGE_STRATEGY: MergeStrategy = 'overwriteIfProvided';

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
    return { fields };
  }

  resolve(global: MetadataFetchPreferences, libraryOverrides?: FieldPreferenceOverrides | null): MetadataFetchPreferences {
    const defaults = this.getDefaultPreferences();
    const fields = {} as Record<MetadataField, FieldPreference>;
    for (const field of ALL_METADATA_FIELDS) {
      fields[field] = (libraryOverrides && libraryOverrides[field]) ?? global.fields[field] ?? defaults.fields[field];
    }
    return { fields };
  }

  withForwardCompatibility(preferences: MetadataFetchPreferences, registeredKeys: MetadataProviderKey[]): MetadataFetchPreferences {
    if (!registeredKeys.length) return preferences;
    const fields = {} as Record<MetadataField, FieldPreference>;
    for (const field of ALL_METADATA_FIELDS) {
      const fp = preferences.fields[field];
      const existing = new Set(fp.providers);
      const missing = registeredKeys.filter((k) => !existing.has(k));
      fields[field] = missing.length ? { ...fp, providers: [...fp.providers, ...missing] } : fp;
    }
    return { fields };
  }

  resolveField(preferences: MetadataFetchPreferences, field: MetadataField): FieldPreference {
    return preferences.fields[field];
  }
}
