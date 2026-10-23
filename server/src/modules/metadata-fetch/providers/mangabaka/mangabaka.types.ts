export interface MangabakaEnvelope<T> {
  status: number;
  data: T;
  pagination?: MangabakaPagination;
}

export interface MangabakaSeries {
  id: number;
  state: string;
  merged_with: number | null;
  title: string;
  native_title: string | null;
  romanized_title: string | null;
  secondary_titles: MangabakaSecondaryTitles | null;
  cover: MangabakaCover | null;
  authors: string[];
  artists: string[];
  description: string | null;
  year: number | null;
  published: MangabakaPublished | null;
  status: string;
  is_licensed: boolean;
  has_anime: boolean;
  anime: unknown;
  content_rating: string;
  type: string | null;
  rating: number | null;
  popularity: MangabakaPopularity | null;
  final_volume: string | null;
  total_chapters: string | null;
  links: string[];
  links_v2: MangabakaLink[];
  publishers: MangabakaPublisher[];
  titles: MangabakaTitle[];
  genres_v2: unknown;
  genres: string[];
  tags_v2: MangabakaTag[];
  tags: string[];
  last_updated_at: string;
  relationships: MangabakaRelationship | null;
  relationships_v2: MangabakaRelationshipV2[];
  source: MangabakaSourceRatings | null;
}

export interface MangabakaSecondaryTitles {
  unknown?: MangabakaSecondaryTitle[];
  [lang: string]: MangabakaSecondaryTitle[] | undefined;
}

export interface MangabakaSecondaryTitle {
  type: string | null;
  title: string;
  note: string | null;
}

export interface MangabakaCover {
  raw: MangabakaCoverImage;
  x150: MangabakaCoverVariant | null;
  x250: MangabakaCoverVariant | null;
  x350: MangabakaCoverVariant | null;
}

export interface MangabakaCoverImage {
  url: string;
  size: number;
  height: number;
  width: number;
  blurhash: string;
  thumbhash: string;
  format: string;
}

export interface MangabakaCoverVariant {
  x1: string;
  x2: string;
  x3: string;
}

export interface MangabakaPublished {
  start_date: string | null;
  end_date: string | null;
  start_date_is_estimated: boolean;
  end_date_is_estimated: boolean;
}

export interface MangabakaPopularity {
  global: MangabakaPopularityEntry;
  type: MangabakaPopularityEntry;
}

export interface MangabakaPopularityEntry {
  current: number;
  history: Record<string, number>;
}

export interface MangabakaLink {
  id: string;
  url: string;
  name: string;
  name_display: string;
  type: string;
  language: string | null;
}

export interface MangabakaPublisher {
  name: string;
  type: string;
  note: string;
}

export interface MangabakaTitle {
  language: string;
  traits: string[];
  title: string;
  note: string | null;
  is_primary: boolean;
}

export interface MangabakaTag {
  id: number;
  is_spoiler: boolean;
  is_genre: boolean;
  is_explicit: boolean;
  implied_by_tag_ids: number[];
  parent_id: number | null;
  name: string;
  level: number;
  name_path: string;
  series_count: number;
  description: string | null;
  content_rating: string;
  weight: string;
}

export interface MangabakaRelationship {
  main_story: number[] | null;
  other: number[] | null;
}

export interface MangabakaRelationshipV2 {
  id: string;
  to_series_id: number;
  relation_type: string;
  is_manual: boolean;
  note: string | null;
  chronology: string;
  published_start_date: string | null;
}

export interface MangabakaSourceRatings {
  anilist: MangabakaSourceRating | null;
  anime_planet: MangabakaSourceRating | null;
  anime_news_network: MangabakaSourceRating | null;
  kitsu: MangabakaSourceRating | null;
  manga_updates: MangabakaSourceRating | null;
  my_anime_list: MangabakaSourceRating | null;
  shikimori: MangabakaSourceRating | null;
}

export interface MangabakaSourceRating {
  id: number | string | null;
  rating: number | null;
  rating_normalized: number | null;
}

export interface MangabakaPagination {
  count: number;
  next: string | null;
  previous: string | null;
  page: number;
  limit: number;
}

export interface MangabakaLanguage {
  iso: string;
  language: string;
}

export interface MangabakaCollectionPublisher {
  id: number;
  type: string;
  sub_type: string;
  aliases: unknown;
  parent_id: number | null;
  name: string;
}

export interface MangabakaCollectionEdition {
  id: string;
  name: string;
  language: MangabakaLanguage;
  description: string;
  override_text: string | null;
}

export interface MangabakaCollectionLink {
  type: string;
  link: string;
  language: string;
}

export interface MangabakaCollection {
  id: string;
  series_id: number;
  title: string;
  language: MangabakaLanguage;
  publisher: MangabakaCollectionPublisher;
  edition: MangabakaCollectionEdition;
  type: string;
  format: string;
  medium: string;
  status: string;
  reading: string;
  licensed: boolean;
  description: { desc: string; source: string };
  note: string | null;
  start_date: string | null;
  end_date: string | null;
  links: MangabakaCollectionLink[];
  related_collection_id: string | null;
  count_main: number;
  count_extra: number;
  count_other: number;
  updated_at: string;
}

export interface MangabakaWorkImageVariant {
  x1: string;
  x2: string;
  x3: string;
}

export interface MangabakaWorkImageRaw {
  url: string;
  size: number;
  height: number;
  width: number;
  blurhash: string;
  thumbhash: string;
  format: string;
}

export interface MangabakaWorkImage {
  id: number;
  series_id: number;
  work_id: string;
  index: string;
  index_numeric: number;
  type: string;
  language: string;
  note: string | null;
  content_rating: string;
  created_at: string;
  updated_at: string;
  hashes: Record<string, string>;
  image: {
    raw: MangabakaWorkImageRaw;
    x150: MangabakaWorkImageVariant | null;
    x250: MangabakaWorkImageVariant | null;
    x350: MangabakaWorkImageVariant | null;
  };
}

export interface MangabakaWorkIdentifier {
  id: string;
  name: string;
}

export interface MangabakaWorkDescription {
  desc: string;
  source: string;
}

export interface MangabakaWorkLink {
  type: string;
  link: string;
  language: string;
}

export interface MangabakaWork {
  id: string;
  series_id: number;
  source_ids: { id: string; name: string }[];
  sub_title: string | null;
  count_type: string;
  images: MangabakaWorkImage[];
  release_date: string | null;
  sequence_string: string;
  sequence_numeric: number;
  identifiers: MangabakaWorkIdentifier[];
  trim: unknown;
  description: MangabakaWorkDescription | null;
  note: string | null;
  pages: number | null;
  price: unknown;
  links: MangabakaWorkLink[];
  inc_chapters: unknown;
  part_of_volume: unknown;
  revision: unknown;
  updated_at: string;
  collections: MangabakaCollection[];
}
