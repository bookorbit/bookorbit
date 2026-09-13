import { ALL_METADATA_FIELDS, MetadataFetchPreferences, MetadataProviderKey } from '@bookorbit/types';

import { MetadataPreferenceResolver } from './metadata-preference-resolver';

describe('MetadataPreferenceResolver', () => {
  let resolver: MetadataPreferenceResolver;

  beforeEach(() => {
    resolver = new MetadataPreferenceResolver();
  });

  it('builds defaults for every field with expected baseline strategies', () => {
    const defaults = resolver.getDefaultPreferences();

    expect(Object.keys(defaults.fields)).toHaveLength(ALL_METADATA_FIELDS.length);

    const fieldsWithItunes: (keyof typeof defaults.fields)[] = ['title', 'subtitle', 'description', 'authors'];
    for (const field of fieldsWithItunes) {
      expect(defaults.fields[field].enabled).toBe(true);
      expect(defaults.fields[field].providers).toEqual([
        MetadataProviderKey.GOODREADS,
        MetadataProviderKey.GOOGLE,
        MetadataProviderKey.ITUNES,
        MetadataProviderKey.AMAZON,
        MetadataProviderKey.KOBO,
        MetadataProviderKey.OPEN_LIBRARY,
      ]);
    }

    expect(defaults.fields.cover.providers).toEqual([
      MetadataProviderKey.AMAZON,
      MetadataProviderKey.ITUNES,
      MetadataProviderKey.KOBO,
      MetadataProviderKey.GOODREADS,
      MetadataProviderKey.GOOGLE,
      MetadataProviderKey.OPEN_LIBRARY,
    ]);

    expect(defaults.fields.genres.providers).toEqual([
      MetadataProviderKey.GOODREADS,
      MetadataProviderKey.GOOGLE,
      MetadataProviderKey.ITUNES,
      MetadataProviderKey.KOBO,
    ]);
    expect(defaults.fields.communityRating.providers).toEqual([
      MetadataProviderKey.HARDCOVER,
      MetadataProviderKey.GOODREADS,
      MetadataProviderKey.GOOGLE,
      MetadataProviderKey.OPEN_LIBRARY,
      MetadataProviderKey.ITUNES,
      MetadataProviderKey.RANOBEDB,
      MetadataProviderKey.AMAZON,
      MetadataProviderKey.AUDIBLE,
    ]);

    const fieldsWithoutItunes: (keyof typeof defaults.fields)[] = [
      'publisher',
      'publishedYear',
      'language',
      'pageCount',
      'seriesName',
      'seriesIndex',
    ];
    for (const field of fieldsWithoutItunes) {
      expect(defaults.fields[field].enabled).toBe(true);
      expect(defaults.fields[field].providers).toEqual([
        MetadataProviderKey.GOODREADS,
        MetadataProviderKey.GOOGLE,
        MetadataProviderKey.AMAZON,
        MetadataProviderKey.KOBO,
        MetadataProviderKey.OPEN_LIBRARY,
      ]);
    }

    expect(defaults.fields.title.mergeStrategy).toBe('overwriteIfProvided');
    expect(defaults.fields.description.mergeStrategy).toBe('overwriteIfProvided');
    expect(defaults.fields.genres.mergeStrategy).toBe('mergeExisting');
    expect(defaults.options).toEqual({
      genres: { mode: 'merge', blocklist: [], maxCount: null },
      saveProviderIds: true,
      providerIdMode: 'preferExisting',
    });
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

  it('keeps merge-with-existing scoped to genres', () => {
    const defaults = resolver.getDefaultPreferences();
    const preferences = {
      fields: {
        ...defaults.fields,
        title: { ...defaults.fields.title, mergeStrategy: 'mergeExisting' },
        genres: { ...defaults.fields.genres, mergeStrategy: 'mergeExisting' },
      },
    } as MetadataFetchPreferences;

    const resolved = resolver.resolve(preferences, null);

    expect(resolved.fields.title.mergeStrategy).toBe('overwriteIfProvided');
    expect(resolved.fields.genres.mergeStrategy).toBe('mergeExisting');
  });

  it('normalizes malformed options to safe defaults', () => {
    const defaults = resolver.getDefaultPreferences();
    const malformed = {
      fields: defaults.fields,
      options: {
        genres: { mode: 'invalid', blocklist: [42], maxCount: 0 },
        saveProviderIds: 'yes',
        providerIdMode: 'unsupported',
      },
    } as unknown as MetadataFetchPreferences;

    const resolved = resolver.resolve(malformed, null);

    expect(resolved.options).toEqual(defaults.options);
  });

  it('normalizes genre blocklist values with case-insensitive de-duplication', () => {
    const defaults = resolver.getDefaultPreferences();
    const preferences = {
      fields: defaults.fields,
      options: {
        genres: {
          mode: 'merge',
          blocklist: [' Audiobook ', 'adult', 'AUDIOBOOK', '', 'Graphic Novel'],
          maxCount: 3,
        },
        saveProviderIds: true,
        providerIdMode: 'preferExisting',
      },
    } as unknown as MetadataFetchPreferences;

    const resolved = resolver.resolve(preferences, null);

    expect(resolved.options?.genres.blocklist).toEqual(['Audiobook', 'adult', 'Graphic Novel']);
    expect(resolved.options?.genres.maxCount).toBe(3);
  });

  it('normalizes missing and invalid genre limits to unlimited', () => {
    const defaults = resolver.getDefaultPreferences();
    const missingLimit = resolver.resolve(
      {
        fields: defaults.fields,
        options: { genres: { mode: 'merge', blocklist: [] }, saveProviderIds: true, providerIdMode: 'preferExisting' },
      } as unknown as MetadataFetchPreferences,
      null,
    );
    const invalidLimit = resolver.resolve(
      {
        fields: defaults.fields,
        options: { genres: { mode: 'merge', blocklist: [], maxCount: 51 }, saveProviderIds: true, providerIdMode: 'preferExisting' },
      },
      null,
    );

    expect(missingLimit.options?.genres.maxCount).toBeNull();
    expect(invalidLimit.options?.genres.maxCount).toBeNull();
  });

  it('preserves existing-only provider identity mode and defaults legacy preferences', () => {
    const defaults = resolver.getDefaultPreferences();
    const strict = resolver.resolve(
      {
        fields: defaults.fields,
        options: { ...defaults.options!, providerIdMode: 'existingOnly' },
      },
      null,
    );
    const legacy = resolver.resolve(
      {
        fields: defaults.fields,
        options: {
          genres: defaults.options!.genres,
          saveProviderIds: true,
        },
      } as unknown as MetadataFetchPreferences,
      null,
    );

    expect(strict.options?.providerIdMode).toBe('existingOnly');
    expect(legacy.options?.providerIdMode).toBe('preferExisting');
  });

  it('preserves explicit provider selections when applying forward compatibility', () => {
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
      MetadataProviderKey.AMAZON,
      MetadataProviderKey.OPEN_LIBRARY,
    ]);

    expect(next.fields.title.providers).toEqual([MetadataProviderKey.OPEN_LIBRARY, MetadataProviderKey.GOOGLE]);
    expect(next.options).toEqual(defaults.options);
  });

  it('drops unavailable providers and falls back to defaults when a field loses all providers', () => {
    const partial = {
      fields: {
        title: {
          enabled: true,
          providers: [MetadataProviderKey.HARDCOVER],
          mergeStrategy: 'fillMissing',
        },
      },
    } as unknown as MetadataFetchPreferences;

    const result = resolver.withForwardCompatibility(partial, [MetadataProviderKey.GOOGLE]);

    expect(result.fields.title.providers).toEqual([MetadataProviderKey.GOOGLE]);
    expect(result.fields.subtitle.providers).toEqual([MetadataProviderKey.GOOGLE]);
  });

  it('preserves explicit empty provider selections when applying forward compatibility', () => {
    const defaults = resolver.getDefaultPreferences();
    const preferences: MetadataFetchPreferences = {
      fields: {
        ...defaults.fields,
        title: {
          enabled: true,
          providers: [],
          mergeStrategy: 'fillMissing',
        },
      },
    };

    const result = resolver.withForwardCompatibility(preferences, [MetadataProviderKey.GOOGLE]);

    expect(result.fields.title.providers).toEqual([]);
  });
});
