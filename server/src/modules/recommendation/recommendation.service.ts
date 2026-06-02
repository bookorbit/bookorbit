import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { BookRecommendation, SeriesBookRecommendation } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { BookEmbedderService } from '../embedding/book-embedder.service';
import { BookReadService } from '../book/book-read.service';
import { LibraryService } from '../library/library.service';
import { AnnCandidate, CandidateMetadata, RecommendationRepository, TargetBookData } from './recommendation.repository';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

const RECOMMENDATION_EVENT = 'book.recommendations';
const SERIES_BOOKS_EVENT = 'book.series_books';
const AUTHOR_BOOKS_EVENT = 'book.author_books';
const MAX_RECOMMENDATIONS = 25;
const DEFAULT_RATING_PROXIMITY = 0.5;
const RATING_PROXIMITY_RANGE = 4;
const SCORE_WEIGHTS = {
  cosineSim: 0.5,
  authorSim: 0.1,
  genreTagSim: 0.25,
  seriesBonus: 0.1,
  ratingProximity: 0.05,
} as const;

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(
    private readonly recRepo: RecommendationRepository,
    private readonly bookReadService: BookReadService,
    private readonly libraryService: LibraryService,
    private readonly embedder: BookEmbedderService,
  ) {}

  async getRecommendations(bookId: number, user: RequestUser): Promise<BookRecommendation[]> {
    const startedAt = Date.now();
    this.logger.log(
      `[${RECOMMENDATION_EVENT}] [start] bookId=${bookId} userId=${user.id} isSuperuser=${user.isSuperuser} - recommendation lookup started`,
    );

    try {
      const libraryId = await this.bookReadService.findLibraryIdByBookId(bookId);
      if (libraryId === null) throw new NotFoundException(`Book ${bookId} not found`);
      await this.libraryService.verifyUserAccess(user.id, libraryId, user.isSuperuser);

      const target = (await this.recRepo.getTargetBookData(bookId)) ?? this.createFallbackTarget();
      const embedding = target.embedding ?? (await this.embedder.embedBook(bookId));
      if (!this.isValidEmbedding(embedding)) {
        this.logger.log(
          `[${RECOMMENDATION_EVENT}] [end] bookId=${bookId} userId=${user.id} libraryId=${libraryId} durationMs=${Date.now() - startedAt} reason=invalid_embedding - recommendation lookup completed`,
        );
        return [];
      }

      const accessibleLibraries = await this.libraryService.findAll(user);
      const accessibleLibraryIds = accessibleLibraries.map((library) => library.id);

      const candidates = await this.recRepo.findAnnCandidates(
        embedding,
        bookId,
        accessibleLibraryIds,
        user.isSuperuser ? undefined : user.contentFilters,
      );
      if (candidates.length === 0) {
        this.logger.log(
          `[${RECOMMENDATION_EVENT}] [end] bookId=${bookId} userId=${user.id} libraryId=${libraryId} durationMs=${Date.now() - startedAt} accessibleLibraryCount=${accessibleLibraryIds.length} candidateCount=0 resultCount=0 - recommendation lookup completed`,
        );
        return [];
      }

      const candidateMetadata = await this.recRepo.getCandidateMetadata(candidates.map((c) => c.bookId));
      const metaMap = new Map(candidateMetadata.map((m) => [m.bookId, m]));

      const rescored = candidates
        .map((candidate) => ({
          bookId: candidate.bookId,
          score: this.rescore(candidate, target, metaMap.get(candidate.bookId) ?? null),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RECOMMENDATIONS);

      if (rescored.length === 0) {
        this.logger.log(
          `[${RECOMMENDATION_EVENT}] [end] bookId=${bookId} userId=${user.id} libraryId=${libraryId} durationMs=${Date.now() - startedAt} accessibleLibraryCount=${accessibleLibraryIds.length} candidateCount=${candidates.length} rescoredCount=0 resultCount=0 - recommendation lookup completed`,
        );
        return [];
      }

      const topIds = rescored.map((row) => row.bookId);
      const rows = await this.bookReadService.findRecommendationTitlesByBookIds(topIds);
      const rowMap = new Map(rows.map((row) => [row.id, row]));
      const recommendations = rescored
        .map((rescoredCandidate) => rowMap.get(rescoredCandidate.bookId))
        .filter((row): row is { id: number; title: string | null; hasCover: boolean; authors: string[]; isAudiobook: boolean } => row != null);

      this.logger.log(
        `[${RECOMMENDATION_EVENT}] [end] bookId=${bookId} userId=${user.id} libraryId=${libraryId} durationMs=${Date.now() - startedAt} accessibleLibraryCount=${accessibleLibraryIds.length} candidateCount=${candidates.length} rescoredCount=${rescored.length} resultCount=${recommendations.length} - recommendation lookup completed`,
      );

      return recommendations;
    } catch (err) {
      const { errorClass, errorMessage } = this.parseError(err);
      this.logger.error(
        `[${RECOMMENDATION_EVENT}] [fail] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - recommendation lookup failed`,
      );
      throw err;
    }
  }

  async getSeriesBooks(bookId: number, user: RequestUser): Promise<SeriesBookRecommendation[]> {
    const startedAt = Date.now();
    this.logger.log(`[${SERIES_BOOKS_EVENT}] [start] bookId=${bookId} userId=${user.id} - series books lookup started`);

    try {
      const libraryId = await this.bookReadService.findLibraryIdByBookId(bookId);
      if (libraryId === null) throw new NotFoundException(`Book ${bookId} not found`);
      await this.libraryService.verifyUserAccess(user.id, libraryId, user.isSuperuser);

      const series = await this.recRepo.getSeriesIdentity(bookId);
      if (!series) {
        this.logger.log(
          `[${SERIES_BOOKS_EVENT}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} reason=no_series - series books lookup completed`,
        );
        return [];
      }

      const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const rows = await this.recRepo.findSeriesBooks(series.id, libraryIds, user.isSuperuser ? undefined : user.contentFilters);

      this.logger.log(
        `[${SERIES_BOOKS_EVENT}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} seriesId=${series.id} seriesName="${sanitizeLogValue(series.name ?? '')}" resultCount=${rows.length} - series books lookup completed`,
      );

      return rows.map((r) => ({
        id: r.bookId,
        title: r.title,
        seriesIndex: r.seriesIndex,
        hasCover: r.coverSource !== null,
        authors: r.authorNames,
        isAudiobook: r.isAudiobook,
      }));
    } catch (err) {
      const { errorClass, errorMessage } = this.parseError(err);
      this.logger.error(
        `[${SERIES_BOOKS_EVENT}] [fail] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - series books lookup failed`,
      );
      throw err;
    }
  }

  async getAuthorBooks(bookId: number, user: RequestUser): Promise<BookRecommendation[]> {
    const startedAt = Date.now();
    this.logger.log(`[${AUTHOR_BOOKS_EVENT}] [start] bookId=${bookId} userId=${user.id} - author books lookup started`);

    try {
      const libraryId = await this.bookReadService.findLibraryIdByBookId(bookId);
      if (libraryId === null) throw new NotFoundException(`Book ${bookId} not found`);
      await this.libraryService.verifyUserAccess(user.id, libraryId, user.isSuperuser);

      const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const rows = await this.recRepo.findAuthorBooks(bookId, libraryIds, user.isSuperuser ? undefined : user.contentFilters);

      this.logger.log(
        `[${AUTHOR_BOOKS_EVENT}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} resultCount=${rows.length} - author books lookup completed`,
      );

      return rows.map((r) => ({
        id: r.bookId,
        title: r.title,
        hasCover: r.coverSource !== null,
        authors: r.authorNames,
        isAudiobook: r.isAudiobook,
      }));
    } catch (err) {
      const { errorClass, errorMessage } = this.parseError(err);
      this.logger.error(
        `[${AUTHOR_BOOKS_EVENT}] [fail] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - author books lookup failed`,
      );
      throw err;
    }
  }

  private rescore(candidate: AnnCandidate, target: TargetBookData, meta: CandidateMetadata | null): number {
    const cosineSim = this.clamp01(candidate.cosineSim);

    const authorSim = meta ? this.jaccard(this.toNormalizedSet(target.authorNames), this.toNormalizedSet(meta.authorNames)) : 0;
    const genreTagSim = meta ? this.jaccard(this.toNormalizedSet(target.genreTagNames), this.toNormalizedSet(meta.genreTagNames)) : 0;

    const seriesBonus = target.seriesId != null && candidate.seriesId === target.seriesId ? 1.0 : 0.0;

    let ratingProximity = DEFAULT_RATING_PROXIMITY;
    if (target.rating != null && candidate.rating != null) {
      ratingProximity = this.clamp01(1 - Math.abs(target.rating - candidate.rating) / RATING_PROXIMITY_RANGE);
    }

    return (
      SCORE_WEIGHTS.cosineSim * cosineSim +
      SCORE_WEIGHTS.authorSim * authorSim +
      SCORE_WEIGHTS.genreTagSim * genreTagSim +
      SCORE_WEIGHTS.seriesBonus * seriesBonus +
      SCORE_WEIGHTS.ratingProximity * ratingProximity
    );
  }

  private jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 0;
    let intersection = 0;
    for (const x of a) if (b.has(x)) intersection++;
    return intersection / (a.size + b.size - intersection);
  }

  private isValidEmbedding(embedding: number[] | null): embedding is number[] {
    return Array.isArray(embedding) && embedding.length > 0 && embedding.every((v) => Number.isFinite(v));
  }

  private toNormalizedSet(values: string[]): Set<string> {
    return new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0));
  }

  private createFallbackTarget(): TargetBookData {
    return {
      embedding: null,
      seriesId: null,
      seriesName: null,
      rating: null,
      authorNames: [],
      genreTagNames: [],
    };
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private parseError(err: unknown): { errorClass: string; errorMessage: string } {
    if (err instanceof Error) {
      return { errorClass: err.constructor.name, errorMessage: sanitizeLogValue(err.message).slice(0, 200) };
    }
    return { errorClass: 'UnknownError', errorMessage: sanitizeLogValue(String(err)).slice(0, 200) };
  }
}
