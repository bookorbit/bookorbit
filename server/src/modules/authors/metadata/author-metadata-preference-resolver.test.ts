import { ALL_AUTHOR_METADATA_FIELDS, AuthorAutoEnrichmentWriteMode, AuthorMetadataProviderKey } from '@bookorbit/types';

import { AuthorMetadataPreferenceResolver } from './author-metadata-preference-resolver';

describe('AuthorMetadataPreferenceResolver', () => {
  const resolver = new AuthorMetadataPreferenceResolver();

  it('defaults every field with a provider order', () => {
    const prefs = resolver.getDefaultPreferences();

    expect(Object.keys(prefs.fields).sort()).toEqual([...ALL_AUTHOR_METADATA_FIELDS].sort());
    expect(prefs.fields.description.providers).toEqual([AuthorMetadataProviderKey.GOODREADS, AuthorMetadataProviderKey.AUDNEXUS]);
    expect(prefs.fields.description.mergeStrategy).toBe('fillMissing');
  });

  it('lists only Goodreads for fields Audnexus never returns', () => {
    const prefs = resolver.getDefaultPreferences();

    for (const field of ['birthDate', 'deathDate', 'website', 'genres', 'influences'] as const) {
      expect(prefs.fields[field].providers).toEqual([AuthorMetadataProviderKey.GOODREADS]);
    }
  });

  it('keeps a stored provider order and merge strategy', () => {
    const resolved = resolver.resolve({
      fields: {
        description: { enabled: true, providers: [AuthorMetadataProviderKey.AUDNEXUS], mergeStrategy: 'overwrite' },
      },
    } as never);

    expect(resolved.fields.description).toEqual({
      enabled: true,
      providers: [AuthorMetadataProviderKey.AUDNEXUS],
      mergeStrategy: 'overwrite',
    });
  });

  it('fills fields absent from the stored value with defaults', () => {
    const resolved = resolver.resolve({ fields: {} } as never);

    expect(resolved.fields.genres.providers).toEqual([AuthorMetadataProviderKey.GOODREADS]);
    expect(resolved.fields.photo.enabled).toBe(true);
  });

  it('drops unknown providers and de-duplicates the order', () => {
    const resolved = resolver.resolve({
      fields: {
        description: {
          enabled: true,
          providers: ['goodreads', 'librarything', 'goodreads', 'audnexus'],
          mergeStrategy: 'fillMissing',
        },
      },
    } as never);

    expect(resolved.fields.description.providers).toEqual([AuthorMetadataProviderKey.GOODREADS, AuthorMetadataProviderKey.AUDNEXUS]);
  });

  it('preserves an explicitly empty provider list', () => {
    const resolved = resolver.resolve({
      fields: { website: { enabled: true, providers: [], mergeStrategy: 'fillMissing' } },
    } as never);

    expect(resolved.fields.website.providers).toEqual([]);
  });

  it('falls back to defaults for a malformed field entry', () => {
    const resolved = resolver.resolve({ fields: { description: 'nonsense' } } as never);

    expect(resolved.fields.description.providers).toEqual([AuthorMetadataProviderKey.GOODREADS, AuthorMetadataProviderKey.AUDNEXUS]);
  });

  it('drops a provider that cannot return the field', () => {
    // Audnexus exposes only asin/name/description/image, so it can never fill
    // Died, Website, Genres or Influences.
    const resolved = resolver.resolve({
      fields: {
        deathDate: {
          enabled: true,
          providers: [AuthorMetadataProviderKey.AUDNEXUS, AuthorMetadataProviderKey.GOODREADS],
          mergeStrategy: 'fillMissing',
        },
        website: { enabled: true, providers: [AuthorMetadataProviderKey.AUDNEXUS], mergeStrategy: 'fillMissing' },
      },
    } as never);

    expect(resolved.fields.deathDate.providers).toEqual([AuthorMetadataProviderKey.GOODREADS]);
    expect(resolved.fields.website.providers).toEqual([]);
  });

  it('keeps Audnexus on the two fields it does return', () => {
    const resolved = resolver.resolve({
      fields: {
        description: { enabled: true, providers: [AuthorMetadataProviderKey.AUDNEXUS], mergeStrategy: 'fillMissing' },
        photo: { enabled: true, providers: [AuthorMetadataProviderKey.AUDNEXUS], mergeStrategy: 'fillMissing' },
      },
    } as never);

    expect(resolved.fields.description.providers).toEqual([AuthorMetadataProviderKey.AUDNEXUS]);
    expect(resolved.fields.photo.providers).toEqual([AuthorMetadataProviderKey.AUDNEXUS]);
  });

  it('rejects an unknown merge strategy', () => {
    const resolved = resolver.resolve({
      fields: { description: { enabled: true, providers: [], mergeStrategy: 'clobber' } },
    } as never);

    expect(resolved.fields.description.mergeStrategy).toBe('fillMissing');
  });

  it('maps the legacy write mode onto every field', () => {
    const always = resolver.fromLegacyWriteMode(AuthorAutoEnrichmentWriteMode.ALWAYS_REFETCH);
    const missing = resolver.fromLegacyWriteMode(AuthorAutoEnrichmentWriteMode.MISSING_ONLY);

    for (const field of ALL_AUTHOR_METADATA_FIELDS) {
      expect(always.fields[field].mergeStrategy).toBe('overwriteIfProvided');
      expect(missing.fields[field].mergeStrategy).toBe('fillMissing');
    }
  });
});
