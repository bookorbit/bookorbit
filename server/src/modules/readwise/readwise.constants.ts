export const READWISE_BASE_URL = 'https://readwise.io/api/v2';
export const READWISE_HIGHLIGHTS_URL = `${READWISE_BASE_URL}/highlights/`;
export const READWISE_AUTH_URL = `${READWISE_BASE_URL}/auth/`;

// Rate limit is 240 req/min for highlights CREATE → ~250ms between requests, keep margin.
export const READWISE_MIN_INTERVAL_MS = 300;
export const READWISE_MAX_RETRIES = 3;
export const READWISE_AUTO_SYNC_DEBOUNCE_MS = 1000;
export const READWISE_AUTO_SYNC_MAX_WAIT_MS = 5000;
export const READWISE_AUTO_SYNC_RETRY_BASE_MS = 30_000;
export const READWISE_AUTO_SYNC_MAX_RETRIES = 5;
export const READWISE_REQUEST_TIMEOUT_MS = 15_000;

// Readwise field length caps (from readwise.io/api_deets).
export const READWISE_MAX = {
  TEXT: 8191,
  TITLE: 511,
  AUTHOR: 1024,
  NOTE: 8191,
  HIGHLIGHT_URL: 4095,
} as const;

export const READWISE_SOURCE_TYPE = 'bookorbit';
export const READWISE_CATEGORY = 'books';

export function bookOrbitReadwiseHighlightUrl(appUrl: string, bookId: number, annotationId: number): string {
  return `${appUrl.replace(/\/+$/, '')}/book/${bookId}?tab=highlights&annotationId=${annotationId}`;
}

// Public cover URL by ISBN. `?default=false` makes OpenLibrary return 404 for a
// missing cover (Readwise then stores no image) instead of a blank placeholder pixel.
export const OPENLIBRARY_COVER_BASE = 'https://covers.openlibrary.org/b/isbn';
export function openLibraryCoverUrl(isbn: string): string {
  return `${OPENLIBRARY_COVER_BASE}/${isbn}-L.jpg?default=false`;
}

// How many highlights to send per POST (Readwise accepts large batches; keep bounded).
export const READWISE_BATCH_SIZE = 100;
