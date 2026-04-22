import { NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { RecommendationService } from './recommendation.service';

function makeUser(isSuperuser = false): RequestUser {
  return {
    id: 12,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
  };
}

function makeService() {
  const recRepo = {
    getTargetBookData: vi.fn(),
    findAnnCandidates: vi.fn(),
    getCandidateMetadata: vi.fn(),
    getSeriesName: vi.fn(),
    findSeriesBooks: vi.fn(),
    findAuthorBooks: vi.fn(),
  };
  const bookRepo = {
    findLibraryIdByBookId: vi.fn(),
    findRecommendationTitlesByBookIds: vi.fn(),
  };
  const libraryService = {
    verifyUserAccess: vi.fn().mockResolvedValue(undefined),
    findAll: vi.fn().mockResolvedValue([{ id: 7 }]),
    findAccessibleLibraryIds: vi.fn().mockResolvedValue([7]),
  };
  const embedder = {
    embedBook: vi.fn(),
  };

  const service = new RecommendationService(recRepo as never, bookRepo as never, libraryService as never, embedder as never);

  return { service, recRepo, bookRepo, libraryService, embedder };
}

describe('RecommendationService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws NotFoundException when the target book does not exist', async () => {
    const { service, bookRepo } = makeService();
    bookRepo.findLibraryIdByBookId.mockResolvedValue(null);

    await expect(service.getRecommendations(999, makeUser())).rejects.toThrow(NotFoundException);
  });

  it('passes superuser status into access verification', async () => {
    const { service, bookRepo, libraryService, recRepo } = makeService();
    const user = makeUser(true);

    bookRepo.findLibraryIdByBookId.mockResolvedValue(21);
    recRepo.getTargetBookData.mockResolvedValue(null);

    await service.getRecommendations(1, user);

    expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, 21, true);
  });

  it('uses fallback embedding when the target book has no metadata row', async () => {
    const { service, bookRepo, recRepo, embedder, libraryService } = makeService();

    bookRepo.findLibraryIdByBookId.mockResolvedValue(21);
    recRepo.getTargetBookData.mockResolvedValue(null);
    embedder.embedBook.mockResolvedValue([0.4, 0.6]);
    libraryService.findAll.mockResolvedValue([{ id: 7 }, { id: 9 }]);
    recRepo.findAnnCandidates.mockResolvedValue([{ bookId: 91, cosineSim: 0.78, seriesName: null, rating: null }]);
    recRepo.getCandidateMetadata.mockResolvedValue([{ bookId: 91, authorNames: [], genreTagNames: [] }]);
    bookRepo.findRecommendationTitlesByBookIds.mockResolvedValue([{ id: 91, title: 'Fallback Match' }]);

    await expect(service.getRecommendations(55, makeUser())).resolves.toEqual([{ id: 91, title: 'Fallback Match' }]);
    expect(embedder.embedBook).toHaveBeenCalledWith(55);
    expect(recRepo.findAnnCandidates).toHaveBeenCalledWith([0.4, 0.6], 55, [7, 9]);
  });

  it('returns empty recommendations when fallback embedding is invalid', async () => {
    const { service, bookRepo, recRepo, embedder } = makeService();

    bookRepo.findLibraryIdByBookId.mockResolvedValue(3);
    recRepo.getTargetBookData.mockResolvedValue({
      embedding: null,
      seriesName: null,
      rating: null,
      authorNames: [],
      genreTagNames: [],
    });
    embedder.embedBook.mockResolvedValue([]);

    await expect(service.getRecommendations(3, makeUser())).resolves.toEqual([]);
    expect(recRepo.findAnnCandidates).not.toHaveBeenCalled();
  });

  it('returns empty recommendations when metadata row is missing and generated embedding is invalid', async () => {
    const { service, bookRepo, recRepo, embedder } = makeService();

    bookRepo.findLibraryIdByBookId.mockResolvedValue(6);
    recRepo.getTargetBookData.mockResolvedValue(null);
    embedder.embedBook.mockResolvedValue([Number.NaN]);

    await expect(service.getRecommendations(6, makeUser())).resolves.toEqual([]);
    expect(recRepo.findAnnCandidates).not.toHaveBeenCalled();
  });

  it('rescales inconsistent provider values and keeps ranking deterministic', async () => {
    const { service, recRepo, bookRepo } = makeService();

    bookRepo.findLibraryIdByBookId.mockResolvedValue(9);
    recRepo.getTargetBookData.mockResolvedValue({
      embedding: [0.1, 0.2],
      seriesName: 'Dune Saga',
      rating: 4,
      authorNames: ['Frank Herbert'],
      genreTagNames: ['Sci-Fi', 'Classic'],
    });
    recRepo.findAnnCandidates.mockResolvedValue([
      { bookId: 100, cosineSim: 1.5, seriesName: ' dune saga ', rating: 9 },
      { bookId: 200, cosineSim: -2, seriesName: 'Other', rating: 4 },
    ]);
    recRepo.getCandidateMetadata.mockResolvedValue([
      { bookId: 100, authorNames: ['Frank Herbert'], genreTagNames: ['Sci-Fi'] },
      { bookId: 200, authorNames: [], genreTagNames: [] },
    ]);
    bookRepo.findRecommendationTitlesByBookIds.mockResolvedValue([
      { id: 200, title: 'Second' },
      { id: 100, title: 'First' },
    ]);

    const result = await service.getRecommendations(9, makeUser());

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 100, title: 'First' });
    expect(result[1]).toEqual({ id: 200, title: 'Second' });
  });

  it('normalizes author and genre-tag metadata before similarity scoring', async () => {
    const { service, recRepo, bookRepo } = makeService();

    bookRepo.findLibraryIdByBookId.mockResolvedValue(13);
    recRepo.getTargetBookData.mockResolvedValue({
      embedding: [0.4, 0.2],
      seriesName: null,
      rating: null,
      authorNames: [' Frank Herbert '],
      genreTagNames: [' Sci-Fi '],
    });
    recRepo.findAnnCandidates.mockResolvedValue([
      { bookId: 1, cosineSim: 0.7, seriesName: null, rating: null },
      { bookId: 2, cosineSim: 0.85, seriesName: null, rating: null },
    ]);
    recRepo.getCandidateMetadata.mockResolvedValue([
      { bookId: 1, authorNames: ['frank herbert'], genreTagNames: ['sci-fi'] },
      { bookId: 2, authorNames: [], genreTagNames: [] },
    ]);
    bookRepo.findRecommendationTitlesByBookIds.mockResolvedValue([
      { id: 1, title: 'Token Match' },
      { id: 2, title: 'Cosine Only' },
    ]);

    const result = await service.getRecommendations(13, makeUser());

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 1, title: 'Token Match' });
    expect(result[1]).toEqual({ id: 2, title: 'Cosine Only' });
  });

  it('filters out ANN results that cannot be mapped to cards', async () => {
    const { service, recRepo, bookRepo } = makeService();

    bookRepo.findLibraryIdByBookId.mockResolvedValue(2);
    recRepo.getTargetBookData.mockResolvedValue({
      embedding: [0.2],
      seriesName: null,
      rating: null,
      authorNames: [],
      genreTagNames: [],
    });
    recRepo.findAnnCandidates.mockResolvedValue([
      { bookId: 10, cosineSim: 0.9, seriesName: null, rating: null },
      { bookId: 11, cosineSim: 0.8, seriesName: null, rating: null },
    ]);
    recRepo.getCandidateMetadata.mockResolvedValue([
      { bookId: 10, authorNames: [], genreTagNames: [] },
      { bookId: 11, authorNames: [], genreTagNames: [] },
    ]);
    bookRepo.findRecommendationTitlesByBookIds.mockResolvedValue([{ id: 11, title: 'Only Card' }]);

    const result = await service.getRecommendations(2, makeUser());

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: 11, title: 'Only Card' });
  });

  it('returns empty recommendations when user has no accessible libraries with ANN candidates', async () => {
    const { service, recRepo, bookRepo, libraryService } = makeService();

    bookRepo.findLibraryIdByBookId.mockResolvedValue(15);
    recRepo.getTargetBookData.mockResolvedValue({
      embedding: [0.2],
      seriesName: null,
      rating: null,
      authorNames: [],
      genreTagNames: [],
    });
    libraryService.findAll.mockResolvedValue([]);
    recRepo.findAnnCandidates.mockResolvedValue([]);

    await expect(service.getRecommendations(15, makeUser())).resolves.toEqual([]);
    expect(recRepo.getCandidateMetadata).not.toHaveBeenCalled();
    expect(bookRepo.findRecommendationTitlesByBookIds).not.toHaveBeenCalled();
  });

  it('limits rescored output to 25 candidates before loading cards', async () => {
    const { service, recRepo, bookRepo } = makeService();

    bookRepo.findLibraryIdByBookId.mockResolvedValue(8);
    recRepo.getTargetBookData.mockResolvedValue({
      embedding: [0.3],
      seriesName: null,
      rating: null,
      authorNames: [],
      genreTagNames: [],
    });

    const candidates = Array.from({ length: 30 }, (_, i) => ({
      bookId: i + 1,
      cosineSim: 1 - i * 0.01,
      seriesName: null,
      rating: null,
    }));

    recRepo.findAnnCandidates.mockResolvedValue(candidates);
    recRepo.getCandidateMetadata.mockResolvedValue(candidates.map((c) => ({ bookId: c.bookId, authorNames: [], genreTagNames: [] })));
    bookRepo.findRecommendationTitlesByBookIds.mockResolvedValue(Array.from({ length: 30 }, (_, i) => ({ id: i + 1, title: `Book ${i + 1}` })));

    const result = await service.getRecommendations(8, makeUser());

    expect(result).toHaveLength(25);
    expect(bookRepo.findRecommendationTitlesByBookIds).toHaveBeenCalledWith(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  describe('getSeriesBooks', () => {
    it('throws NotFoundException when the book does not exist', async () => {
      const { service, bookRepo } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(null);

      await expect(service.getSeriesBooks(999, makeUser())).rejects.toThrow(NotFoundException);
    });

    it('verifies user access to the book library', async () => {
      const { service, bookRepo, libraryService, recRepo } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(21);
      recRepo.getSeriesName.mockResolvedValue(null);

      await service.getSeriesBooks(1, makeUser(true));

      expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(12, 21, true);
    });

    it('returns empty array when the book has no series', async () => {
      const { service, bookRepo, recRepo } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(5);
      recRepo.getSeriesName.mockResolvedValue(null);

      await expect(service.getSeriesBooks(10, makeUser())).resolves.toEqual([]);
      expect(recRepo.findSeriesBooks).not.toHaveBeenCalled();
    });

    it('returns series books ordered by index when book has a series', async () => {
      const { service, bookRepo, recRepo, libraryService } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(5);
      recRepo.getSeriesName.mockResolvedValue('Stormlight Archive');
      libraryService.findAccessibleLibraryIds.mockResolvedValue([5, 6]);
      recRepo.findSeriesBooks.mockResolvedValue([
        { bookId: 1, title: 'The Way of Kings', seriesIndex: 1 },
        { bookId: 2, title: 'Words of Radiance', seriesIndex: 2 },
        { bookId: 3, title: 'Oathbringer', seriesIndex: 3 },
      ]);

      const result = await service.getSeriesBooks(2, makeUser());

      expect(result).toEqual([
        { id: 1, title: 'The Way of Kings', seriesIndex: 1 },
        { id: 2, title: 'Words of Radiance', seriesIndex: 2 },
        { id: 3, title: 'Oathbringer', seriesIndex: 3 },
      ]);
      expect(recRepo.findSeriesBooks).toHaveBeenCalledWith('Stormlight Archive', [5, 6]);
    });

    it('uses findAccessibleLibraryIds instead of findAll', async () => {
      const { service, bookRepo, recRepo, libraryService } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(5);
      recRepo.getSeriesName.mockResolvedValue('Test Series');
      libraryService.findAccessibleLibraryIds.mockResolvedValue([5]);
      recRepo.findSeriesBooks.mockResolvedValue([]);

      await service.getSeriesBooks(1, makeUser());

      expect(libraryService.findAccessibleLibraryIds).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }));
      expect(libraryService.findAll).not.toHaveBeenCalled();
    });
  });

  describe('getAuthorBooks', () => {
    it('throws NotFoundException when the book does not exist', async () => {
      const { service, bookRepo } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(null);

      await expect(service.getAuthorBooks(999, makeUser())).rejects.toThrow(NotFoundException);
    });

    it('verifies user access to the book library', async () => {
      const { service, bookRepo, libraryService, recRepo } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(21);
      recRepo.findAuthorBooks.mockResolvedValue([]);

      await service.getAuthorBooks(1, makeUser(true));

      expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(12, 21, true);
    });

    it('returns books by the same author excluding the current book', async () => {
      const { service, bookRepo, recRepo, libraryService } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(5);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([5]);
      recRepo.findAuthorBooks.mockResolvedValue([
        { bookId: 10, title: 'Other Book A' },
        { bookId: 20, title: 'Other Book B' },
      ]);

      const result = await service.getAuthorBooks(1, makeUser());

      expect(result).toEqual([
        { id: 10, title: 'Other Book A' },
        { id: 20, title: 'Other Book B' },
      ]);
      expect(recRepo.findAuthorBooks).toHaveBeenCalledWith(1, [5]);
    });

    it('returns empty array when author has no other books', async () => {
      const { service, bookRepo, recRepo, libraryService } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(5);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([5]);
      recRepo.findAuthorBooks.mockResolvedValue([]);

      const result = await service.getAuthorBooks(1, makeUser());

      expect(result).toEqual([]);
    });

    it('uses findAccessibleLibraryIds instead of findAll', async () => {
      const { service, bookRepo, recRepo, libraryService } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(5);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([5]);
      recRepo.findAuthorBooks.mockResolvedValue([]);

      await service.getAuthorBooks(1, makeUser());

      expect(libraryService.findAccessibleLibraryIds).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }));
      expect(libraryService.findAll).not.toHaveBeenCalled();
    });
  });
});
