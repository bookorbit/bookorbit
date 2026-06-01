import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { RanobeDbBook, RanobeDbRelease } from './ranobedb.types';

const IMAGE_BASE_URL = 'https://images.ranobedb.org';
const RANOBEDB_BASE_URL = 'https://ranobedb.org';

export function parseDateInt(value: number | null | undefined): number | undefined {
  if (!value) return undefined;
  const year = Math.floor(value / 10000);
  return year >= 1000 && year <= 2200 ? year : undefined;
}

function selectEnglishRelease(releases: RanobeDbRelease[]): RanobeDbRelease | undefined {
  const english = releases.filter((r) => r.lang === 'en' && r.format !== 'audio');
  return english.find((r) => r.format === 'print') ?? english.find((r) => r.format === 'digital');
}

function resolveTitle(book: RanobeDbBook): string {
  const englishTitle = book.titles.find((t) => t.lang === 'en' && t.official);
  if (englishTitle) return englishTitle.title;
  if (book.romaji) return book.romaji;
  return book.title;
}

function resolveSubtitle(book: RanobeDbBook): string | undefined {
  const mainTitle = resolveTitle(book);
  if (book.title_orig && book.title_orig !== mainTitle) {
    return book.title_orig;
  }
  if (book.romaji_orig && book.romaji_orig !== mainTitle) {
    return book.romaji_orig;
  }
  return undefined;
}

function resolveAuthors(book: RanobeDbBook): string[] {
  const seen = new Set<number>();
  const seenNames = new Set<string>();
  const authors: string[] = [];
  for (const edition of book.editions) {
    for (const staff of edition.staff) {
      if (staff.role_type !== 'author') continue;
      if (seen.has(staff.staff_id)) continue;
      seen.add(staff.staff_id);
      const name = staff.romaji ?? staff.name;
      if (!seenNames.has(name)) {
        seenNames.add(name);
        authors.push(name);
      }
    }
  }
  return authors;
}

function resolvePublisher(book: RanobeDbBook): string | undefined {
  const pub = book.publishers.find((p) => p.lang === 'en' && p.publisher_type === 'publisher');
  if (!pub) return undefined;
  return pub.romaji ?? pub.name;
}

function resolveSeriesIndex(book: RanobeDbBook): number | undefined {
  if (!book.series) return undefined;
  const pos = book.series.books.findIndex((b) => b.id === book.id);
  return pos === -1 ? undefined : pos + 1;
}

function resolveGenres(book: RanobeDbBook): string[] {
  if (!book.series) return [];
  const seen = new Set<string>();
  const genres: string[] = [];
  for (const tag of book.series.tags) {
    if (tag.ttype !== 'genre') continue;
    const trimmed = tag.name.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    genres.push(trimmed);
  }
  return genres;
}

function resolvePublishedYear(book: RanobeDbBook, release: RanobeDbRelease | undefined): number | undefined {
  if (release?.release_date) {
    const year = parseDateInt(release.release_date);
    if (year) return year;
  }
  if (book.olang && book.c_release_dates && book.c_release_dates[book.olang]) {
    const year = parseDateInt(book.c_release_dates[book.olang]);
    if (year) return year;
  }
  return parseDateInt(book.c_release_date);
}

export function mapRanobeDbBook(book: RanobeDbBook): MetadataCandidate | null {
  if (!book?.id) return null;

  const selectedRelease = selectEnglishRelease(book.releases);

  return {
    provider: MetadataProviderKey.RANOBEDB,
    providerId: String(book.id),
    title: resolveTitle(book),
    subtitle: resolveSubtitle(book),
    authors: resolveAuthors(book),
    publisher: resolvePublisher(book),
    publishedYear: resolvePublishedYear(book, selectedRelease),
    language: book.releases.some((r) => r.lang === 'en') ? 'en' : (book.olang ?? book.lang ?? undefined),
    pageCount: selectedRelease?.pages ?? undefined,
    isbn13: selectedRelease?.isbn13 ?? undefined,
    seriesName: book.series?.title,
    seriesIndex: resolveSeriesIndex(book),
    description: book.description?.trim() || book.description_ja?.trim() || undefined,
    genres: resolveGenres(book),
    coverUrl: book.image ? `${IMAGE_BASE_URL}/${book.image.filename}` : undefined,
    sourceUrl: `${RANOBEDB_BASE_URL}/book/${book.id}`,
  };
}
