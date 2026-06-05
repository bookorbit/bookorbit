import type { BookFileWriteField } from '@bookorbit/types';

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
  ranobedbId?: string | null;
  comicIssueNumber?: string | null;
  comicVolumeName?: string | null;
  comicPencillers?: string[];
  comicInkers?: string[];
  comicColorists?: string[];
  comicLetterers?: string[];
  comicCoverArtists?: string[];
  comicCharacters?: string[];
  comicTeams?: string[];
  comicLocations?: string[];
  comicStoryArcs?: string[];
  itunesId?: string | null;
  audibleId?: string | null;
  narrators?: string[];
  coverBytes?: Buffer | null;
}

export type BookWritePayloadKey = BookFileWriteField;

type AssertNoFieldDrift<T extends never> = T;
export type BookWritePayloadMissingFieldCheck = AssertNoFieldDrift<Exclude<BookWritePayloadKey, keyof BookWritePayload>>;
export type BookWritePayloadExtraFieldCheck = AssertNoFieldDrift<Exclude<keyof BookWritePayload, BookWritePayloadKey>>;
