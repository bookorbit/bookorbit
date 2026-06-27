import { MetadataProviderKey, type MetadataCandidate, type MetadataSeriesMembership } from '@bookorbit/types';

import { stripHtml } from '../provider-utils';
import { AudibleProduct } from './audible.types';

const GENERIC_CATEGORIES = new Set(['audible books & originals', 'books', 'kindle books', 'audible originals']);

function extractGenres(product: AudibleProduct): string[] | undefined {
  if (!product.category_ladders?.length) return undefined;
  const genres: string[] = [];
  const seen = new Set<string>();
  for (const { ladder } of product.category_ladders) {
    if (!ladder?.length) continue;
    const leaf = ladder[ladder.length - 1];
    const name = leaf?.name?.trim();
    if (name && !GENERIC_CATEGORIES.has(name.toLowerCase()) && !seen.has(name)) {
      seen.add(name);
      genres.push(name);
    }
  }
  return genres.length ? genres : undefined;
}

function parseSeriesIndex(sequence: string | undefined): number | undefined {
  if (sequence == null || sequence.trim() === '') return undefined;
  const parsed = parseFloat(sequence);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractSeriesMemberships(product: AudibleProduct): MetadataSeriesMembership[] | undefined {
  if (!product.series?.length) return undefined;

  const memberships: MetadataSeriesMembership[] = [];
  const seen = new Set<string>();
  for (const series of product.series) {
    const seriesName = series.title.trim();
    const key = seriesName.toLowerCase();
    if (!seriesName || seen.has(key)) continue;

    const seriesIndex = parseSeriesIndex(series.sequence);
    seen.add(key);
    memberships.push({
      seriesName,
      ...(seriesIndex !== undefined ? { seriesIndex } : {}),
    });
  }

  return memberships.length ? memberships : undefined;
}

function normalizeCommunityRating(product: AudibleProduct): { communityRating?: number; communityRatingCount?: number } {
  const score = product.rating?.overall_distribution?.average_rating;
  const count = product.rating?.overall_distribution?.num_ratings;
  const communityRating = typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 5 ? score : undefined;
  const communityRatingCount = typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : undefined;
  return {
    ...(communityRating !== undefined ? { communityRating } : {}),
    ...(communityRatingCount !== undefined ? { communityRatingCount } : {}),
  };
}

export function mapAudibleProduct(product: AudibleProduct): MetadataCandidate {
  const coverUrl = product.product_images?.[1024] ?? product.product_images?.[500];

  let publishedYear: number | undefined;
  if (product.release_date) {
    const year = new Date(product.release_date).getFullYear();
    if (!isNaN(year)) publishedYear = year;
  }

  const rawDescription = product.publisher_summary ?? product.merchandising_summary;
  const description = rawDescription ? stripHtml(rawDescription) : undefined;

  const durationSeconds = product.runtime_length_min != null ? product.runtime_length_min * 60 : undefined;

  const abridged = product.format_type != null ? product.format_type.toLowerCase() === 'abridged' : undefined;

  const seriesMemberships = extractSeriesMemberships(product);
  const primarySeries = seriesMemberships?.[0];
  const communityRating = normalizeCommunityRating(product);

  return {
    provider: MetadataProviderKey.AUDIBLE,
    providerId: product.asin,
    title: product.title,
    subtitle: product.subtitle,
    authors: product.authors?.map((a) => a.name) ?? [],
    narrators: product.narrators?.map((n) => n.name) ?? [],
    description,
    publisher: product.publisher_name,
    publishedYear,
    language: product.language,
    coverUrl,
    durationSeconds,
    abridged,
    audibleId: product.asin,
    seriesName: primarySeries?.seriesName,
    seriesIndex: primarySeries?.seriesIndex ?? undefined,
    seriesMemberships,
    genres: extractGenres(product),
    ...communityRating,
  };
}
