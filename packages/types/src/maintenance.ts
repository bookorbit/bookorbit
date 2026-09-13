export const MISSING_RESOURCE_CATEGORIES = ["missing_books", "broken_covers", "orphaned_cover_dirs"] as const;
export type MissingResourceCategory = (typeof MISSING_RESOURCE_CATEGORIES)[number];

export const COVER_SWEEP_STATUSES = ["running", "completed", "failed"] as const;
export type CoverSweepStatus = (typeof COVER_SWEEP_STATUSES)[number];

export type CoverSweep = {
  status: CoverSweepStatus;
  processedBooks: number;
  totalBooks: number | null;
  progressPercent: number | null;
  brokenCovers: number;
  orphanedCoverDirs: number;
  orphanedBytes: number;
  /** True when either result list hit the retention cap; the counts still reflect everything found. */
  truncated: boolean;
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type MissingResourcesSummary = {
  missingBooks: number;
  sweep: CoverSweep | null;
};

export type MissingBookEntry = {
  id: number;
  title: string | null;
  authors: string[];
  libraryId: number;
  libraryName: string;
  folderPath: string;
  formats: string[];
  updatedAt: string | null;
};

export type BrokenCoverEntry = {
  id: number;
  title: string | null;
  authors: string[];
  libraryId: number;
  libraryName: string;
  coverSource: "extracted" | "custom";
};

export type OrphanedCoverDirEntry = {
  bookId: number;
  fileCount: number;
  sizeBytes: number;
};

export type MissingResourcePage<TEntry> = {
  items: TEntry[];
  total: number;
  page: number;
  pageSize: number;
};

export type MissingResourceCleanupRequest = {
  bookIds?: number[];
  all?: boolean;
};

export type MissingResourceCleanupResult = {
  category: MissingResourceCategory;
  requested: number;
  cleaned: number;
  /** Entries that no longer qualified when the cleanup re-verified them. */
  skipped: number;
  /** Entries still matching after this pass. Cleaning "all" works in bounded passes; repeat until zero. */
  remaining: number;
};
