import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';
import { parsePublishedDateKey, parsePublishedYear, publishedYearFromDateKey } from '../../../../common/utils/published-date.utils';
import { htmlToPlainText } from '../../../../common/utils/html-to-text.utils';
import { AladinItem } from './aladin.types';

function parseAuthors(authorString: string): string[] {
  if (!authorString) return [];
  return authorString
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

function parseYear(pubDate: string): number | undefined {
  return parsePublishedYear(pubDate);
}

function parsePageCount(subInfo?: AladinItem['subInfo']): number | undefined {
  if (!subInfo?.itemPage) return undefined;
  return subInfo.itemPage;
}

function parseDescription(description: string, fullDescription?: string): string | undefined {
  const desc = fullDescription ?? description;
  if (!desc) return undefined;
  return htmlToPlainText(desc) || undefined;
}

function parseGenres(categoryIdList?: AladinItem['categoryIdList']): string[] | undefined {
  if (!categoryIdList?.length) return undefined;
  return categoryIdList.map((c) => c.categoryName).filter((c) => c.length > 0);
}

function parseSeriesName(seriesInfo?: AladinItem['seriesInfo']): string | undefined {
  return seriesInfo?.seriesName || undefined;
}

function parseItemId(link: string): string | undefined {
  const match = link.match(/ItemId=(\d+)/i);
  return match ? match[1] : undefined;
}

export function mapAladinItem(item: AladinItem): MetadataCandidate {
  const authors = parseAuthors(item.author);
  const genres = parseGenres(item.categoryIdList);
  const publishedDate = parsePublishedDateKey(item.pubDate);
  const publishedYear = publishedDate ? publishedYearFromDateKey(publishedDate) : parseYear(item.pubDate);
  const pageCount = parsePageCount(item.subInfo);
  const itemId = parseItemId(item.link);

  return {
    provider: MetadataProviderKey.ALADIN,
    providerId: itemId ?? '',
    title: item.title,
    subtitle: undefined,
    authors: authors.length > 0 ? authors : undefined,
    description: parseDescription(item.description, item.fullDescription),
    publisher: item.publisher || undefined,
    publishedDate,
    publishedYear,
    language: 'ko',
    pageCount,
    isbn10: item.isbn || undefined,
    isbn13: item.isbn13 || undefined,
    seriesName: parseSeriesName(item.seriesInfo),
    genres,
    coverUrl: item.cover || undefined,
    sourceUrl: item.link || undefined,
  };
}
