import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

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

  const series = product.series?.[0];
  const seriesIndex = series?.sequence != null ? parseFloat(series.sequence) : undefined;

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
    seriesName: series?.title,
    seriesIndex: !isNaN(seriesIndex ?? NaN) ? seriesIndex : undefined,
    genres: extractGenres(product),
  };
}
