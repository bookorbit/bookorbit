import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { BookRecommendation } from '@projectx/types';
import type { RequestUser } from '../../common/types/request-user';
import { BookEmbedderService } from '../embedding/book-embedder.service';
import { BookReadService } from '../book/book-read.service';
import { LibraryService } from '../library/library.service';
import { AnnCandidate, CandidateMetadata, RecommendationRepository, TargetBookData } from './recommendation.repository';

const RECOMMENDATION_EVENT = 'book.recommendations';
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

      const candidates = await this.recRepo.findAnnCandidates(embedding, bookId, accessibleLibraryIds);
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
        .filter((row): row is { id: number; title: string | null } => row != null);

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

  private rescore(candidate: AnnCandidate, target: TargetBookData, meta: CandidateMetadata | null): number {
    const cosineSim = this.clamp01(candidate.cosineSim);

    const authorSim = meta ? this.jaccard(this.toNormalizedSet(target.authorNames), this.toNormalizedSet(meta.authorNames)) : 0;
    const genreTagSim = meta ? this.jaccard(this.toNormalizedSet(target.genreTagNames), this.toNormalizedSet(meta.genreTagNames)) : 0;

    const targetSeries = this.normalizeSeries(target.seriesName);
    const candidateSeries = this.normalizeSeries(candidate.seriesName);
    const seriesBonus = targetSeries && candidateSeries && targetSeries === candidateSeries ? 1.0 : 0.0;

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
      seriesName: null,
      rating: null,
      authorNames: [],
      genreTagNames: [],
    };
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private normalizeSeries(seriesName: string | null): string | null {
    if (!seriesName) return null;
    const normalized = seriesName.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }

  private parseError(err: unknown): { errorClass: string; errorMessage: string } {
    if (err instanceof Error) {
      return { errorClass: err.constructor.name, errorMessage: this.sanitizeErrorMessage(err.message) };
    }
    return { errorClass: 'UnknownError', errorMessage: this.sanitizeErrorMessage(String(err)) };
  }

  private sanitizeErrorMessage(message: string): string {
    return message.replace(/[\r\n"]/g, ' ').slice(0, 200);
  }
}
