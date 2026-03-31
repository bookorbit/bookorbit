import { Injectable } from '@nestjs/common';
import type { MetadataScoreField, MetadataScoreWeights } from '@projectx/types';

export type ScoreData = {
  title: string | null;
  subtitle: string | null;
  description: string | null;
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  rating: number | null;
  coverSource: string | null;
  googleBooksId: string | null;
  goodreadsId: string | null;
  amazonId: string | null;
  hardcoverId: string | null;
  openLibraryId: string | null;
  itunesId: string | null;
  authorCount: number;
  genreCount: number;
  tagCount: number;
};

type ScoreRuleKind = 'string' | 'positive-number' | 'count';
type ScoreRule = { kind: ScoreRuleKind; value: (data: ScoreData) => string | number | null };

const SCORE_RULES: Record<MetadataScoreField, ScoreRule> = {
  title: { kind: 'string', value: (data) => data.title },
  subtitle: { kind: 'string', value: (data) => data.subtitle },
  description: { kind: 'string', value: (data) => data.description },
  coverSource: { kind: 'string', value: (data) => data.coverSource },
  genres: { kind: 'count', value: (data) => data.genreCount },
  isbn13: { kind: 'string', value: (data) => data.isbn13 },
  publisher: { kind: 'string', value: (data) => data.publisher },
  publishedYear: { kind: 'positive-number', value: (data) => data.publishedYear },
  language: { kind: 'string', value: (data) => data.language },
  isbn10: { kind: 'string', value: (data) => data.isbn10 },
  pageCount: { kind: 'positive-number', value: (data) => data.pageCount },
  rating: { kind: 'positive-number', value: (data) => data.rating },
  seriesName: { kind: 'string', value: (data) => data.seriesName },
  seriesIndex: { kind: 'positive-number', value: (data) => data.seriesIndex },
  tags: { kind: 'count', value: (data) => data.tagCount },
  authors: { kind: 'count', value: (data) => data.authorCount },
  googleBooksId: { kind: 'string', value: (data) => data.googleBooksId },
  goodreadsId: { kind: 'string', value: (data) => data.goodreadsId },
  amazonId: { kind: 'string', value: (data) => data.amazonId },
  hardcoverId: { kind: 'string', value: (data) => data.hardcoverId },
  openLibraryId: { kind: 'string', value: (data) => data.openLibraryId },
  itunesId: { kind: 'string', value: (data) => data.itunesId },
};

@Injectable()
export class MetadataScoreScorer {
  compute(data: ScoreData, weights: MetadataScoreWeights): number {
    let earned = 0;
    let total = 0;

    for (const [field, rawWeight] of Object.entries(weights) as [MetadataScoreField, number][]) {
      const weight = Number(rawWeight);
      if (!Number.isFinite(weight) || weight <= 0) continue;
      total += weight;

      if (this.hasValue(SCORE_RULES[field], data)) {
        earned += weight;
      }
    }

    if (total === 0) return 0;
    return Math.floor((earned / total) * 100);
  }

  private hasValue(rule: ScoreRule, data: ScoreData): boolean {
    const raw = rule.value(data);

    switch (rule.kind) {
      case 'string':
        return typeof raw === 'string' && raw.trim().length > 0;
      case 'count':
      case 'positive-number':
        return typeof raw === 'number' && raw > 0;
    }
  }
}
