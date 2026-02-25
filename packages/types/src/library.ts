export type OrganizationMode = "auto" | "book_per_file" | "book_per_folder";
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
  watch: boolean;
  autoScanCronExpression?: string | null;
  metadataPrecedence: string[];
  formatPriority: string[];
  allowedFormats: string[];
  organizationMode: OrganizationMode;
  excludePatterns: string[];
  markAsFinishedSecondsRemaining?: number | null;
  markAsFinishedPercentComplete?: number | null;
  fileNamingPattern?: string | null;
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
