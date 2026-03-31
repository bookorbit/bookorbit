import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { BookRecommendation } from '@projectx/types';
import type { RequestUser } from '../../common/types/request-user';
import { BookEmbedderService } from '../embedding/book-embedder.service';
import { BookReadService } from '../book/book-read.service';
import { LibraryService } from '../library/library.service';
import { AnnCandidate, CandidateMetadata, RecommendationRepository, TargetBookData } from './recommendation.repository';

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
    const libraryId = await this.bookReadService.findLibraryIdByBookId(bookId);
    if (libraryId === null) throw new NotFoundException(`Book ${bookId} not found`);
    await this.libraryService.verifyUserAccess(user.id, libraryId, this.isSuperuser(user));

    const target = await this.recRepo.getTargetBookData(bookId);
    if (!target) return [];

    let embedding = target.embedding;
    if (!embedding) {
      embedding = await this.embedder.embedBook(bookId);
    }
    if (!this.isValidEmbedding(embedding)) return [];

    const libs = await this.libraryService.findAll(user);
    const accessibleLibraryIds = libs.map((l) => l.id);

    const candidates = await this.recRepo.findAnnCandidates(embedding, bookId, accessibleLibraryIds);
    if (candidates.length === 0) return [];

    const candidateMetadata = await this.recRepo.getCandidateMetadata(candidates.map((c) => c.bookId));
    const metaMap = new Map(candidateMetadata.map((m) => [m.bookId, m]));

    const rescored = candidates
      .map((c) => ({ bookId: c.bookId, score: this.rescore(c, target, metaMap.get(c.bookId) ?? null) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);

    if (rescored.length === 0) return [];

    const topIds = rescored.map((r) => r.bookId);
    const rows = await this.bookReadService.findRecommendationTitlesByBookIds(topIds);
    const rowMap = new Map(rows.map((row) => [row.id, row]));
    return rescored.map((r) => rowMap.get(r.bookId)).filter((row): row is { id: number; title: string | null } => row != null);
  }

  private rescore(candidate: AnnCandidate, target: TargetBookData, meta: CandidateMetadata | null): number {
    const cosineSim = Math.max(0, Math.min(1, candidate.cosineSim));

    const authorSim = meta ? this.jaccard(new Set(target.authorNames), new Set(meta.authorNames)) : 0;
    const genreTagSim = meta ? this.jaccard(new Set(target.genreTagNames), new Set(meta.genreTagNames)) : 0;

    const targetSeries = this.normalizeSeries(target.seriesName);
    const candidateSeries = this.normalizeSeries(candidate.seriesName);
    const seriesBonus = targetSeries && candidateSeries && targetSeries === candidateSeries ? 1.0 : 0.0;

    let ratingProximity = 0.5;
    if (target.rating != null && candidate.rating != null) {
      ratingProximity = Math.max(0, Math.min(1, 1 - Math.abs(target.rating - candidate.rating) / 4));
    }

    return 0.5 * cosineSim + 0.1 * authorSim + 0.25 * genreTagSim + 0.1 * seriesBonus + 0.05 * ratingProximity;
  }

  private jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 0;
    let intersection = 0;
    for (const x of a) if (b.has(x)) intersection++;
    return intersection / (a.size + b.size - intersection);
  }

  private isSuperuser(user: RequestUser): boolean {
    return user.isSuperuser;
  }

  private isValidEmbedding(embedding: number[] | null): embedding is number[] {
    return Array.isArray(embedding) && embedding.length > 0 && embedding.every((v) => Number.isFinite(v));
  }

  private normalizeSeries(seriesName: string | null): string | null {
    if (!seriesName) return null;
    const normalized = seriesName.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }
}
