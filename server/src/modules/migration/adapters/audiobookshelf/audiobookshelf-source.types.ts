import type { SourceExportData } from '../source-adapter.types';

export type AudiobookshelfTimestamp = string | number | Date | null;

export interface AudiobookshelfUserRecord {
  id: string;
  username: string;
  email?: string | null;
  isActive?: boolean | null;
}

export interface AudiobookshelfAuthorRecord {
  id?: string | null;
  name: string;
  sortName?: string | null;
  description?: string | null;
}

export interface AudiobookshelfSeriesRecord {
  id?: string | null;
  name: string;
  sequence?: string | number | null;
}

export interface AudiobookshelfFileMetadataRecord {
  path?: string | null;
  relPath?: string | null;
  filename?: string | null;
  ext?: string | null;
}

export interface AudiobookshelfAudioFileRecord {
  ino?: string | number | null;
  index?: number | null;
  format?: string | null;
  duration?: number | null;
  exclude?: boolean | null;
  invalid?: boolean | null;
  metadata: AudiobookshelfFileMetadataRecord;
}

export interface AudiobookshelfEbookFileRecord {
  ino?: string | number | null;
  ebookFormat?: string | null;
  metadata: AudiobookshelfFileMetadataRecord;
}

export interface AudiobookshelfBookRecord {
  id: string;
  title?: string | null;
  subtitle?: string | null;
  authorName?: string | null;
  authors?: AudiobookshelfAuthorRecord[];
  narrators?: string[] | null;
  isbn?: string | null;
  asin?: string | null;
  description?: string | null;
  publisher?: string | null;
  publishedYear?: string | number | null;
  language?: string | null;
  duration?: number | null;
  abridged?: boolean | null;
  genres?: string[] | null;
  tags?: string[] | null;
  series?: AudiobookshelfSeriesRecord[];
  audioFiles?: AudiobookshelfAudioFileRecord[] | null;
  ebookFile?: AudiobookshelfEbookFileRecord | null;
}

export interface AudiobookshelfBookLibraryItemRecord {
  id: string;
  mediaType: 'book';
  path?: string | null;
  relPath?: string | null;
  book: AudiobookshelfBookRecord;
}

export interface AudiobookshelfPodcastLibraryItemRecord {
  id: string;
  mediaType: 'podcast';
  path?: string | null;
  relPath?: string | null;
  mediaId?: string | null;
}

export type AudiobookshelfLibraryItemRecord = AudiobookshelfBookLibraryItemRecord | AudiobookshelfPodcastLibraryItemRecord;

export interface AudiobookshelfMediaProgressRecord {
  id?: string | null;
  userId: string;
  mediaItemId: string;
  mediaItemType: 'book' | 'podcastEpisode' | string;
  libraryItemId?: string | null;
  duration?: number | null;
  progress?: number | null;
  currentTime?: number | null;
  ebookProgress?: number | null;
  ebookLocation?: string | null;
  isFinished?: boolean | null;
  startedAt?: AudiobookshelfTimestamp;
  lastUpdate?: AudiobookshelfTimestamp;
  createdAt?: AudiobookshelfTimestamp;
  updatedAt?: AudiobookshelfTimestamp;
  finishedAt?: AudiobookshelfTimestamp;
}

export interface AudiobookshelfBookmarkRecord {
  userId: string;
  libraryItemId: string;
  time: number;
  title?: string | null;
  createdAt?: AudiobookshelfTimestamp;
}

export interface AudiobookshelfPlaybackSessionRecord {
  id: string;
  userId: string;
  mediaItemId: string;
  mediaItemType: 'book' | 'podcastEpisode' | string;
  duration: number;
  startTime: number;
  currentTime: number;
  timeListening: number;
  startedAt?: AudiobookshelfTimestamp;
  createdAt?: AudiobookshelfTimestamp;
  updatedAt?: AudiobookshelfTimestamp;
}

export interface AudiobookshelfLibraryFolderRecord {
  id?: string | null;
  libraryId?: string | null;
  path: string;
}

export interface AudiobookshelfSourceRecords {
  sourceVersion: string | null;
  users: AudiobookshelfUserRecord[];
  libraryItems: AudiobookshelfLibraryItemRecord[];
  mediaProgress: AudiobookshelfMediaProgressRecord[];
  bookmarks: AudiobookshelfBookmarkRecord[];
  playbackSessions: AudiobookshelfPlaybackSessionRecord[] | null;
  libraryFolders?: AudiobookshelfLibraryFolderRecord[] | null;
  authorsAvailable?: boolean;
  warnings?: string[];
}

export interface AudiobookshelfNormalizationCounters {
  invalidUsersSkipped: number;
  disabledUsersIncluded: number;
  podcastItemsSkipped: number;
  invalidBooksSkipped: number;
  podcastProgressSkipped: number;
  orphanedProgressSkipped: number;
  unresolvedAudioProgressSkipped: number;
  unsupportedEbookProgressSkipped: number;
  podcastBookmarksSkipped: number;
  orphanedBookmarksSkipped: number;
  invalidBookmarksSkipped: number;
  podcastSessionsSkipped: number;
  orphanedSessionsSkipped: number;
  invalidSessionsSkipped: number;
}

export interface AudiobookshelfNormalizationResult {
  data: SourceExportData;
  sourceVersion: string | null;
  pathPrefixes: string[];
  warnings: string[];
  counters: AudiobookshelfNormalizationCounters;
}
