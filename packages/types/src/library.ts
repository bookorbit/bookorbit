import type { LibraryLastScan } from "./scanner";

export type OrganizationMode = "book_per_file" | "book_per_folder";
export type CoverAspectRatio = "2/3" | "1/1";
export type AddedAtSource = "imported" | "file_modified" | "file_created";
export type LibraryType = "books" | "podcasts";

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
  "m4b",
  "mp3",
  "m4a",
  "opus",
  "ogg",
  "flac",
] as const;

export type AccessLevel = "viewer" | "editor" | "owner";

/**
 * Who owns the files under a library root. `downloads` roots belong to BookOrbit, which names,
 * evicts, and re-fetches files there. `local` roots belong to the user: files are adopted in place,
 * never renamed and never evicted. Book libraries only use `downloads`.
 */
export type LibraryFolderRole = "downloads" | "local";

export const LIBRARY_FOLDER_ROLES: readonly LibraryFolderRole[] = ["downloads", "local"] as const;

export interface LibraryFolder {
  id: number;
  path: string;
  role: LibraryFolderRole;
  createdAt: string;
}

export interface Library {
  id: number;
  type: LibraryType;
  accessLevel?: AccessLevel | null;
  name: string;
  icon?: string | null;
  displayOrder: number;
  coverAspectRatio: CoverAspectRatio;
  watch: boolean;
  watchLocalFolders?: boolean;
  autoScanCronExpression?: string | null;
  metadataPrecedence: string[];
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
  fileRenameEnabled: boolean;
  folders: LibraryFolder[];
  bookCount?: number;
  /** Non-archived shows in a podcast library. Null for book libraries, which hold no shows. */
  podcastCount?: number | null;
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

export interface DefaultLibraryAccessConfig {
  libraryIds: number[];
}
