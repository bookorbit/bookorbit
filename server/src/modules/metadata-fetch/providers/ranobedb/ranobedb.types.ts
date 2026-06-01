export type RoleType = 'author' | 'artist' | 'translator' | 'editor' | 'narrator' | 'staff';
export type PublisherType = 'publisher' | 'imprint';
export type TagType = 'genre' | 'demographic' | 'content' | 'tag';
export type ReleaseFormat = 'digital' | 'print' | 'audio';

export interface RanobeDbSearchResponse {
  books: { id: number }[];
  count: number;
  currentPage: number;
  totalPages: number;
}

export interface RanobeDbBookResponse {
  book: RanobeDbBook;
}

export interface RanobeDbBook {
  id: number;
  title: string;
  title_orig: string | null;
  romaji: string | null;
  romaji_orig: string | null;
  lang: string | null;
  olang: string | null;
  description: string | null;
  description_ja: string | null;
  c_release_date: number | null;
  c_release_dates: Record<string, number> | null;
  image: RanobeDbImage | null;
  rating: RanobeDbRating | null;
  titles: RanobeDbTitleEntry[];
  editions: RanobeDbEdition[];
  releases: RanobeDbRelease[];
  publishers: RanobeDbPublisher[];
  series: RanobeDbSeries | null;
}

export interface RanobeDbTitleEntry {
  book_id: number;
  lang: string;
  official: boolean;
  title: string;
  romaji: string | null;
}

export interface RanobeDbEdition {
  book_id: number;
  lang: string | null;
  title: string | null;
  eid: number;
  staff: RanobeDbStaff[];
}

export interface RanobeDbStaff {
  role_type: RoleType;
  romaji: string | null;
  name: string;
  staff_id: number;
}

export interface RanobeDbRelease {
  lang: string;
  id: number;
  title: string | null;
  release_date: number | null;
  isbn13: string | null;
  pages: number | null;
  format: ReleaseFormat;
}

export interface RanobeDbPublisher {
  lang: string;
  id: number;
  romaji: string | null;
  name: string;
  publisher_type: PublisherType;
}

export interface RanobeDbSeries {
  id: number;
  title: string;
  romaji: string | null;
  books: RanobeDbSeriesBook[];
  tags: RanobeDbTag[];
}

export interface RanobeDbSeriesBook {
  id: number;
  lang: string | null;
  title: string | null;
  romaji: string | null;
  image: RanobeDbImage | null;
}

export interface RanobeDbTag {
  id: number;
  name: string;
  ttype: TagType;
}

export interface RanobeDbImage {
  id: number;
  filename: string;
  width: number | null;
  height: number | null;
  nsfw: boolean;
  spoiler: boolean;
}

export interface RanobeDbRating {
  score: number;
  count: number;
}
