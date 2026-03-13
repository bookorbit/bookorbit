export type MetadataScoreField =
  | 'title'
  | 'subtitle'
  | 'description'
  | 'coverSource'
  | 'genres'
  | 'isbn13'
  | 'publisher'
  | 'publishedYear'
  | 'language'
  | 'isbn10'
  | 'pageCount'
  | 'rating'
  | 'seriesName'
  | 'seriesIndex'
  | 'tags'
  | 'authors'
  | 'googleBooksId'
  | 'goodreadsId'
  | 'amazonId'
  | 'hardcoverId'
  | 'openLibraryId'
  | 'itunesId';

export type MetadataScoreGroup = 'core' | 'publishing' | 'classification' | 'enrichment' | 'providers';

export interface MetadataScoreFieldMeta {
  group: MetadataScoreGroup;
  label: string;
  defaultWeight: number;
}

export const METADATA_SCORE_FIELDS: Record<MetadataScoreField, MetadataScoreFieldMeta> = {
  title:         { group: 'core',           label: 'Title',           defaultWeight: 10 },
  authors:       { group: 'core',           label: 'Authors',         defaultWeight: 10 },
  coverSource:   { group: 'core',           label: 'Cover',           defaultWeight: 8  },
  description:   { group: 'core',           label: 'Description',     defaultWeight: 8  },
  genres:        { group: 'core',           label: 'Genres',          defaultWeight: 6  },
  subtitle:      { group: 'core',           label: 'Subtitle',        defaultWeight: 2  },
  isbn13:        { group: 'classification', label: 'ISBN-13',         defaultWeight: 5  },
  publisher:     { group: 'publishing',     label: 'Publisher',       defaultWeight: 4  },
  publishedYear: { group: 'publishing',     label: 'Published Year',  defaultWeight: 4  },
  language:      { group: 'publishing',     label: 'Language',        defaultWeight: 4  },
  isbn10:        { group: 'classification', label: 'ISBN-10',         defaultWeight: 3  },
  pageCount:     { group: 'publishing',     label: 'Page Count',      defaultWeight: 3  },
  rating:        { group: 'enrichment',     label: 'Rating',          defaultWeight: 3  },
  seriesName:    { group: 'classification', label: 'Series',          defaultWeight: 3  },
  seriesIndex:   { group: 'classification', label: 'Series Index',    defaultWeight: 2  },
  tags:          { group: 'enrichment',     label: 'Tags',            defaultWeight: 2  },
  googleBooksId: { group: 'providers',      label: 'Google Books ID', defaultWeight: 2  },
  goodreadsId:   { group: 'providers',      label: 'Goodreads ID',    defaultWeight: 2  },
  amazonId:      { group: 'providers',      label: 'Amazon ID',       defaultWeight: 1  },
  hardcoverId:   { group: 'providers',      label: 'Hardcover ID',    defaultWeight: 1  },
  openLibraryId: { group: 'providers',      label: 'Open Library ID', defaultWeight: 1  },
  itunesId:      { group: 'providers',      label: 'iTunes ID',       defaultWeight: 1  },
};

export const METADATA_SCORE_GROUP_LABELS: Record<MetadataScoreGroup, string> = {
  core:           'Core',
  publishing:     'Publishing',
  classification: 'Classification',
  enrichment:     'Enrichment',
  providers:      'Provider IDs',
};

export type MetadataScoreWeights = Record<MetadataScoreField, number>;

export const DEFAULT_METADATA_SCORE_WEIGHTS: MetadataScoreWeights = Object.fromEntries(
  Object.entries(METADATA_SCORE_FIELDS).map(([field, meta]) => [field, meta.defaultWeight]),
) as MetadataScoreWeights;
