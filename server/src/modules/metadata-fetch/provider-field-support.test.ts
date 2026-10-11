import { COMMUNITY_RATING_PROVIDER_KEYS, METADATA_PROVIDER_SUPPORTED_FIELDS, MetadataProviderKey, type MetadataField } from '@bookorbit/types';

import type { MetadataProvider } from './providers/metadata-provider';
import { AladinProvider } from './providers/aladin/aladin.provider';
import { AmazonProvider } from './providers/amazon/amazon.provider';
import { AudibleProvider } from './providers/audible/audible.provider';
import { AudnexusProvider } from './providers/audnexus/audnexus.provider';
import { ComicVineProvider } from './providers/comicvine/comicvine.provider';
import { GoodreadsProvider } from './providers/goodreads/goodreads.provider';
import { GoogleProvider } from './providers/google/google.provider';
import { HardcoverProvider } from './providers/hardcover/hardcover.provider';
import { ITunesProvider } from './providers/itunes/itunes.provider';
import { KoboProvider } from './providers/kobo/kobo.provider';
import { LibroFmProvider } from './providers/librofm/librofm.provider';
import { LubimyczytacProvider } from './providers/lubimyczytac/lubimyczytac.provider';
import { OpenLibraryProvider } from './providers/open-library/open-library.provider';
import { RanobeDbProvider } from './providers/ranobedb/ranobedb.provider';

/**
 * The rule editor's hints come from a hand-kept map in the shared types. It cannot be checked
 * against what each mapper returns, but it can be held to what each provider declares about
 * itself, which is where a new provider or a changed cover shape would show up first.
 */
const PROVIDER_CLASSES = [
  GoogleProvider,
  GoodreadsProvider,
  AmazonProvider,
  HardcoverProvider,
  OpenLibraryProvider,
  ITunesProvider,
  AudibleProvider,
  AudnexusProvider,
  LibroFmProvider,
  ComicVineProvider,
  RanobeDbProvider,
  KoboProvider,
  LubimyczytacProvider,
  AladinProvider,
];

// Declarations are plain class fields, so dependencies that are never called can be empty stand-ins.
const providers = PROVIDER_CLASSES.map(
  (Provider) =>
    Reflect.construct(
      Provider,
      Array.from({ length: Provider.length }, () => ({})),
    ) as MetadataProvider,
);
const AUDIOBOOK_ONLY_FIELDS: MetadataField[] = ['narrators', 'duration', 'abridged'];

describe('METADATA_PROVIDER_SUPPORTED_FIELDS', () => {
  it('marks community ratings for exactly the providers the pipeline collects them from', () => {
    const marked = Object.entries(METADATA_PROVIDER_SUPPORTED_FIELDS)
      .filter(([, fields]) => fields.includes('communityRating'))
      .map(([key]) => key);
    expect(marked.sort()).toEqual([...COMMUNITY_RATING_PROVIDER_KEYS].sort());
  });

  it('has an entry for every provider and every provider key', () => {
    expect(providers.map((provider) => provider.key).sort()).toEqual(Object.values(MetadataProviderKey).sort());
    expect(Object.keys(METADATA_PROVIDER_SUPPORTED_FIELDS).sort()).toEqual(Object.values(MetadataProviderKey).sort());
  });

  it.each(providers.map((provider) => [provider.key, provider] as const))('matches the cover shape %s declares', (_key, provider) => {
    const fields = METADATA_PROVIDER_SUPPORTED_FIELDS[provider.key];
    if (provider.coverShape === 'square') {
      expect(fields).toContain('audioCover');
      expect(fields).not.toContain('cover');
    } else if (provider.coverShape === 'portrait') {
      expect(fields).toContain('cover');
      expect(fields).not.toContain('audioCover');
    } else {
      // A shape stated per candidate can fill either slot.
      expect(fields).toEqual(expect.arrayContaining(['cover', 'audioCover']));
    }
  });

  it.each(providers.map((provider) => [provider.key, provider] as const))(
    'lists audiobook fields for %s only if it serves audiobooks',
    (_key, provider) => {
      const servesAudiobooks = !provider.mediaKinds || provider.mediaKinds.includes('audiobook');
      const listed = AUDIOBOOK_ONLY_FIELDS.filter((field) => METADATA_PROVIDER_SUPPORTED_FIELDS[provider.key].includes(field));
      if (!servesAudiobooks) expect(listed).toEqual([]);
      if (provider.mediaKinds?.length === 1 && provider.mediaKinds[0] === 'audiobook') expect(listed).toEqual(AUDIOBOOK_ONLY_FIELDS);
    },
  );
});
