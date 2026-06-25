import { Injectable } from '@nestjs/common';
import type { BookMetadataFetchConfig, MetadataField } from '@bookorbit/types';

export interface BookEligibilityData {
  metadataScore: number | null;
  lastMetadataFetchAt: Date | null;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  communityRating: readonly unknown[];
  seriesName: string | null;
  seriesIndex: number | null;
  coverSource: string | null;
  hasAuthors: boolean;
  hasGenres: boolean;
  hasNarrators: boolean;
  durationSeconds: number | null;
  abridged: boolean | null;
}

@Injectable()
export class BookMetadataFetchEligibilityService {
  isEligible(book: BookEligibilityData, config: BookMetadataFetchConfig): boolean {
    const { conditions } = config;

    if (conditions.neverFetched.enabled && book.lastMetadataFetchAt === null) {
      return true;
    }

    if (conditions.scoreThreshold.enabled) {
      const score = book.metadataScore;
      if (score === null || score < conditions.scoreThreshold.threshold) {
        return true;
      }
    }

    if (conditions.missingFields.enabled && conditions.missingFields.fields.length > 0) {
      for (const field of conditions.missingFields.fields) {
        if (this.isFieldMissing(field, book)) return true;
      }
    }

    return false;
  }

  private isFieldMissing(field: MetadataField, book: BookEligibilityData): boolean {
    switch (field) {
      case 'authors':
        return !book.hasAuthors;
      case 'genres':
        return !book.hasGenres;
      case 'narrators':
        return !book.hasNarrators;
      case 'duration':
        return book.durationSeconds === null;
      case 'abridged':
        return book.abridged === null;
      case 'cover':
        return book.coverSource === null;
      case 'title':
        return book.title === null || book.title === '';
      case 'subtitle':
        return book.subtitle === null || book.subtitle === '';
      case 'description':
        return book.description === null || book.description === '';
      case 'publisher':
        return book.publisher === null || book.publisher === '';
      case 'publishedYear':
        return book.publishedYear === null;
      case 'language':
        return book.language === null || book.language === '';
      case 'pageCount':
        return book.pageCount === null;
      case 'communityRating':
        return book.communityRating.length === 0;
      case 'seriesName':
        return book.seriesName === null || book.seriesName === '';
      case 'seriesIndex':
        return book.seriesIndex === null;
      default:
        return false;
    }
  }
}
