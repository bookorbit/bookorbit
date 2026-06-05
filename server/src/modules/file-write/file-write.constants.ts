import { BOOK_FILE_WRITE_FIELDS } from '@bookorbit/types';
import type { BookWritePayloadKey } from './interfaces/book-write-payload.interface';

export const FORMAT_EPUB = 'epub';
export const FORMAT_PDF = 'pdf';
export const FORMAT_CBZ = 'cbz';
export const FORMAT_CB7 = 'cb7';
export const FORMAT_M4B = 'm4b';
export const FORMAT_M4A = 'm4a';
export const FORMAT_MP3 = 'mp3';
export const FORMAT_FLAC = 'flac';

export const CBX_FORMATS = [FORMAT_CBZ, FORMAT_CB7] as const;
export const AUDIO_WRITE_FORMATS = [FORMAT_M4B, FORMAT_M4A, FORMAT_MP3, FORMAT_FLAC] as const;

export const BOOK_WRITE_FIELD_KEYS = BOOK_FILE_WRITE_FIELDS satisfies readonly BookWritePayloadKey[];

export function createBookWriteFieldMask(): Set<BookWritePayloadKey> {
  return new Set(BOOK_WRITE_FIELD_KEYS);
}

export const COMIC_INFO_PROVIDER_ID_KEYS = [
  'goodreadsId',
  'amazonId',
  'hardcoverId',
  'googleBooksId',
  'openLibraryId',
] as const satisfies readonly BookWritePayloadKey[];

export const COMIC_INFO_MANAGED_NOTES_KEYS = [
  'subtitle',
  'isbn10',
  'goodreadsId',
  'amazonId',
  'hardcoverId',
  'googleBooksId',
  'openLibraryId',
  'ranobedbId',
] as const satisfies readonly BookWritePayloadKey[];

type ComicInfoProviderKey = (typeof COMIC_INFO_PROVIDER_ID_KEYS)[number];

export const COMIC_INFO_PROVIDER_WEB_URL_BUILDERS: Record<ComicInfoProviderKey, (id: string) => string> = {
  goodreadsId: (id: string) => `https://www.goodreads.com/book/show/${id}`,
  amazonId: (id: string) => `https://www.amazon.com/dp/${id}`,
  hardcoverId: (id: string) => `https://hardcover.app/books/${id}`,
  googleBooksId: (id: string) => `https://books.google.com/books?id=${id}`,
  openLibraryId: (id: string) => `https://openlibrary.org/works/${id}`,
};

export const EPUB_PROVIDER_IDENTIFIER_SCHEMES = {
  goodreadsId: 'GOODREADS',
  amazonId: 'AMAZON',
  hardcoverId: 'HARDCOVER',
  googleBooksId: 'GOOGLE',
  openLibraryId: 'OPENLIBRARY',
  ranobedbId: 'RANOBEDB',
  itunesId: 'ITUNES',
} as const satisfies Partial<Record<BookWritePayloadKey, string>>;
