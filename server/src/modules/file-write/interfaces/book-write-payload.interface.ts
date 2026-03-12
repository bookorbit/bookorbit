export interface BookWritePayload {
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  language?: string | null;
  pageCount?: number | null;
  seriesName?: string | null;
  seriesIndex?: number | null;
  isbn10?: string | null;
  isbn13?: string | null;
  rating?: number | null;
  authors?: { name: string; sortName: string | null }[];
  genres?: string[];
  tags?: string[];
  googleBooksId?: string | null;
  goodreadsId?: string | null;
  amazonId?: string | null;
  hardcoverId?: string | null;
  openLibraryId?: string | null;
  itunesId?: string | null;
  coverBytes?: Buffer | null;
}

export type BookWritePayloadKey = keyof BookWritePayload;
