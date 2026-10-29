import type { BookFileWriteDisabledReason } from "./book";

export interface AudiobookChapter {
  title: string;
  startMs: number;
}

/**
 * Where a book's chapter list came from. `tracks` is the one-chapter-per-file list the server
 * derives when nothing is stored; it is reported but never persisted.
 */
export const AUDIOBOOK_CHAPTER_SOURCES = ["embedded", "tracks", "provider", "migration", "manual"] as const;
export type AudiobookChapterSource = (typeof AUDIOBOOK_CHAPTER_SOURCES)[number];

export const AUDIOBOOK_CHAPTER_LIMITS = { maxChapters: 2000, maxTitleLength: 500 } as const;

/** A book's audio file as the chapter editor lays it out on the book timeline. */
export interface BookChapterTrack {
  fileId: number;
  name: string;
  /** Null once an earlier track's length is unknown. */
  startMs: number | null;
  durationMs: number | null;
}

export interface BookChapterEditor {
  id: number;
  name: string;
}

/** Audible storefronts a chapter lookup can ask, by the region code Audible and Audnexus share. */
export const AUDIBLE_REGIONS = ["us", "uk", "ca", "au", "de", "fr", "it", "es", "jp", "in"] as const;
export type AudibleRegion = (typeof AUDIBLE_REGIONS)[number];

export interface BookChapterSources {
  /** An EPUB of this book whose table of contents can name the chapters. */
  ebookFileId: number | null;
  /** A read-along EPUB, whose narration timings can place them. */
  readAlongFileId: number | null;
}

/** Formats whose chapters can be written into the file. FLAC is left out: ffmpeg cannot store them there. */
export const CHAPTER_WRITE_FORMATS = ["m4b", "m4a", "mp3"] as const;

/** Whether the chapters can be written into this book's audio files, and if not, why. */
export interface BookChapterWriteBack {
  available: boolean;
  reason: BookFileWriteDisabledReason | null;
  /** Audio files a write would touch. */
  fileCount: number;
}

export interface BookChaptersState {
  chapters: AudiobookChapter[];
  source: AudiobookChapterSource | null;
  /** True when nothing is stored and the list is one chapter per track. */
  derived: boolean;
  locked: boolean;
  /** Opaque; send it back as `baseRevision` so a save cannot overwrite a newer one. */
  revision: string;
  updatedAt: string | null;
  updatedBy: BookChapterEditor | null;
  totalDurationMs: number | null;
  tracks: BookChapterTrack[];
  audibleId: string | null;
  versionCount: number;
  /** The storefront the Audible metadata provider is set to, used as the lookup default. */
  audibleRegion: AudibleRegion;
  sources: BookChapterSources;
  writeBack: BookChapterWriteBack;
}

export interface SaveBookChaptersRequest {
  chapters: AudiobookChapter[];
  baseRevision: string;
  /** Protect the saved list from rescans and metadata refreshes. Defaults to true. */
  lock?: boolean;
}

export interface RevertBookChaptersRequest {
  baseRevision: string;
}

export interface EmbeddedBookChapters {
  chapters: AudiobookChapter[];
}

/** One chapter from a lookup. Audible nests chapters under parts; a part with its own audio starts before its first child. */
export interface ChapterLookupNode {
  title: string;
  startMs: number;
  lengthMs: number | null;
  children: ChapterLookupNode[];
}

export interface ChapterLookupResult {
  /** True when provider bounds prevented a complete chapter list. */
  truncated?: boolean;
  provider: "audible" | "audnexus";
  asin: string;
  region: AudibleRegion;
  chapters: ChapterLookupNode[];
  runtimeMs: number | null;
  /** The "This is Audible" lead-in and sign-off in Audible's own timings, which many files no longer carry. */
  brandIntroMs: number;
  brandOutroMs: number;
  /** Audible's flag for timings it considers exact. Null when the source does not say. */
  isAccurate: boolean | null;
}

export const EBOOK_CHAPTER_SOURCES = ["toc", "read_along"] as const;
export type EbookChapterSource = (typeof EBOOK_CHAPTER_SOURCES)[number];

export interface EbookBookChapters {
  source: EbookChapterSource;
  fileId: number;
  chapters: AudiobookChapter[];
  /** True for a table of contents: titles in reading order, with no times. */
  titlesOnly: boolean;
  /** Length of the read-along narration, for comparing against the audiobook's own runtime. */
  runtimeMs: number | null;
}

/** Bounds on one pause analysis; the editor splits larger jobs into several requests. */
export const CHAPTER_PAUSE_LIMITS = {
  maxPoints: 300,
  minWindowMs: 1_000,
  maxWindowMs: 60_000,
  /** Audio decoded by one request, summed over its windows. */
  maxAudioMs: 60 * 60_000,
} as const;

export interface AnalyzeBookChaptersRequest {
  /** Times on the book's timeline to listen around. */
  points: number[];
  /** Width of the window centred on each point. Defaults to 10 seconds. */
  windowMs?: number;
}

/** A stretch of near-silence on the book's timeline. */
export interface ChapterPause {
  startMs: number;
  endMs: number;
}

export interface ChapterPauseWindow {
  pointMs: number;
  /** The window actually listened to, clipped to the book. */
  fromMs: number;
  toMs: number;
  pauses: ChapterPause[];
  /** True when the audio in this window could not be decoded. */
  failed: boolean;
}

export interface AnalyzeBookChaptersResult {
  windows: ChapterPauseWindow[];
}

/** Bounds on a waveform request around one chapter boundary. */
export const CHAPTER_WAVEFORM_LIMITS = {
  minWindowMs: 1_000,
  maxWindowMs: 60_000,
  minBuckets: 20,
  maxBuckets: 600,
} as const;

/** How loud the book is around a point, for placing a chapter boundary by eye. */
export interface ChapterWaveform {
  /** The window drawn, clipped to the book. */
  fromMs: number;
  toMs: number;
  /** Peak level of each equal slice of the window, from 0 to 1. */
  peaks: number[];
  failed: boolean;
}

export interface WriteBookChaptersRequest {
  /** The saved list being written, so a newer save is never overwritten by an older one. */
  baseRevision: string;
}

export interface WriteBookChaptersResult {
  status: "success" | "failed";
  filesWritten: number;
  filesTotal: number;
}

export interface BookChapterVersionSummary {
  id: number;
  source: AudiobookChapterSource;
  chapterCount: number;
  createdAt: string;
  createdBy: BookChapterEditor | null;
}

export interface BookChapterVersion extends BookChapterVersionSummary {
  chapters: AudiobookChapter[];
}

export const BOOK_CHAPTERS_ERROR_CODES = {
  stale: "CHAPTERS_STALE",
  emptyTitle: "CHAPTERS_EMPTY_TITLE",
  firstNotZero: "CHAPTERS_FIRST_NOT_ZERO",
  notAscending: "CHAPTERS_NOT_ASCENDING",
  pastEnd: "CHAPTERS_PAST_END",
  filesUnreadable: "CHAPTERS_FILES_UNREADABLE",
  lookupNotFound: "CHAPTERS_LOOKUP_NOT_FOUND",
  lookupUnavailable: "CHAPTERS_LOOKUP_UNAVAILABLE",
  ebookUnavailable: "CHAPTERS_EBOOK_UNAVAILABLE",
  analysisTooLarge: "CHAPTERS_ANALYSIS_TOO_LARGE",
  analysisUnavailable: "CHAPTERS_ANALYSIS_UNAVAILABLE",
  writeUnavailable: "CHAPTERS_WRITE_UNAVAILABLE",
  nothingToWrite: "CHAPTERS_NOTHING_TO_WRITE",
} as const;
export type BookChaptersErrorCode = (typeof BOOK_CHAPTERS_ERROR_CODES)[keyof typeof BOOK_CHAPTERS_ERROR_CODES];

export const AUDIOBOOK_MANIFEST_SCHEMA = "bookorbit.audiobook-manifest" as const;
export const AUDIOBOOK_MANIFEST_VERSION = 2 as const;

export interface AudiobookManifestAsset {
  assetId: string;
  /** The book file id, matching `BookDetail.files[].id`, so clients can pair an asset with its file. */
  fileId: number;
  sequence: number;
  format: string;
  durationMs: number | null;
  sizeBytes: number | null;
  etag: string;
}

export interface AudiobookManifestChapter {
  id: string;
  title: string;
  assetId: string;
  sequence: number;
  startMs: number;
  endMs: number;
  assetOffsetMs: number;
}

export interface AudiobookManifest {
  schema: typeof AUDIOBOOK_MANIFEST_SCHEMA;
  schemaVersion: typeof AUDIOBOOK_MANIFEST_VERSION;
  revision: string;
  book: {
    id: number;
    title: string;
    authors: string[];
    narrators: string[];
    hasCover: boolean;
  };
  assets: AudiobookManifestAsset[];
  chapters: AudiobookManifestChapter[];
  totalDurationMs: number;
}

export interface AudiobookPlaybackState {
  assetId: string;
  positionMs: number;
  percentage: number;
  completed: boolean;
  capturedAt: string;
  revision: number;
  manifestRevision: string;
}

export interface PutAudiobookPlaybackState {
  assetId: string;
  positionMs: number;
  capturedAt: string;
  operationId: string;
  baseRevision: number;
  manifestRevision: string;
}

export interface AudiobookBookmark {
  id: string;
  bookId: number;
  positionMs: number;
  chapterId: string | null;
  title: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAudiobookBookmark {
  clientId: string;
  positionMs: number;
  chapterId?: string;
  title: string;
  note?: string;
}

export interface UpdateAudiobookBookmark {
  title?: string;
  note?: string | null;
}

export interface NarratorRef {
  id: number;
  name: string;
  sortName: string | null;
  displayOrder: number;
}

export type BookChapterJobKind = "write" | "read" | "revert";
export interface BookChapterJobState {
  id: string;
  kind: BookChapterJobKind;
  status: "queued" | "processing" | "success" | "failed";
  filesWritten: number;
  filesTotal: number;
  result?: WriteBookChaptersResult | EmbeddedBookChapters | BookChaptersState;
  errorCode?: string;
}
