export type WriteResult = {
  status: 'success' | 'skipped' | 'failed';
  fieldsWritten: string[];
  durationMs: number;
  reason?: string;
};

export type LibraryFileSyncProgressEvent =
  | { bookId: number; status: 'success' | 'failed' | 'skipped'; reason?: string }
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

export interface FormatWriteSettings {
  enabled: boolean;
  maxFileSizeBytes: number;
}

export interface CbxFormatWriteSettings {
  enabled: boolean;
  maxFileSizeBytes: number;
  formats: ('cbz' | 'cb7')[];
}

export interface GlobalFileWriteSettings {
  enabled: boolean;
  writeCover: boolean;
  epub: FormatWriteSettings;
  pdf: FormatWriteSettings;
  cbx: CbxFormatWriteSettings;
}

export const DEFAULT_FILE_WRITE_SETTINGS: GlobalFileWriteSettings = {
  enabled: false,
  writeCover: true,
  epub: { enabled: true, maxFileSizeBytes: 104_857_600 },
  pdf: { enabled: true, maxFileSizeBytes: 104_857_600 },
  cbx: { enabled: false, formats: ['cbz', 'cb7'], maxFileSizeBytes: 524_288_000 },
};

