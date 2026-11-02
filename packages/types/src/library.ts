import type { RegexMetadataConfig } from "./regex-metadata";
import type { LibraryLastScan } from "./scanner";

export type OrganizationMode = "book_per_file" | "book_per_folder";
export type CoverAspectRatio = "2/3" | "1/1";
export type AddedAtSource = "imported" | "file_modified" | "file_created";

export function normalizeCoverAspectRatio(value: unknown): CoverAspectRatio {
  return value === "1/1" ? "1/1" : "2/3";
}

export const DEFAULT_FORMAT_PRIORITY = [
  "epub",
  "kepub",
  "pdf",
  "cbz",
  "cbr",
  "cb7",
  "mobi",
  "azw3",
  "azw",
  "fb2",
  "djvu",
  "m4b",
  "mp3",
  "m4a",
  "opus",
  "ogg",
  "flac",
] as const;

export type AccessLevel = "viewer" | "editor" | "owner";

export interface LibraryFolder {
  id: number;
  path: string;
  createdAt: string;
}

export interface Library {
  id: number;
  accessLevel?: AccessLevel | null;
  name: string;
  icon?: string | null;
  displayOrder: number;
  coverAspectRatio: CoverAspectRatio;
  watch: boolean;
  autoScanCronExpression?: string | null;
  metadataPrecedence: string[];
  regexMetadata?: RegexMetadataConfig | null;
  formatPriority: string[];
  allowedFormats: string[];
  organizationMode: OrganizationMode;
  addedAtSource: AddedAtSource;
  excludePatterns: string[];
  readingThreshold: number;
  markAsFinishedPercentComplete: number;
  fileNamingPattern?: string | null;
  fileWriteEnabled: boolean;
  fileWriteWriteCover: boolean;
  fileWriteEpubEnabled: boolean;
  fileWriteEpubMaxFileSizeMb: number;
  fileWriteFb2Enabled: boolean;
  fileWriteFb2MaxFileSizeMb: number;
  fileWritePdfEnabled: boolean;
  fileWritePdfMaxFileSizeMb: number;
  fileWriteCbxEnabled: boolean;
  fileWriteCbxMaxFileSizeMb: number;
  fileWriteKindleEnabled: boolean;
  fileWriteKindleMaxFileSizeMb: number;
  fileWriteAudioEnabled: boolean;
  fileWriteAudioMaxFileSizeMb: number;
  /** Write metadata into every content file of a book, not just its primary file or audio tracks. */
  fileWriteAllFiles: boolean;
  /** EPUBs with synced narration have their own toggle and limit: they embed audio and run large. */
  fileWriteReadAlongEnabled: boolean;
  fileWriteReadAlongMaxFileSizeMb: number;
  fileRenameEnabled: boolean;
  folders: LibraryFolder[];
  bookCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type AddedAtRecomputeFailureCode = "file_unavailable" | "unsafe_path" | "database_error";

export interface AddedAtRecomputeJob {
  id: string;
  libraryId: number;
  source: AddedAtSource;
  status: "running" | "completed" | "failed";
  total: number;
  processed: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  failureSamples: { bookId: number; code: AddedAtRecomputeFailureCode }[];
}

export interface LibraryStats {
  totalBooks: number;
  totalSizeBytes: number;
  formatCounts: Record<string, number>;
}

/**
 * One row of the libraries overview: the same counts `/libraries/:id/stats` returns,
 * plus the library's most recent scan, batched so the settings page needs a single request.
 */
export interface LibraryOverviewEntry extends LibraryStats {
  libraryId: number;
  lastScan: LibraryLastScan | null;
}

export interface PrescanPathResult {
  path: string;
  accessible: boolean;
  fileCount: number;
  overlapLibrary?: string;
  error?: string;
}

export interface PrescanResult {
  paths: PrescanPathResult[];
  totalFiles: number;
}

export interface LibraryAccessEntry {
  userId: number;
  username: string;
  name: string;
  accessLevel: AccessLevel;
}

export interface UserLibraryGrant {
  libraryId: number;
  accessLevel: AccessLevel;
}

export interface DefaultLibraryAccessConfig {
  libraryIds: number[];
}
