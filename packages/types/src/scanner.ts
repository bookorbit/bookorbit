export type ScanJobStatus = "running" | "completed" | "failed";
export type ScanTriggeredBy = "manual" | "watcher" | "schedule";

/** The last recorded scan_jobs row for a library, or null when it has never been scanned. */
export interface LibraryLastScan {
  status: ScanJobStatus;
  triggeredBy: ScanTriggeredBy;
  startedAt: string;
  completedAt: string | null;
  addedCount: number;
  updatedCount: number;
  missingCount: number;
  errorMessage: string | null;
}

/** One row of a library's scan_jobs history, newest first. */
export interface LibraryScanHistoryEntry extends LibraryLastScan {
  id: number;
}

export interface ScanProgressEvent {
  jobId: number;
  libraryId: number;
  status: ScanJobStatus;
  processed: number;
  total: number;
  added: number;
  updated: number;
  missing: number;
  errorMessage?: string;
}

export interface CoverRefreshProgressEvent {
  libraryId: number;
  processed: number;
  total: number;
  status: "running" | "completed";
}

export interface CoverRefreshedEvent {
  bookId: number;
  libraryId: number;
}

export interface BookMissingEvent {
  libraryId: number;
  bookIds: number[];
}

export interface BookRestoredEvent {
  libraryId: number;
  bookIds: number[];
}

export interface BookMovedEvent {
  libraryId: number;
  bookIds: number[];
}

export interface BookTransferredEvent {
  fromLibraryId: number;
  toLibraryId: number;
  bookIds: number[];
}

export interface BookProgressChangedEvent {
  bookId: number;
  progress: number;
  source: "koreader" | "kobo" | "web_reader";
}

export interface ScanBooksAddedEvent {
  libraryId: number;
  books: import("./book").BookCard[];
}
