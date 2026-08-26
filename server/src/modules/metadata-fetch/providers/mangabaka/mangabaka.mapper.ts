import { ComicMetadataFields, MetadataCandidate, MetadataProviderKey, MetadataSeriesMembership } from '@bookorbit/types';

import { MangabakaCollection, MangabakaSeries, MangabakaWork } from './mangabaka.types';

const MANGABAKA_BASE_URL = 'https://mangabaka.org';

// Language priority for title resolution, matching MangaBaka's v2 titles system.
// Walk this list and pick the first language with a title; within each language,
// is_primary wins, then official > native > alternative.
const TITLE_LANGUAGE_PRIORITY = ['en', 'ja-Latn', 'ja', 'ko-Latn', 'ko', 'zh-Latn', 'zh', 'fr', 'de', 'es-la', 'pt-br'];

function toTitleCase(str: string): string {
  return str.replace(/\b\w+/g, (word) => {
    if (word === word.toUpperCase() && word.length > 1) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }
    return word;
  });
}

// MangaBaka sometimes stores truncated/garbage sub_titles (e.g. "The ").
// Reject values that are empty after trimming, too short to be meaningful,
// or that end mid-word (trailing space or a lone trailing word fragment).
function sanitizeSubtitle(subtitle: string | null | undefined): string | undefined {
  if (!subtitle) return undefined;
  const trimmed = subtitle.trim();
  if (trimmed.length < 3) return undefined;
  // Reject values that look truncated: end with a space or a single dangling word.
  if (/\s$/.test(subtitle)) return undefined;
  if (/^[a-z]+$/i.test(trimmed) && trimmed.length < 5) return undefined;
  return trimmed;
}

function sortScore(t: { is_primary: boolean; traits: string[] }): number {
  if (t.is_primary) return 0;
  if (t.traits.includes('official')) return 1;
  if (t.traits.includes('native')) return 2;
  return 3;
}

function bestInGroup(titles: MangabakaSeries['titles'] | undefined, lang: string): string | undefined {
  if (!titles?.length) return undefined;
  const candidates = titles.filter((t) => t.language === lang);
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => sortScore(a) - sortScore(b));
  return candidates[0].title;
}

function resolveTitle(series: MangabakaSeries): string {
  // v2 titles system: walk language priority, pick best per language
  if (series.titles?.length) {
    for (const lang of TITLE_LANGUAGE_PRIORITY) {
      const title = bestInGroup(series.titles, lang);
      if (title) return toTitleCase(title);
    }
    // Fallback: native-trait titles
    const nativeTitle = series.titles.find((t) => t.traits.includes('native'));
    if (nativeTitle) return toTitleCase(nativeTitle.title);
    // Fallback: any title
    return toTitleCase(series.titles[0].title);
  }
  // v1 fallback (deprecated but still present)
  if (series.romanized_title) return toTitleCase(series.romanized_title);
  return toTitleCase(series.title);
}

function resolveSubtitle(series: MangabakaSeries): string | undefined {
  // v2: find a secondary language title that differs from primary
  if (series.titles?.length) {
    const rawMainTitle = resolveRawTitle(series.titles);
    // Try native language title as subtitle
    const nativeTitle = series.titles.find((t) => t.traits.includes('native'));
    if (nativeTitle && nativeTitle.title !== rawMainTitle) return nativeTitle.title;
    // Try any other language title
    const otherTitle = series.titles.find((t) => t.title !== rawMainTitle);
    if (otherTitle) return otherTitle.title;
    return undefined;
  }
  // v1 fallback
  const rawV1Title =
    series.titles?.find((t) => t.language === 'en' && t.is_primary && t.traits?.includes('official'))?.title ??
    series.romanized_title ??
    series.title;
  if (series.native_title && series.native_title !== rawV1Title) {
    return series.native_title;
  }
  if (series.romanized_title && series.romanized_title !== rawV1Title) {
    return series.romanized_title;
  }
  return undefined;
}

function resolveRawTitle(titles: MangabakaSeries['titles']): string | undefined {
  if (!titles?.length) return undefined;
  for (const lang of TITLE_LANGUAGE_PRIORITY) {
    const title = bestInGroup(titles, lang);
    if (title) return title;
  }
  const nativeTitle = titles.find((t) => t.traits.includes('native'));
  if (nativeTitle) return nativeTitle.title;
  return titles[0].title;
}

function resolveAuthors(series: MangabakaSeries): string[] | undefined {
  if (!series.authors?.length) return undefined;
  return series.authors;
}

function resolvePublisher(series: MangabakaSeries): string | undefined {
  if (!series.publishers?.length) return undefined;
  const english = series.publishers.find((p) => p.type === 'English');
  if (english) return english.name;
  const original = series.publishers.find((p) => p.type === 'Original');
  return original?.name;
}

function resolvePublishedYear(series: MangabakaSeries): number | undefined {
  if (series.year) return series.year;
  if (series.published?.start_date) {
    const year = parseInt(series.published.start_date.substring(0, 4), 10);
    if (Number.isFinite(year) && year >= 1000 && year <= 2200) return year;
  }
  return undefined;
}

function resolvePublishedDate(series: MangabakaSeries): string | undefined {
  if (!series.published?.start_date) return undefined;
  return series.published.start_date;
}

function resolveGenres(series: MangabakaSeries): string[] | undefined {
  if (!series.genres?.length) return undefined;
  return series.genres.slice(0, 10);
}

function resolveCoverUrl(series: MangabakaSeries): string | undefined {
  if (!series.cover) return undefined;
  return series.cover.x250?.x1 ?? series.cover.x350?.x1 ?? series.cover.x150?.x1 ?? series.cover.raw?.url;
}

function resolveDescription(series: MangabakaSeries): string | undefined {
  if (!series.description) return undefined;
  const trimmed = series.description.trim();
  return trimmed || undefined;
}

function normalizeCommunityRating(rating: number | null): number | undefined {
  if (rating === null || rating === undefined) return undefined;
  if (!Number.isFinite(rating)) return undefined;
  const normalized = rating / 20;
  if (normalized < 0 || normalized > 5) return undefined;
  return Math.round(normalized * 100) / 100;
}

function resolveSourceUrl(series: MangabakaSeries): string {
  const mangabakaLink = series.links_v2?.find((l) => l.name === 'mangabaka.org');
  if (mangabakaLink) return mangabakaLink.url;
  return `${MANGABAKA_BASE_URL}/${series.id}`;
}

// MangaBaka works represent volumes (Series -> Volume -> Chapter).
// A work's sequence_numeric is the volume number, not an issue number.
// comicMetadata maps the Volume level: volumeName from sub_title, pencillers from artists.
// issueNumber is intentionally NOT set because manga volumes are the leaf unit,
// not issues within a volume.
function resolveComicMetadata(series: MangabakaSeries, work?: MangabakaWork): ComicMetadataFields | undefined {
  const pencillers = series.artists?.length ? series.artists : undefined;
  const volumeName = sanitizeSubtitle(work?.sub_title);

  const comicMetadata: ComicMetadataFields = {};
  if (pencillers) comicMetadata.pencillers = pencillers;
  if (volumeName) comicMetadata.volumeName = volumeName;

  return Object.keys(comicMetadata).length > 0 ? comicMetadata : undefined;
}

export function mapMangabakaSeries(series: MangabakaSeries): MetadataCandidate | null {
  if (!series?.id) return null;
  if (series.merged_with !== null) return null;

  const communityRating = normalizeCommunityRating(series.rating);
  const communityRatingCount = series.popularity?.global?.current;

  const comicMetadata = resolveComicMetadata(series);

  return {
    provider: MetadataProviderKey.MANGABAKA,
    providerId: String(series.id),
    title: resolveTitle(series),
    subtitle: resolveSubtitle(series),
    authors: resolveAuthors(series),
    description: resolveDescription(series),
    publisher: resolvePublisher(series),
    publishedDate: resolvePublishedDate(series),
    publishedYear: resolvePublishedYear(series),
    genres: resolveGenres(series),
    coverUrl: resolveCoverUrl(series),
    sourceUrl: resolveSourceUrl(series),
    seriesName: undefined,
    seriesIndex: undefined,
    ...(comicMetadata ? { comicMetadata } : {}),
    ...(communityRating !== undefined ? { communityRating } : {}),
    ...(communityRatingCount !== undefined ? { communityRatingCount } : {}),
  };
}

// Pick the best collection for volume matching.
// Prefers: type "volume", English language, digital medium (complete covers),
// then most works (count_main, capped at 50).
export function pickBestCollection(collections: MangabakaCollection[], preferredLanguage?: string): MangabakaCollection | null {
  if (collections.length === 0) return null;

  const scored = collections.map((c) => {
    let score = 0;
    if (c.type === 'volume') score += 100;
    if (c.language?.iso === (preferredLanguage ?? 'en')) score += 50;
    if (c.medium === 'digital') score += 40;
    score += Math.min(c.count_main, 50);
    return { collection: c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].collection;
}

export interface WorkTitleOptions {
  /** When true, compose "Series, Vol. NN: Subtitle, Ch NNNN" with subtitle and
   *  chapter. When false, use the simpler "Series, Vol. NN - Ch NNN" format. */
  richTitleFormat?: boolean;
  /** When true and chapterNumber is provided, include the chapter portion. */
  includeChapter?: boolean;
}

function formatWorkTitle(
  seriesTitle: string,
  volumeNumber: number | undefined,
  chapterNumber: number | undefined,
  subtitle: string | undefined,
  options: WorkTitleOptions = {},
): string {
  const { richTitleFormat = true, includeChapter = false } = options;
  let title = seriesTitle;
  if (volumeNumber !== undefined) {
    title += `, Vol. ${String(volumeNumber).padStart(2, '0')}`;
  }
  if (richTitleFormat) {
    if (subtitle && volumeNumber !== undefined) {
      title += `: ${subtitle}`;
    }
    if (includeChapter && chapterNumber !== undefined) {
      title += `, Ch ${String(chapterNumber).padStart(4, '0')}`;
    }
  } else {
    if (chapterNumber !== undefined) {
      title += ` - Ch ${String(chapterNumber).padStart(3, '0')}`;
    }
  }
  return title;
}

export function mapMangabakaWork(
  work: MangabakaWork,
  series: MangabakaSeries,
  chapterNumber?: number,
  options?: WorkTitleOptions,
  preferredLanguage?: string,
): MetadataCandidate | null {
  if (!work?.id) return null;

  const communityRating = normalizeCommunityRating(series.rating);
  const communityRatingCount = series.popularity?.global?.current;
  const bestCollection = work.collections?.length ? pickBestCollection(work.collections, preferredLanguage) : null;

  let isbn10: string | undefined;
  let isbn13: string | undefined;
  for (const ident of work.identifiers ?? []) {
    if (ident.name === 'isbn') {
      const clean = ident.id.replace(/[-\s]/g, '');
      if (clean.length === 13) {
        isbn13 = clean;
      } else if (clean.length === 10) {
        isbn10 = clean;
      }
    }
  }

  const img = work.images?.[0]?.image;
  const coverUrl = img?.x250?.x1 ?? img?.x350?.x1 ?? img?.x150?.x1 ?? img?.raw?.url;

  let publishedYear: number | undefined;
  if (work.release_date) {
    const year = parseInt(work.release_date.substring(0, 4), 10);
    if (Number.isFinite(year) && year >= 1000 && year <= 2200) {
      publishedYear = year;
    }
  }
  if (publishedYear === undefined) {
    publishedYear = resolvePublishedYear(series);
  }

  const comicMetadata = resolveComicMetadata(series, work);
  const seriesName = resolveTitle(series);
  const sequenceString = work.sequence_numeric != null ? String(work.sequence_numeric) : undefined;
  const seriesMemberships: MetadataSeriesMembership[] | undefined =
    seriesName && sequenceString ? [{ seriesName, seriesIndex: sequenceString }] : undefined;
  const subtitle = sanitizeSubtitle(work.sub_title);

  return {
    provider: MetadataProviderKey.MANGABAKA,
    providerId: work.id,
    mangabakaSeriesId: String(series.id),
    title: formatWorkTitle(resolveTitle(series), work.sequence_numeric, chapterNumber, subtitle, options),
    subtitle,
    authors: resolveAuthors(series),
    description: work.description?.desc?.trim() || undefined,
    publisher: bestCollection?.publisher?.name ?? resolvePublisher(series),
    publishedDate: work.release_date ?? undefined,
    publishedYear,
    language: bestCollection?.language?.iso ?? undefined,
    pageCount: work.pages ?? undefined,
    ...(isbn13 ? { isbn13 } : {}),
    ...(isbn10 ? { isbn10 } : {}),
    seriesName: resolveTitle(series),
    seriesIndex: sequenceString,
    ...(comicMetadata ? { comicMetadata } : {}),
    ...(seriesMemberships ? { seriesMemberships } : {}),
    genres: resolveGenres(series),
    coverUrl,
    sourceUrl: `https://mangabaka.org/work/${work.id}`,
    ...(communityRating !== undefined ? { communityRating } : {}),
    ...(communityRatingCount !== undefined ? { communityRatingCount } : {}),
  };
}
