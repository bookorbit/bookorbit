import type { SourceExportData } from '../source-adapter.types';

export interface CalibreWebAutomatedConnectorWarning {
  category: string;
  count: number;
}

export interface CalibreWebAutomatedCapabilities {
  settings: boolean;
  authors: boolean;
  publishers: boolean;
  languages: boolean;
  series: boolean;
  ratings: boolean;
  comments: boolean;
  tags: boolean;
  identifiers: boolean;
  userBookStatuses: boolean;
  webProgress: boolean;
  koboProgress: boolean;
  koreaderProgress: boolean;
  shelves: boolean;
}

export interface CalibreWebAutomatedSettingsRecord {
  id: number;
  calibreDirectory: string | null;
  splitLibrary: boolean;
  splitDirectory: string | null;
}

export interface CalibreWebAutomatedUserRecord {
  id: number;
  name: string;
  email: string | null;
  role: number;
}

export interface CalibreWebAutomatedBookRecord {
  id: number;
  title: string;
  pubdate: string | null;
  seriesIndex: number;
  authorSort: string | null;
  path: string;
}

export interface CalibreWebAutomatedFileRecord {
  id: number;
  bookId: number;
  format: string;
  name: string;
}

export interface CalibreWebAutomatedAuthorLinkRecord {
  id: number;
  bookId: number;
  authorId: number;
  name: string;
  sort: string | null;
}

export interface CalibreWebAutomatedNamedLinkRecord {
  id: number;
  bookId: number;
  valueId: number;
  value: string;
}

export interface CalibreWebAutomatedLanguageLinkRecord extends CalibreWebAutomatedNamedLinkRecord {
  itemOrder: number;
}

export interface CalibreWebAutomatedSeriesLinkRecord extends CalibreWebAutomatedNamedLinkRecord {
  sort: string | null;
}

export interface CalibreWebAutomatedRatingLinkRecord {
  id: number;
  bookId: number;
  ratingId: number;
  rating: number;
}

export interface CalibreWebAutomatedCommentRecord {
  id: number;
  bookId: number;
  text: string;
}

export interface CalibreWebAutomatedIdentifierRecord {
  id: number;
  bookId: number;
  type: string;
  value: string;
}

export interface CalibreWebAutomatedStatusRecord {
  id: number;
  bookId: number;
  userId: number;
  readStatus: number;
  lastModified: string | null;
  lastTimeStartedReading: string | null;
}

export interface CalibreWebAutomatedWebProgressRecord {
  id: number;
  userId: number;
  bookId: number;
  format: string;
  bookmarkKey: string;
}

export interface CalibreWebAutomatedKoboReadingStateRecord {
  id: number;
  userId: number;
  bookId: number;
  lastModified: string | null;
  priorityTimestamp: string | null;
}

export interface CalibreWebAutomatedKoboBookmarkRecord {
  id: number;
  readingStateId: number;
  lastModified: string | null;
  locationSource: string | null;
  locationType: string | null;
  locationValue: string | null;
  progressPercent: number | null;
  contentSourceProgressPercent: number | null;
}

export interface CalibreWebAutomatedKoreaderProgressRecord {
  id: number;
  userId: number;
  document: string;
  progress: string;
  percentage: number;
  timestamp: string | null;
}

export interface CalibreWebAutomatedChecksumRecord {
  id: number;
  bookId: number;
  format: string;
  checksum: string;
  version: string;
  created: string | null;
}

export interface CalibreWebAutomatedShelfRecord {
  id: number;
  name: string;
  isPublic: boolean;
  userId: number;
}

export interface CalibreWebAutomatedShelfBookRecord {
  id: number;
  bookId: number;
  shelfId: number;
  position: number | null;
}

export interface CalibreWebAutomatedSourceRecords {
  sourceVersion: null;
  compatibilityWarnings: string[];
  warnings: CalibreWebAutomatedConnectorWarning[];
  capabilities: CalibreWebAutomatedCapabilities;
  settings: CalibreWebAutomatedSettingsRecord[];
  users: CalibreWebAutomatedUserRecord[];
  books: CalibreWebAutomatedBookRecord[];
  files: CalibreWebAutomatedFileRecord[];
  authorLinks: CalibreWebAutomatedAuthorLinkRecord[];
  publisherLinks: CalibreWebAutomatedNamedLinkRecord[];
  languageLinks: CalibreWebAutomatedLanguageLinkRecord[];
  seriesLinks: CalibreWebAutomatedSeriesLinkRecord[];
  ratingLinks: CalibreWebAutomatedRatingLinkRecord[];
  comments: CalibreWebAutomatedCommentRecord[];
  tagLinks: CalibreWebAutomatedNamedLinkRecord[];
  identifiers: CalibreWebAutomatedIdentifierRecord[];
  statuses: CalibreWebAutomatedStatusRecord[];
  webProgress: CalibreWebAutomatedWebProgressRecord[];
  koboReadingStates: CalibreWebAutomatedKoboReadingStateRecord[];
  koboBookmarks: CalibreWebAutomatedKoboBookmarkRecord[];
  koreaderProgress: CalibreWebAutomatedKoreaderProgressRecord[];
  checksums: CalibreWebAutomatedChecksumRecord[];
  shelves: CalibreWebAutomatedShelfRecord[];
  shelfBooks: CalibreWebAutomatedShelfBookRecord[];
}

export interface CalibreWebAutomatedNormalizationResult {
  data: SourceExportData;
  sourceVersion: string | null;
  pathPrefixes: string[];
  warnings: string[];
  counters: Record<string, number>;
}
