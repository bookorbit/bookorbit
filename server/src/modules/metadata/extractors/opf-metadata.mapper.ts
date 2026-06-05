import type { ParsedOpf } from '../lib/opf-parser';
import type { ParsedBookData } from './format-extractor.interface';

export function hasOpfMetadata(metadata: ParsedOpf): boolean {
  return (
    metadata.title !== null ||
    metadata.subtitle !== null ||
    metadata.description !== null ||
    metadata.isbn10 !== null ||
    metadata.isbn13 !== null ||
    metadata.publisher !== null ||
    metadata.publishedYear !== null ||
    metadata.language !== null ||
    metadata.pageCount !== null ||
    metadata.rating !== null ||
    metadata.seriesName !== null ||
    metadata.seriesIndex !== null ||
    metadata.authors.length > 0 ||
    metadata.genres.length > 0 ||
    metadata.tags.length > 0 ||
    metadata.googleBooksId !== null ||
    metadata.goodreadsId !== null ||
    metadata.amazonId !== null ||
    metadata.hardcoverId !== null ||
    metadata.openLibraryId !== null ||
    metadata.ranobedbId !== null ||
    metadata.itunesId !== null
  );
}

export function mapOpfMetadata(metadata: ParsedOpf, cover: Buffer | null): ParsedBookData {
  return {
    title: metadata.title,
    subtitle: metadata.subtitle,
    description: metadata.description,
    isbn10: metadata.isbn10,
    isbn13: metadata.isbn13,
    publisher: metadata.publisher,
    publishedYear: metadata.publishedYear,
    language: metadata.language,
    seriesName: metadata.seriesName,
    seriesIndex: metadata.seriesIndex,
    authors: metadata.authors,
    genres: metadata.genres,
    tags: metadata.tags,
    rating: metadata.rating,
    pageCount: metadata.pageCount,
    googleBooksId: metadata.googleBooksId,
    goodreadsId: metadata.goodreadsId,
    amazonId: metadata.amazonId,
    hardcoverId: metadata.hardcoverId,
    openLibraryId: metadata.openLibraryId,
    ranobedbId: metadata.ranobedbId,
    itunesId: metadata.itunesId,
    cover,
  };
}
