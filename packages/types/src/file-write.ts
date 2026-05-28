export type WriteResult = {
  status: "success" | "skipped" | "failed";
  fieldsWritten: string[];
  durationMs: number;
  reason?: string;
};

export type LibraryFileSyncProgressEvent =
  | { bookId: number; status: "success" | "failed" | "skipped"; reason?: string }
  | { done: true; processed: number; succeeded: number; failed: number; skipped: number };

export type WriteLogEntry = {
  id: number;
  format: string;
  status: string;
  fieldsWritten: string[];
  triggeredBy: string;
  writtenAt: string;
  durationMs: number | null;
  errorMessage: string | null;
};

export interface FileRenameResult {
  status: "success" | "skipped" | "failed";
  reason?: string;
  oldPath?: string;
  newPath?: string;
  durationMs: number;
}

// ── Bulk Rename ─────────────────────────────────────────────────────────────

export type BulkRenameStatus = "will_rename" | "unchanged" | "collision" | "no_pattern" | "error";

export interface BulkRenamePreviewItem {
  bookId: number;
  title: string;
  currentPath: string;
  newPath: string | null;
  status: BulkRenameStatus;
  reason?: string;
}

export interface BulkRenamePreviewPage {
  items: BulkRenamePreviewItem[];
  total: number;
  totalByStatus: Record<BulkRenameStatus, number>;
}

export type BulkRenameProgressEvent =
  | { bookId: number; status: "success" | "failed" | "skipped"; reason?: string }
  | { done: true; processed: number; succeeded: number; failed: number; skipped: number };
