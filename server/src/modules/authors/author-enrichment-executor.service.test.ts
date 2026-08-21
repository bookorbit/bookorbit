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
  const metadataFetch = { collectByProvider: vi.fn() };
  const imageStorage = { saveFromUrl: vi.fn(), getThumbnailPath: vi.fn() };

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
    metadataFetch.collectByProvider.mockResolvedValue({ candidates: new Map(), failures: [] });

    const result = await service.execute({ authorId: 5, preferences: prefs() });

    expect(result).toMatchObject({ kind: 'skipped', reason: 'no_match' });
  });

  it('reports a provider failure when nothing else succeeded', async () => {
    metadataFetch.collectByProvider.mockResolvedValue({
      candidates: new Map(),
      failures: [{ provider: AuthorMetadataProviderKey.GOODREADS, message: 'boom', httpStatus: 429, retryAfterMs: 1000, transient: true }],
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
});
