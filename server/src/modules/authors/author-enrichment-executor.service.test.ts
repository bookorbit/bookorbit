import { AuthorAutoEnrichmentWriteMode } from '@projectx/types';

import { AuthorImageStorageError } from './author-image-storage.service';
import { AuthorEnrichmentExecutorService } from './author-enrichment-executor.service';

describe('AuthorEnrichmentExecutorService', () => {
  const authorsRepo = {
    findByIdForEnrichment: vi.fn(),
    updateAuthorDescriptionIfEmpty: vi.fn(),
    updateAuthorById: vi.fn(),
  };

  const metadataFetch = {
    quickSearchDetailed: vi.fn(),
  };

  const imageStorage = {
    saveFromUrl: vi.fn(),
    getThumbnailPath: vi.fn(),
  };

  let service: AuthorEnrichmentExecutorService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new AuthorEnrichmentExecutorService(authorsRepo as never, metadataFetch as never, imageStorage as never);
    imageStorage.getThumbnailPath.mockResolvedValue(null);
    authorsRepo.findByIdForEnrichment.mockResolvedValue({
      id: 5,
      name: 'Jane Doe',
      sortName: 'Doe, Jane',
      description: null,
      bookCount: 3,
      lastAddedAt: null,
    });
    metadataFetch.quickSearchDetailed.mockResolvedValue({
      candidate: {
        provider: 'audnexus',
        providerId: 'A1',
        name: 'Jane Doe',
        description: 'Bio from provider',
        imageUrl: 'https://img.example/jane.jpg',
      },
      failure: null,
    });
    authorsRepo.updateAuthorDescriptionIfEmpty.mockResolvedValue(true);
    authorsRepo.updateAuthorById.mockResolvedValue({ id: 5 });
    imageStorage.saveFromUrl.mockResolvedValue(true);
  });

  it('skips when author is missing', async () => {
    authorsRepo.findByIdForEnrichment.mockResolvedValue(null);

    await expect(
      service.execute({
        authorId: 999,
        writeMode: AuthorAutoEnrichmentWriteMode.MISSING_ONLY,
        audnexusEnabled: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: 'skipped',
        reason: 'author_not_found',
      }),
    );
  });

  it('skips when author has no linked books', async () => {
    authorsRepo.findByIdForEnrichment.mockResolvedValue({
      id: 5,
      name: 'Jane Doe',
      sortName: 'Doe, Jane',
      description: null,
      bookCount: 0,
      lastAddedAt: null,
    });

    await expect(
      service.execute({
        authorId: 5,
        writeMode: AuthorAutoEnrichmentWriteMode.MISSING_ONLY,
        audnexusEnabled: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: 'skipped',
        reason: 'orphaned',
      }),
    );
  });

  it('skips when provider is disabled by settings', async () => {
    await expect(
      service.execute({
        authorId: 5,
        writeMode: AuthorAutoEnrichmentWriteMode.MISSING_ONLY,
        audnexusEnabled: false,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: 'skipped',
        reason: 'provider_disabled',
      }),
    );
    expect(metadataFetch.quickSearchDetailed).not.toHaveBeenCalled();
  });

  it('updates description only when missing in missing_only mode', async () => {
    authorsRepo.findByIdForEnrichment.mockResolvedValue({
      id: 5,
      name: 'Jane Doe',
      sortName: 'Doe, Jane',
      description: '   ',
      bookCount: 3,
      lastAddedAt: null,
    });

    const result = await service.execute({
      authorId: 5,
      writeMode: AuthorAutoEnrichmentWriteMode.MISSING_ONLY,
      audnexusEnabled: true,
    });

    expect(authorsRepo.updateAuthorDescriptionIfEmpty).toHaveBeenCalledWith(5, 'Bio from provider');
    expect(result).toEqual(expect.objectContaining({ kind: 'done', descriptionUpdated: true }));
  });

  it('always_refetch rewrites description when it changed', async () => {
    authorsRepo.findByIdForEnrichment.mockResolvedValue({
      id: 5,
      name: 'Jane Doe',
      sortName: 'Doe, Jane',
      description: 'Old bio',
      bookCount: 3,
      lastAddedAt: null,
    });

    const result = await service.execute({
      authorId: 5,
      writeMode: AuthorAutoEnrichmentWriteMode.ALWAYS_REFETCH,
      audnexusEnabled: true,
    });

    expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(5, { description: 'Bio from provider' });
    expect(result).toEqual(expect.objectContaining({ kind: 'done', descriptionUpdated: true }));
  });

  it('returns failed result for provider errors to enable retries', async () => {
    metadataFetch.quickSearchDetailed.mockResolvedValue({
      candidate: null,
      failure: {
        provider: 'audnexus',
        message: '429 too many requests',
        httpStatus: 429,
        retryAfterMs: 30_000,
        transient: true,
      },
    });

    await expect(
      service.execute({
        authorId: 5,
        writeMode: AuthorAutoEnrichmentWriteMode.MISSING_ONLY,
        audnexusEnabled: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: 'failed',
        httpStatus: 429,
        retryAfterMs: 30_000,
      }),
    );
  });

  it('returns failed result with retry metadata when image storage throws typed error', async () => {
    imageStorage.saveFromUrl.mockRejectedValue(
      new AuthorImageStorageError('cdn unavailable', {
        transient: true,
        httpStatus: 503,
        retryAfterMs: 10_000,
      }),
    );

    await expect(
      service.execute({
        authorId: 5,
        writeMode: AuthorAutoEnrichmentWriteMode.MISSING_ONLY,
        audnexusEnabled: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: 'failed',
        httpStatus: 503,
        retryAfterMs: 10_000,
        transient: true,
      }),
    );
  });
});
