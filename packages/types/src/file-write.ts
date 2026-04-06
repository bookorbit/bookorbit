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

