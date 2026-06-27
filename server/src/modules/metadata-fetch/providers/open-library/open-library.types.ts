export interface OpenLibrarySearchResponse {
  docs: OpenLibraryDoc[];
  numFound: number;
}

export interface OpenLibraryDoc {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  cover_i?: number;
  publisher?: string[];
  language?: string[];
  number_of_pages_median?: number;
  subject?: string[];
  ratings_average?: number;
  ratings_count?: number;
  series?: string[];
}

export interface OpenLibraryWork {
  key: string;
  title: string;
  description?: string | OpenLibraryTextValue;
  subjects?: string[];
  covers?: number[];
  first_publish_date?: string;
}

export interface OpenLibraryTextValue {
  type: string;
  value: string;
}
