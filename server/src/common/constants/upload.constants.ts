export const DEFAULT_MAX_UPLOAD_SIZE_MB = 500;
export const HARD_MAX_UPLOAD_SIZE_MB = 4_096;
export const HARD_MAX_UPLOAD_BYTES = HARD_MAX_UPLOAD_SIZE_MB * 1_024 * 1_024;
export const UPLOAD_CHUNK_SIZE_BYTES = 16 * 1_024 * 1_024;
export const UPLOAD_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const UPLOAD_SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const MAX_BUFFERED_METADATA_BYTES = 128 * 1_024 * 1_024;

export const FORMATS_WITH_UNBOUNDED_METADATA_READS = new Set(['mobi', 'azw', 'azw3', 'cbr', 'cb7', 'fb2', 'pdf']);
