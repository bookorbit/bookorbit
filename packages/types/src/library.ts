export type OrganizationMode = "book_per_file" | "book_per_folder";
export type CoverAspectRatio = "2/3" | "1/1";

export const DEFAULT_FORMAT_PRIORITY = [
  "epub",
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

export const FORMAT_LABELS: Record<string, string> = {
  epub: "EPUB e-book",
  pdf: "PDF document",
  cbz: "CBZ comic",
  cbr: "CBR comic",
  cb7: "CB7 comic",
  mobi: "MOBI e-book",
  azw3: "AZW3 e-book",
  azw: "AZW e-book",
  fb2: "FictionBook",
  m4b: "M4B audiobook",
  mp3: "MP3 audio",
  m4a: "M4A audio",
  opus: "Opus audio",
  ogg: "OGG audio",
  flac: "FLAC audio",
};
export type AccessLevel = "viewer" | "editor" | "owner";

export interface LibraryFolder {
  id: number;
  path: string;
  createdAt: string;
}

export interface Library {
  id: number;
  name: string;
  icon?: string | null;
  displayOrder: number;
  coverAspectRatio: CoverAspectRatio;
  watch: boolean;
  autoScanCronExpression?: string | null;
  metadataPrecedence: string[];
  formatPriority: string[];
  allowedFormats: string[];
  organizationMode: OrganizationMode;
  excludePatterns: string[];
  readingThreshold: number;
  markAsFinishedPercentComplete: number;
  fileNamingPattern?: string | null;
  fileWriteEnabled: boolean;
  fileWriteWriteCover: boolean;
  fileWriteEpubEnabled: boolean;
  fileWriteEpubMaxFileSizeMb: number;
  fileWritePdfEnabled: boolean;
  fileWritePdfMaxFileSizeMb: number;
  fileWriteCbxEnabled: boolean;
  fileWriteCbxMaxFileSizeMb: number;
  folders: LibraryFolder[];
  bookCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryStats {
  totalBooks: number;
  totalSizeBytes: number;
  formatCounts: Record<string, number>;
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
