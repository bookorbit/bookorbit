import { ALL_METADATA_FIELDS, MetadataFetchPreferences, MetadataProviderKey } from '@projectx/types';

import { MetadataPreferenceResolver } from './metadata-preference-resolver';

describe('MetadataPreferenceResolver', () => {
  let resolver: MetadataPreferenceResolver;

  beforeEach(() => {
    resolver = new MetadataPreferenceResolver();
  });

  it('builds defaults for every field with expected baseline strategies', () => {
    const defaults = resolver.getDefaultPreferences();

    expect(Object.keys(defaults.fields)).toHaveLength(ALL_METADATA_FIELDS.length);
    for (const field of ALL_METADATA_FIELDS) {
      expect(defaults.fields[field].enabled).toBe(true);
      expect(defaults.fields[field].providers).toEqual([
        MetadataProviderKey.GOOGLE,
        MetadataProviderKey.AMAZON,
        MetadataProviderKey.GOODREADS,
        MetadataProviderKey.OPEN_LIBRARY,
      ]);
    }

    expect(defaults.fields.title.mergeStrategy).toBe('fillMissing');
    expect(defaults.fields.description.mergeStrategy).toBe('overwriteIfProvided');
  });

  it('prefers library overrides over global preferences and falls back to defaults', () => {
    const defaults = resolver.getDefaultPreferences();
    const global: MetadataFetchPreferences = {
      fields: {
        ...defaults.fields,
        title: {
          enabled: false,
          providers: [MetadataProviderKey.OPEN_LIBRARY],
          mergeStrategy: 'overwrite',
        },
      },
    };

    const resolved = resolver.resolve(global, {
      title: {
        enabled: true,
        providers: [MetadataProviderKey.AMAZON],
        mergeStrategy: 'fillMissing',
      },
    });

    expect(resolved.fields.title).toEqual({
      enabled: true,
      providers: [MetadataProviderKey.AMAZON],
      mergeStrategy: 'fillMissing',
    });
    expect(resolved.fields.subtitle).toEqual(global.fields.subtitle);
  });

  it('normalizes malformed field preferences instead of returning unsafe values', () => {
    const defaults = resolver.getDefaultPreferences();
    const malformed = {
      fields: {
        ...defaults.fields,
        title: {
          enabled: 'yes',
          providers: 'google',
          mergeStrategy: 'invalid',
        },
      },
    } as unknown as MetadataFetchPreferences;

    const resolved = resolver.resolve(malformed, null);

    expect(resolved.fields.title).toEqual(defaults.fields.title);
  });

  it('adds newly registered provider keys without duplicating existing keys', () => {
    const defaults = resolver.getDefaultPreferences();
    const preferences: MetadataFetchPreferences = {
      fields: {
        ...defaults.fields,
        title: {
          enabled: true,
          providers: [MetadataProviderKey.OPEN_LIBRARY, MetadataProviderKey.GOOGLE],
          mergeStrategy: 'fillMissing',
        },
      },
    };

    const next = resolver.withForwardCompatibility(preferences, [
      MetadataProviderKey.GOOGLE,
      MetadataProviderKey.HARDCOVER,
      MetadataProviderKey.OPEN_LIBRARY,
    ]);

    expect(next.fields.title.providers).toEqual([MetadataProviderKey.OPEN_LIBRARY, MetadataProviderKey.GOOGLE, MetadataProviderKey.HARDCOVER]);
  });

  it('remains safe when stored preferences are missing fields and still appends new providers', () => {
    const partial = {
      fields: {
        title: {
          enabled: true,
          providers: [MetadataProviderKey.GOOGLE],
          mergeStrategy: 'fillMissing',
        },
      },
    } as unknown as MetadataFetchPreferences;

    const result = resolver.withForwardCompatibility(partial, [MetadataProviderKey.HARDCOVER]);

    expect(result.fields.title.providers).toEqual([MetadataProviderKey.GOOGLE, MetadataProviderKey.HARDCOVER]);
    expect(result.fields.subtitle.providers).toContain(MetadataProviderKey.HARDCOVER);
  });

  it('resolves a single field from resolved preferences', () => {
    const prefs = resolver.getDefaultPreferences();

    expect(resolver.resolveField(prefs, 'authors')).toEqual(prefs.fields.authors);
  });
});
