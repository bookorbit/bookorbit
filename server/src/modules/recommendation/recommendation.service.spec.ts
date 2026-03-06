import { NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { assembleBookCards } from '../book/utils/assemble-book-cards';
import { RecommendationService } from './recommendation.service';

jest.mock('../book/utils/assemble-book-cards', () => ({
  assembleBookCards: jest.fn(),
}));

const mockedAssembleBookCards = jest.mocked(assembleBookCards);

function makeUser(isSuperuser = false): RequestUser {
  return {
    id: 12,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    roles: [
      {
        id: 1,
        name: isSuperuser ? 'Superuser' : 'User',
        description: null,
        isSuperuser,
        isSystem: false,
        permissions: [],
      },
    ],
  };
}

function makeService() {
  const recRepo = {
    getTargetBookData: jest.fn(),
    findAnnCandidates: jest.fn(),
    getCandidateMetadata: jest.fn(),
  };
  const bookRepo = {
    findLibraryIdByBookId: jest.fn(),
    findCards: jest.fn(),
  };
  const libraryService = {
    verifyUserAccess: jest.fn().mockResolvedValue(undefined),
    findAll: jest.fn().mockResolvedValue([{ id: 7 }]),
  };
  const embedder = {
    embedBook: jest.fn(),
  };

  const service = new RecommendationService(recRepo as never, bookRepo as never, libraryService as never, embedder as never);

  return { service, recRepo, bookRepo, libraryService, embedder };
}

describe('RecommendationService', () => {
  beforeEach(() => {
    mockedAssembleBookCards.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
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

  it('returns empty recommendations when the target book has no metadata row', async () => {
    const { service, bookRepo, recRepo, embedder } = makeService();

    bookRepo.findLibraryIdByBookId.mockResolvedValue(21);
    recRepo.getTargetBookData.mockResolvedValue(null);

    await expect(service.getRecommendations(55, makeUser())).resolves.toEqual([]);
    expect(embedder.embedBook).not.toHaveBeenCalled();
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
    bookRepo.findCards.mockResolvedValue({
      rows: [{ id: 100 }, { id: 200 }],
      authorRows: [],
      fileRows: [],
      genreRows: [],
      tagRows: [],
      progressRows: [],
      total: 2,
    });
    mockedAssembleBookCards.mockReturnValue([{ id: 200, title: 'Second' } as never, { id: 100, title: 'First' } as never]);

    const result = await service.getRecommendations(9, makeUser());

    expect(result).toHaveLength(2);
    expect(result[0].book.id).toBe(100);
    expect(result[1].book.id).toBe(200);
    expect(result[0].score).toBeCloseTo(0.825, 6);
    expect(result[1].score).toBeCloseTo(0.05, 6);
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
    bookRepo.findCards.mockResolvedValue({ rows: [], authorRows: [], fileRows: [], genreRows: [], tagRows: [], progressRows: [], total: 0 });
    mockedAssembleBookCards.mockReturnValue([{ id: 11, title: 'Only Card' } as never]);

    const result = await service.getRecommendations(2, makeUser());

    expect(result).toHaveLength(1);
    expect(result[0].book).toEqual({ id: 11, title: 'Only Card' });
    expect(result[0].score).toBeCloseTo(0.425, 6);
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
    bookRepo.findCards.mockResolvedValue({
      rows: Array.from({ length: 30 }, (_, i) => ({ id: i + 1 })),
      authorRows: [],
      fileRows: [],
      genreRows: [],
      tagRows: [],
      progressRows: [],
      total: 30,
    });
    mockedAssembleBookCards.mockReturnValue(Array.from({ length: 30 }, (_, i) => ({ id: i + 1, title: `Book ${i + 1}` })) as never);

    const result = await service.getRecommendations(8, makeUser());

    expect(result).toHaveLength(25);
    expect(bookRepo.findCards).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 25,
        offset: 0,
        userId: 12,
      }),
    );
  });
});
