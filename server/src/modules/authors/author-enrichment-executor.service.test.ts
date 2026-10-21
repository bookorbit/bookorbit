import { AuthorMetadataField, AuthorMetadataPreferences, AuthorMetadataProviderKey, MergeStrategy } from '@bookorbit/types';

import { AuthorImageStorageError } from './author-image-storage.service';
import { AuthorEnrichmentExecutorService } from './author-enrichment-executor.service';
import { AuthorMetadataPreferenceResolver } from './metadata/author-metadata-preference-resolver';

const resolver = new AuthorMetadataPreferenceResolver();

function prefs(overrides?: Partial<Record<AuthorMetadataField, Partial<{ enabled: boolean; providers: string[]; mergeStrategy: MergeStrategy }>>>) {
  const base = resolver.getDefaultPreferences();
  for (const [field, patch] of Object.entries(overrides ?? {})) {
    Object.assign(base.fields[field as AuthorMetadataField], patch);
  }
  return base as AuthorMetadataPreferences;
}

const AUDNEXUS = {
  provider: AuthorMetadataProviderKey.AUDNEXUS,
  providerId: 'A1',
  name: 'Jane Doe',
  description: 'Audnexus bio',
  imageUrl: 'https://img.example/audnexus.jpg',
};

const GOODREADS = {
  provider: AuthorMetadataProviderKey.GOODREADS,
  providerId: '4242',
  name: 'Jane Doe',
  description: 'Goodreads bio',
  imageUrl: 'https://img.example/goodreads.jpg',
  birthDate: '1929-10-21',
  birthYear: 1929,
  website: 'https://janedoe.example',
  genres: ['Science Fiction'],
  influences: ['Someone Else'],
};

describe('AuthorEnrichmentExecutorService', () => {
  const authorsRepo = {
    findByIdForEnrichment: vi.fn(),
    updateAuthorById: vi.fn(),
  };
  const metadataFetch = { collectByProvider: vi.fn(), lookupByIdDetailed: vi.fn() };
  const imageStorage = { saveFromUrl: vi.fn(), getThumbnailPath: vi.fn(), deleteAuthorDir: vi.fn() };

  let service: AuthorEnrichmentExecutorService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new AuthorEnrichmentExecutorService(authorsRepo as never, metadataFetch as never, imageStorage as never);
    imageStorage.getThumbnailPath.mockResolvedValue('/thumb.jpg');
    imageStorage.saveFromUrl.mockResolvedValue(true);
    authorsRepo.updateAuthorById.mockResolvedValue({ id: 5 });
    authorsRepo.findByIdForEnrichment.mockResolvedValue({
      id: 5,
      name: 'Jane Doe',
      sortName: 'Doe, Jane',
      description: null,
      hasPhoto: false,
      birthDate: null,
      birthYear: null,
      deathDate: null,
      deathYear: null,
      website: null,
      genres: null,
      influences: null,
      bookCount: 3,
      lastAddedAt: null,
    });
    metadataFetch.collectByProvider.mockResolvedValue({
      candidates: new Map([
        [AuthorMetadataProviderKey.GOODREADS, GOODREADS],
        [AuthorMetadataProviderKey.AUDNEXUS, AUDNEXUS],
      ]),
      failures: [],
      cacheServed: [],
      outboundRequests: 4,
    });
  });

  it('skips when the author is missing', async () => {
    authorsRepo.findByIdForEnrichment.mockResolvedValue(null);

    const result = await service.execute({ authorId: 5, preferences: prefs() });

    expect(result).toMatchObject({ kind: 'skipped', reason: 'author_not_found' });
  });

  it('skips an author with no books', async () => {
    authorsRepo.findByIdForEnrichment.mockResolvedValue({ id: 5, name: 'Jane Doe', bookCount: 0 });

    const result = await service.execute({ kind: 'skipped', authorId: 5, preferences: prefs() } as never);

    expect(result).toMatchObject({ kind: 'skipped', reason: 'orphaned' });
  });

  it('skips when every field is disabled, without calling a provider', async () => {
    const disabled = prefs();
    for (const field of Object.keys(disabled.fields) as AuthorMetadataField[]) disabled.fields[field].enabled = false;

    const result = await service.execute({ authorId: 5, preferences: disabled });

    expect(result).toMatchObject({ kind: 'skipped', reason: 'provider_disabled' });
    expect(metadataFetch.collectByProvider).not.toHaveBeenCalled();
  });

  it('honours the per-field provider order', async () => {
    const preferences = prefs({
      description: { providers: [AuthorMetadataProviderKey.AUDNEXUS, AuthorMetadataProviderKey.GOODREADS] },
    });

    await service.execute({ authorId: 5, preferences });

    expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(5, expect.objectContaining({ description: 'Audnexus bio' }));
  });

  it('falls through to the next provider when the first returns an empty value', async () => {
    // Audnexus regularly matches an author but carries no biography; the empty
    // value must not win the field just because the provider is listed first.
    metadataFetch.collectByProvider.mockResolvedValue({
      candidates: new Map([
        [AuthorMetadataProviderKey.AUDNEXUS, { ...AUDNEXUS, description: '   ' }],
        [AuthorMetadataProviderKey.GOODREADS, GOODREADS],
      ]),
      failures: [],
      cacheServed: [],
      outboundRequests: 4,
    });
    const preferences = prefs({
      description: { providers: [AuthorMetadataProviderKey.AUDNEXUS, AuthorMetadataProviderKey.GOODREADS] },
    });

    const result = await service.execute({ authorId: 5, preferences });

    expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(5, expect.objectContaining({ description: 'Goodreads bio' }));
    expect(result).toMatchObject({ kind: 'done', provider: AuthorMetadataProviderKey.GOODREADS });
  });

  it('writes the fields only Goodreads supplies', async () => {
    await service.execute({ authorId: 5, preferences: prefs() });

    expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        birthDate: '1929-10-21',
        birthYear: 1929,
        website: 'https://janedoe.example',
        genres: ['Science Fiction'],
        influences: ['Someone Else'],
      }),
    );
  });

  it('leaves a populated field alone under fillMissing', async () => {
    authorsRepo.findByIdForEnrichment.mockResolvedValue({
      id: 5,
      name: 'Jane Doe',
      description: 'Existing bio',
      hasPhoto: true,
      birthDate: null,
      birthYear: null,
      deathDate: null,
      deathYear: null,
      website: null,
      genres: null,
      influences: null,
      bookCount: 3,
    });

    const result = await service.execute({ authorId: 5, preferences: prefs() });

    const update = authorsRepo.updateAuthorById.mock.calls[0][1];
    expect(update).not.toHaveProperty('description');
    expect(result).toMatchObject({ descriptionUpdated: false, imageUpdated: false });
    expect(imageStorage.saveFromUrl).not.toHaveBeenCalled();
  });

  it('replaces a populated field under overwriteIfProvided', async () => {
    authorsRepo.findByIdForEnrichment.mockResolvedValue({
      id: 5,
      name: 'Jane Doe',
      description: 'Existing bio',
      hasPhoto: false,
      birthDate: null,
      birthYear: null,
      deathDate: null,
      deathYear: null,
      website: null,
      genres: null,
      influences: null,
      bookCount: 3,
    });

    await service.execute({ authorId: 5, preferences: prefs({ description: { mergeStrategy: 'overwriteIfProvided' } }) });

    expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(5, expect.objectContaining({ description: 'Goodreads bio' }));
  });

  it('pins the provider that supplied the description', async () => {
    await service.execute({ authorId: 5, preferences: prefs() });

    expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        metadataProvider: AuthorMetadataProviderKey.GOODREADS,
        metadataProviderId: '4242',
      }),
    );
  });

  it('reports no_match when no provider returned a candidate', async () => {
    metadataFetch.collectByProvider.mockResolvedValue({ candidates: new Map(), failures: [], cacheServed: [], outboundRequests: 2 });

    const result = await service.execute({ authorId: 5, preferences: prefs() });

    expect(result).toMatchObject({ kind: 'skipped', reason: 'no_match' });
  });

  it('reports a provider failure when nothing else succeeded', async () => {
    metadataFetch.collectByProvider.mockResolvedValue({
      candidates: new Map(),
      failures: [{ provider: AuthorMetadataProviderKey.GOODREADS, message: 'boom', httpStatus: 429, retryAfterMs: 1000, transient: true }],
      cacheServed: [],
      outboundRequests: 1,
    });

    const result = await service.execute({ authorId: 5, preferences: prefs() });

    expect(result).toMatchObject({ kind: 'failed', provider: AuthorMetadataProviderKey.GOODREADS, httpStatus: 429, transient: true });
  });

  it('surfaces an image storage failure', async () => {
    imageStorage.saveFromUrl.mockRejectedValue(new AuthorImageStorageError('too big', { httpStatus: 413, transient: false }));

    const result = await service.execute({ authorId: 5, preferences: prefs() });

    expect(result).toMatchObject({ kind: 'failed', message: 'too big', httpStatus: 413, transient: false });
  });

  it('stores a photo and marks hasPhoto from what is on disk', async () => {
    const result = await service.execute({ authorId: 5, preferences: prefs() });

    expect(imageStorage.saveFromUrl).toHaveBeenCalledWith(5, 'https://img.example/goodreads.jpg');
    expect(result).toMatchObject({ kind: 'done', imageUpdated: true });
    expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(5, expect.objectContaining({ hasPhoto: true }));
  });

  describe('pinned match', () => {
    const PINNED_ROW = {
      id: 5,
      name: 'Jane Doe',
      description: null,
      hasPhoto: false,
      bookCount: 3,
      metadataProvider: AuthorMetadataProviderKey.GOODREADS,
      metadataProviderId: '4242',
      metadataProviderPinned: true,
    };

    beforeEach(() => {
      authorsRepo.findByIdForEnrichment.mockResolvedValue(PINNED_ROW);
      metadataFetch.lookupByIdDetailed.mockResolvedValue({ candidate: GOODREADS, failure: null, cacheServed: [], outboundRequests: 1 });
    });

    it('looks the pinned id up instead of searching by name', async () => {
      const result = await service.execute({ authorId: 5, preferences: prefs() }, { policy: 'default', allowFallback: true });

      expect(metadataFetch.collectByProvider).not.toHaveBeenCalled();
      expect(metadataFetch.lookupByIdDetailed).toHaveBeenCalledWith(AuthorMetadataProviderKey.GOODREADS, '4242', 'us', {
        directive: { policy: 'default', allowFallback: true },
      });
      expect(result).toMatchObject({ kind: 'done', provider: AuthorMetadataProviderKey.GOODREADS, descriptionUpdated: true });
      expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(5, expect.objectContaining({ description: 'Goodreads bio' }));
    });

    it('never rewrites the pinned provider id', async () => {
      metadataFetch.lookupByIdDetailed.mockResolvedValue({
        candidate: { ...GOODREADS, providerId: '4242.Jane_Doe' },
        failure: null,
        cacheServed: [],
        outboundRequests: 1,
      });

      await service.execute({ authorId: 5, preferences: prefs() });

      const update = authorsRepo.updateAuthorById.mock.calls[0][1];
      expect(update).not.toHaveProperty('metadataProvider');
      expect(update).not.toHaveProperty('metadataProviderId');
    });

    it('keeps the pin and reports no_match when the id now matches nobody', async () => {
      metadataFetch.lookupByIdDetailed.mockResolvedValue({ candidate: null, failure: null, cacheServed: [], outboundRequests: 1 });

      const result = await service.execute({ authorId: 5, preferences: prefs() });

      expect(result).toMatchObject({ kind: 'skipped', reason: 'no_match', outboundRequests: 1 });
      expect(authorsRepo.updateAuthorById).not.toHaveBeenCalled();
    });

    it('reports a failed lookup as a failure so the queue retries', async () => {
      metadataFetch.lookupByIdDetailed.mockResolvedValue({
        candidate: null,
        failure: { provider: AuthorMetadataProviderKey.GOODREADS, message: 'HTTP 429', httpStatus: 429, retryAfterMs: 5000, transient: true },
        cacheServed: [],
        outboundRequests: 1,
      });

      const result = await service.execute({ authorId: 5, preferences: prefs() });

      expect(result).toMatchObject({ kind: 'failed', httpStatus: 429, retryAfterMs: 5000, transient: true });
    });

    it('skips when the pinned provider is no longer used by any field', async () => {
      const preferences = prefs();
      for (const field of Object.keys(preferences.fields) as AuthorMetadataField[]) {
        preferences.fields[field].providers = [AuthorMetadataProviderKey.AUDNEXUS];
      }

      const result = await service.execute({ authorId: 5, preferences });

      expect(result).toMatchObject({ kind: 'skipped', reason: 'provider_disabled' });
      expect(metadataFetch.lookupByIdDetailed).not.toHaveBeenCalled();
      expect(metadataFetch.collectByProvider).not.toHaveBeenCalled();
    });

    it('searches by name again once unpinned', async () => {
      authorsRepo.findByIdForEnrichment.mockResolvedValue({ ...PINNED_ROW, metadataProviderPinned: false });

      await service.execute({ authorId: 5, preferences: prefs() });

      expect(metadataFetch.lookupByIdDetailed).not.toHaveBeenCalled();
      expect(metadataFetch.collectByProvider).toHaveBeenCalled();
    });
  });

  describe('applyMatch', () => {
    const WRONG_PERSON_ROW = {
      id: 5,
      name: 'John Reid',
      description: 'American journalist.',
      hasPhoto: true,
      birthDate: '1950-01-01',
      birthYear: 1950,
      deathDate: null,
      deathYear: null,
      website: 'https://wrong.example',
      genres: ['Journalism'],
      influences: null,
      bookCount: 2,
      metadataProvider: AuthorMetadataProviderKey.GOODREADS,
      metadataProviderId: '1111',
      metadataProviderPinned: false,
    };

    it('replaces every enabled field, clears what the match lacks and pins it', async () => {
      const match = {
        provider: AuthorMetadataProviderKey.GOODREADS,
        providerId: '2222',
        name: 'John Reid',
        description: 'Scottish novelist.',
        genres: ['Thriller'],
      };

      const result = await service.applyMatch(WRONG_PERSON_ROW as never, prefs(), match);

      expect(imageStorage.deleteAuthorDir).toHaveBeenCalledWith(5);
      expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(5, {
        description: 'Scottish novelist.',
        birthDate: null,
        birthYear: null,
        deathDate: null,
        deathYear: null,
        website: null,
        genres: ['Thriller'],
        influences: null,
        metadataProvider: AuthorMetadataProviderKey.GOODREADS,
        metadataProviderId: '2222',
        metadataProviderPinned: true,
        hasPhoto: true,
        lastEnrichedAt: expect.any(Date),
      });
      expect(result).toMatchObject({ kind: 'applied', imageUpdated: true, downloads: 0 });
    });

    it('stores the match portrait and leaves disabled fields alone', async () => {
      const result = await service.applyMatch(WRONG_PERSON_ROW as never, prefs({ website: { enabled: false } }), GOODREADS);

      expect(imageStorage.saveFromUrl).toHaveBeenCalledWith(5, 'https://img.example/goodreads.jpg');
      expect(imageStorage.deleteAuthorDir).not.toHaveBeenCalled();
      expect(authorsRepo.updateAuthorById.mock.calls[0][1]).not.toHaveProperty('website');
      expect(result).toMatchObject({ kind: 'applied', imageUpdated: true, downloads: 1 });
      expect((result as { fieldsUpdated: string[] }).fieldsUpdated).toContain('photo');
    });

    it('clears fields an Audnexus match cannot supply', async () => {
      await service.applyMatch(WRONG_PERSON_ROW as never, prefs(), AUDNEXUS);

      expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          description: 'Audnexus bio',
          birthYear: null,
          website: null,
          genres: null,
          metadataProvider: AuthorMetadataProviderKey.AUDNEXUS,
          metadataProviderId: 'A1',
        }),
      );
    });

    it('writes nothing when the portrait download fails', async () => {
      imageStorage.saveFromUrl.mockRejectedValue(new AuthorImageStorageError('rate limited', { httpStatus: 429, transient: true }));

      const result = await service.applyMatch(WRONG_PERSON_ROW as never, prefs(), GOODREADS);

      expect(result).toMatchObject({ kind: 'failed', message: 'rate limited', httpStatus: 429, transient: true });
      expect(authorsRepo.updateAuthorById).not.toHaveBeenCalled();
    });

    it('leaves the existing match untouched when the portrait cannot be stored', async () => {
      imageStorage.saveFromUrl.mockResolvedValue(false);

      const result = await service.applyMatch(WRONG_PERSON_ROW as never, prefs(), GOODREADS);

      expect(result).toMatchObject({ kind: 'failed', message: 'Failed to save author image', transient: false });
      expect(imageStorage.deleteAuthorDir).not.toHaveBeenCalled();
      expect(authorsRepo.updateAuthorById).not.toHaveBeenCalled();
    });
  });

  describe('metadata cache', () => {
    const CACHED = { provider: AuthorMetadataProviderKey.GOODREADS, source: 'cache', stale: false, cachedAt: '2026-09-01T00:00:00.000Z' };

    it('stays live without fallback when no directive is given', async () => {
      await service.execute({ authorId: 5, preferences: prefs() });

      expect(metadataFetch.collectByProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'Jane Doe' }), expect.any(Array), {
        policy: 'refresh',
        allowFallback: false,
      });
    });

    it('passes the caller directive to the metadata fetch', async () => {
      await service.execute({ authorId: 5, preferences: prefs() }, { policy: 'default', allowFallback: true });

      expect(metadataFetch.collectByProvider).toHaveBeenCalledWith(expect.anything(), expect.anything(), { policy: 'default', allowFallback: true });
    });

    it('reports provider requests plus portrait downloads and the cache provenance', async () => {
      metadataFetch.collectByProvider.mockResolvedValue({
        candidates: new Map([[AuthorMetadataProviderKey.GOODREADS, GOODREADS]]),
        failures: [],
        cacheServed: [CACHED],
        outboundRequests: 0,
      });

      const result = await service.execute({ authorId: 5, preferences: prefs() });

      expect(imageStorage.saveFromUrl).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ kind: 'done', outboundRequests: 1, cacheServed: [CACHED] });
    });

    it('reports zero outbound requests when the cache answered and no portrait was needed', async () => {
      authorsRepo.findByIdForEnrichment.mockResolvedValue({ id: 5, name: 'Jane Doe', description: 'Existing bio', hasPhoto: true, bookCount: 3 });
      metadataFetch.collectByProvider.mockResolvedValue({
        candidates: new Map([[AuthorMetadataProviderKey.GOODREADS, GOODREADS]]),
        failures: [],
        cacheServed: [CACHED],
        outboundRequests: 0,
      });

      const result = await service.execute({ authorId: 5, preferences: prefs() });

      expect(imageStorage.saveFromUrl).not.toHaveBeenCalled();
      expect(result).toMatchObject({ kind: 'done', outboundRequests: 0 });
    });

    it('counts every portrait download attempt, including ones that stored nothing or failed', async () => {
      imageStorage.saveFromUrl.mockResolvedValueOnce(false).mockRejectedValueOnce(new AuthorImageStorageError('down', { transient: true }));

      const result = await service.execute({
        authorId: 5,
        preferences: prefs({ photo: { providers: [AuthorMetadataProviderKey.AUDNEXUS, AuthorMetadataProviderKey.GOODREADS] } }),
      });

      expect(result).toMatchObject({ kind: 'failed', outboundRequests: 6 });
    });

    it('reports no outbound requests for authors skipped before any fetch', async () => {
      authorsRepo.findByIdForEnrichment.mockResolvedValue(null);

      await expect(service.execute({ authorId: 5, preferences: prefs() })).resolves.toMatchObject({ outboundRequests: 0, cacheServed: [] });
    });

    it('carries provenance on no-match and failure results', async () => {
      metadataFetch.collectByProvider.mockResolvedValueOnce({ candidates: new Map(), failures: [], cacheServed: [CACHED], outboundRequests: 0 });
      await expect(service.execute({ authorId: 5, preferences: prefs() })).resolves.toMatchObject({
        kind: 'skipped',
        reason: 'no_match',
        outboundRequests: 0,
        cacheServed: [CACHED],
      });

      metadataFetch.collectByProvider.mockResolvedValueOnce({
        candidates: new Map(),
        failures: [{ provider: AuthorMetadataProviderKey.GOODREADS, message: 'boom', httpStatus: 503, retryAfterMs: null, transient: true }],
        cacheServed: [],
        outboundRequests: 2,
      });
      await expect(service.execute({ authorId: 5, preferences: prefs() })).resolves.toMatchObject({ kind: 'failed', outboundRequests: 2 });
    });
  });
});
