export interface HardcoverSearchResponse {
  data?: {
    search?: {
      results?: HardcoverSearchResults;
    };
  };
}

export interface HardcoverSearchResults {
  hits?: HardcoverSearchHit[];
  found?: number;
}

export interface HardcoverSearchHit {
  document?: HardcoverSearchDocument;
}

export interface HardcoverSearchDocument {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  description?: string;
  author_names?: string[];
  isbns?: string[];
  pages?: number;
  release_date?: string;
  release_year?: number;
  genres?: string[];
  rating?: number;
  ratings_count?: number;
  featured_series?: {
    series?: {
      name?: string;
    };
    position?: number | null;
  };
  image?: HardcoverImage;
}

export interface HardcoverBooksResponse {
  data?: {
    books?: HardcoverBookWithEditions[];
  };
}

export interface HardcoverBookWithEditions {
  id: number;
  slug: string;
  title: string;
  subtitle?: string;
  description?: string;
  cached_contributors?: HardcoverCachedContributor[];
  featured_book_series?: {
    series?: {
      name?: string;
      books_count?: number;
    };
    position?: number | null;
  };
  rating?: number;
  ratings_count?: number;
  pages?: number;
  release_date?: string;
  release_year?: number;
  image?: HardcoverImage;
  editions?: HardcoverEdition[];
}

export interface HardcoverEdition {
  id: number;
  title?: string;
  subtitle?: string;
  cached_contributors?: HardcoverCachedContributor[];
  pages?: number;
  release_date?: string;
  release_year?: number;
  image?: HardcoverImage;
  publisher?: { name: string };
  isbn_10?: string;
  isbn_13?: string;
  language?: { code2: string };
  reading_format_id?: number;
  audio_seconds?: number;
}

export interface HardcoverCachedContributor {
  author?: {
    id?: number;
    name?: string;
  };
  contribution?: string | null;
}

export interface HardcoverImage {
  url?: string;
}
