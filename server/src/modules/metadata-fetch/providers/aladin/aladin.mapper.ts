import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';
import { AladinItem } from './aladin.types';

function parseAuthors(authorString: string): string[] {
  if (!authorString) return [];
  return authorString
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

function parseYear(pubDate: string): number | undefined {
  if (!pubDate) return undefined;
  const match = pubDate.match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : undefined;
}

function parsePageCount(subInfo?: AladinItem['subInfo']): number | undefined {
  if (!subInfo?.itemPage) return undefined;
  return subInfo.itemPage;
}

function parseDescription(description: string, fullDescription?: string): string | undefined {
  const desc = fullDescription ?? description;
  if (!desc) return undefined;
  return desc.replace(/<[^>]*>/g, '').trim();
}

function parseGenres(categoryIdList?: AladinItem['categoryIdList']): string[] | undefined {
  if (!categoryIdList?.length) return undefined;
  return categoryIdList.map((c) => c.categoryName).filter((c) => c.length > 0);
}

function parseSeries(seriesInfo?: AladinItem['seriesInfo']): { name: string; index: number } | undefined {
  if (!seriesInfo?.seriesName) return undefined;
  return {
    name: seriesInfo.seriesName,
    index: 1,
  };
}

export function mapAladinItem(item: AladinItem): MetadataCandidate {
  const authors = parseAuthors(item.author);
  const series = parseSeries(item.seriesInfo);
  const genres = parseGenres(item.categoryIdList);
  const publishedYear = parseYear(item.pubDate);
  const pageCount = parsePageCount(item.subInfo);

  return {
    provider: MetadataProviderKey.ALADIN,
    providerId: item.isbn13 || item.isbn,
    title: item.title,
    subtitle: undefined,
    authors: authors.length > 0 ? authors : undefined,
    description: parseDescription(item.description, item.fullDescription),
    publisher: item.publisher || undefined,
    publishedYear,
    language: 'ko',
    pageCount,
    isbn10: item.isbn || undefined,
    isbn13: item.isbn13 || undefined,
    seriesName: series?.name,
    seriesIndex: series?.index,
    genres,
    coverUrl: item.cover || undefined,
    sourceUrl: item.link || undefined,
  };
}
