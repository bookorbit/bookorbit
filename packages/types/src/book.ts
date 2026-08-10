import type { BookCommunityRating, MetadataFetchDiagnostics, MetadataProviderKey, MetadataSeriesMembership } from "./metadata-fetch";
import type { BookMetadataLockField } from "./metadata-lock";
import type { AudiobookChapter, NarratorRef } from "./audiobook";
import type { ComicMetadataFields } from "./metadata-fetch";
import type { BookFileWriteField, WriteResult } from "./file-write";
import type { CustomMetadataBookValue } from "./custom-metadata";
import type { CoverAspectRatio } from "./library";
import { DEFAULT_FORMAT_PRIORITY } from "./library";

// Derived rather than duplicated: these two lists describe the same set of formats,
// and maintaining them separately let BOOK_FORMATS fall behind on azw and kepub.
export const BOOK_FORMATS = DEFAULT_FORMAT_PRIORITY;
export type BookFormat = (typeof BOOK_FORMATS)[number];

const AUDIO_FORMATS = new Set<string>(["m4b", "mp3", "m4a", "opus", "ogg", "flac"]);
export function isAudioFormat(format: string): boolean {
  return AUDIO_FORMATS.has(format.toLowerCase());
}

const COMIC_FORMATS = new Set<string>(["cbz", "cbr", "cb7", "cbx"]);
export function isComicFormat(format: string): boolean {
  return COMIC_FORMATS.has(format.toLowerCase());
}

export const READ_STATUSES = ["unread", "want_to_read", "reading", "on_hold", "rereading", "read", "skimmed", "abandoned"] as const;
export type ReadStatus = (typeof READ_STATUSES)[number];
export type ReadStatusSource = "auto" | "manual";

export type UserBookStatus = {
  status: ReadStatus;
  source: ReadStatusSource;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export const READING_ATTEMPT_OUTCOMES = ["completed", "skimmed", "abandoned"] as const;
export type ReadingAttemptOutcome = (typeof READING_ATTEMPT_OUTCOMES)[number];

export const READING_ATTEMPT_ORIGINS = ["manual", "bookorbit", "kobo", "koreader", "hardcover", "migration"] as const;
export type ReadingAttemptOrigin = (typeof READING_ATTEMPT_ORIGINS)[number];

export type ReadingAttempt = {
  id: number;
  bookId: number;
  startedOn: string | null;
  endedOn: string | null;
  outcome: ReadingAttemptOutcome | null;
  origin: ReadingAttemptOrigin;
  externalProvider: string | null;
  externalId: string | null;
  totalSessions: number;
  totalSeconds: number;
  createdAt: string;
  updatedAt: string;
};

export type ReadingAttemptListResponse = {
  items: ReadingAttempt[];
  page: number;
  pageSize: number;
  total: number;
};

export type ReadingAttemptPatch = {
  startedOn?: string | null;
  endedOn?: string | null;
  outcome?: ReadingAttemptOutcome | null;
};

export type ResetBookReadingStateResponse = {
  readStatus: UserBookStatus;
};

export type BookFileRef = {
  id: number;
  format: string | null;
  role: string;
  sizeBytes: number | null;
};

export type BookMediaKind = "ebook" | "audiobook" | "comic" | "unknown";

export type BookMediaProfile = {
  primaryMediaKind: BookMediaKind;
  hasEbook: boolean;
  hasAudio: boolean;
  hasComic: boolean;
};

type BookMediaFile = Pick<BookFileRef, "format" | "role">;

export function getPrimaryBookFile<T extends BookMediaFile>(files: readonly T[]): T | null {
  return files.find((file) => file.role === "primary") ?? files.find((file) => file.format != null) ?? files[0] ?? null;
}

export function getBookMediaKind(format: string | null | undefined): BookMediaKind {
  const normalized = format?.trim().toLowerCase();
  if (!normalized) return "unknown";
  if (isAudioFormat(normalized)) return "audiobook";
  if (isComicFormat(normalized)) return "comic";
  return "ebook";
}

export function getBookMediaProfile(files: readonly BookMediaFile[]): BookMediaProfile {
  const mediaKinds = files.map((file) => getBookMediaKind(file.format));
  return {
    primaryMediaKind: getBookMediaKind(getPrimaryBookFile(files)?.format),
    hasEbook: mediaKinds.includes("ebook"),
    hasAudio: mediaKinds.includes("audiobook"),
    hasComic: mediaKinds.includes("comic"),
  };
}

export type BookSeriesMembership = {
  seriesId: number;
  seriesName: string;
  seriesIndex: number | null;
  displayOrder: number;
  /** Series-level, shared by every book in the series and by every user. */
  expectedBookCount: number | null;
};

export type BookCard = {
  id: number;
  status: string;
  coverAspectRatio: CoverAspectRatio;
  title: string | null;
  authors: string[];
  seriesId?: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  seriesMemberships?: BookSeriesMembership[];
  files: BookFileRef[];
  publishedDate: string | null;
  publishedYear: number | null;
  language: string | null;
  genres: string[];
  rating: number | null;
  readingProgress: number | null;
  readStatus: UserBookStatus | null;
  addedAt: string;
  updatedAt: string | null;
  metadataScore: number | null;
  hasCover: boolean;
  hasMetadataLocks: boolean;
  lockedFields: BookMetadataLockField[];
  subtitle: string | null;
  publisher: string | null;
  pageCount: number | null;
  isbn13: string | null;
  hardcoverId?: string | null;
  hardcoverEditionId?: string | null;
  narrators: string[];
  tags: string[];
  customMetadata: CustomMetadataBookValue[];
  collapsedSeries?: import("./series-collapse").CollapsedSeriesInfo;
};

export type BookDetailFile = {
  id: number;
  format: string | null;
  role: string;
  sizeBytes: number | null;
  absolutePath: string;
  createdAt: string;
  filename: string | null;
  durationSeconds: number | null;
};

export type ProviderIds = Partial<Record<MetadataProviderKey, string | null>>;

export type AudioMetadata = {
  narrators: NarratorRef[];
  durationSeconds: number | null;
  abridged: boolean;
  chapters: AudiobookChapter[] | null;
};

export type BookFileWriteDisabledReason =
  "library_disabled" | "no_primary_file" | "format_not_supported" | "format_disabled" | "file_exceeds_size_limit";

export type BookFileWriteStatus = {
  enabled: boolean;
  reason: BookFileWriteDisabledReason | null;
  writableFormats: BookFormat[];
  writableFields: BookFileWriteField[];
};

export type BookDetail = {
  id: number;
  libraryId: number;
  libraryName: string;
  status: string;
  folderPath: string;
  addedAt: string;
  updatedAt: string | null;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedDate: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  seriesId?: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  seriesMemberships?: BookSeriesMembership[];
  rating: number | null;
  personalNote: string | null;
  personalNoteUpdatedAt: string | null;
  communityRatings: BookCommunityRating[];
  coverSource: "extracted" | "custom" | null;
  hardcoverEditionId: string | null;
  providerIds: ProviderIds;
  authors: { id: number; name: string; sortName: string | null }[];
  genres: string[];
  tags: string[];
  files: BookDetailFile[];
  lastWrittenAt: string | null;
  metadataScore: number | null;
  readStatus: UserBookStatus | null;
  audioMetadata: AudioMetadata | null;
  formatPriority: string[];
  comicMetadata: ComicMetadataFields | null;
  customMetadata: CustomMetadataBookValue[];
  lockedFields: BookMetadataLockField[];
  collections: { id: number; name: string }[];
  fileWriteStatus?: BookFileWriteStatus;
};

export type BookMetadataSaveResult = {
  book: BookDetail;
  write: WriteResult | null;
  libraryAutoWriteEnabled: boolean;
};

export type BookMetadataRefreshPreviewFields = {
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  authors?: string[];
  genres?: string[];
  publisher?: string | null;
  publishedDate?: string | null;
  publishedYear?: number | null;
  language?: string | null;
  pageCount?: number | null;
  seriesName?: string | null;
  seriesIndex?: number | null;
  seriesMemberships?: MetadataSeriesMembership[] | null;
  communityRatings?: BookCommunityRating[];
  coverUrl?: string;
  googleBooksId?: string | null;
  goodreadsId?: string | null;
  amazonId?: string | null;
  hardcoverId?: string | null;
  hardcoverEditionId?: string | null;
  openLibraryId?: string | null;
  itunesId?: string | null;
  audibleId?: string | null;
  librofmId?: string | null;
  koboId?: string | null;
  comicvineId?: string | null;
  ranobedbId?: string | null;
  lubimyczytacId?: string | null;
  aladinId?: string | null;
  audioMetadata?: {
    narrators?: string[];
    durationSeconds?: number | null;
    abridged?: boolean | null;
    chapters?: AudiobookChapter[];
  };
  comicMetadata?: ComicMetadataFields;
};

export type BookMetadataRefreshPreviewResponse = {
  metadata: BookMetadataRefreshPreviewFields;
  diagnostics: MetadataFetchDiagnostics;
};

export type BookKoboReadingState = {
  status: string | null;
  progressPercent: number | null;
  createdAtKobo: string | null;
  lastModifiedKobo: string | null;
  priorityTimestamp: string | null;
  updatedAt: string;
};

export type BookKoboSnapshotState = {
  deviceId: number;
  deviceName: string;
  snapshotId: number;
  snapshotUpdatedAt: string;
  inSnapshot: boolean;
  synced: boolean | null;
  pendingDelete: boolean | null;
  isNew: boolean | null;
  removedByDevice: boolean | null;
  fileHash: string | null;
  metadataHash: string | null;
};

export type BookKoboState = {
  eligibleForKoboSync: boolean;
  syncCollections: string[];
  readingState: BookKoboReadingState | null;
  snapshots: BookKoboSnapshotState[];
};

export type BooksPage = {
  items: BookCard[];
  total: number;
  page: number;
  size: number;
};

export type BookRecommendation = {
  id: number;
  title: string | null;
  coverAspectRatio: CoverAspectRatio;
  updatedAt: string | null;
  hasCover: boolean;
  authors: string[];
  isAudiobook?: boolean;
  isComic?: boolean;
};

export type SeriesBookRecommendation = {
  id: number;
  title: string | null;
  coverAspectRatio: CoverAspectRatio;
  updatedAt: string | null;
  seriesIndex: number | null;
  hasCover: boolean;
  authors: string[];
  isAudiobook?: boolean;
  isComic?: boolean;
};

export type CoverSearchResult = {
  url: number | string; // ID for proxy or direct URL
  previewUrl: string;
  sourceUrl: string;
  width: number;
  height: number;
  source: string;
};

export type CoverSearchResponse = {
  results: CoverSearchResult[];
  total: number;
};
