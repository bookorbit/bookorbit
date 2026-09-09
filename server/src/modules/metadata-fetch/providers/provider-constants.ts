export const PROVIDER_TIMEOUT_MS = {
  DEFAULT: 10_000,
  SCRAPE: 15_000,
  KOBO_SCRAPE: 30_000,
} as const;

export const PROVIDER_LIMITS = {
  AMAZON_MAX_RESULTS: 3,
  GOODREADS_MAX_RESULTS: 3,
  COMICVINE_MAX_RESULTS: 10,
  RANOBEDB_MAX_RESULTS: 5,
  KOBO_MAX_RESULTS: 3,
  LUBIMYCZYTAC_MAX_RESULTS: 5,
  LIBROFM_MAX_RESULTS: 3,
  MANGABAKA_MAX_RESULTS: 10,
  DEFAULT_SEARCH_RESULTS: 10,
} as const;

/**
 * Soft budget for a provider search that spans many calls. Reaching it aborts the work still in
 * flight, so the margin under the hard provider timeout only has to cover assembling the results
 * that already arrived.
 */
export const PROVIDER_BUDGETS_MS = {
  COMICVINE_SEARCH: PROVIDER_TIMEOUT_MS.SCRAPE - 1_500,
  GOODREADS_SEARCH: PROVIDER_TIMEOUT_MS.SCRAPE - 1_500,
} as const;

/**
 * Goodreads rate-limits book pages with a bare 503 that carries no Retry-After and clears within a
 * few seconds, so it is a per-request hiccup rather than a provider-wide cooldown. Retrying inside
 * the search budget recovers most of them; a fixed longer delay would pay the same cost on every
 * request instead of only the failing ones.
 */
export const PROVIDER_RETRY = {
  GOODREADS_TRANSIENT_ATTEMPTS: 3,
  GOODREADS_TRANSIENT_BACKOFF_MS: [1_200, 2_500],
} as const;

export const PROVIDER_DELAYS_MS = {
  AMAZON_BETWEEN_REQUESTS: 800,
  GOODREADS_BETWEEN_REQUESTS: 600,
  HARDCOVER_RATE_LIMIT: 1_000,
  COMICVINE_VELOCITY_GUARD: 1_000,
  RANOBEDB_BETWEEN_REQUESTS: 500,
  KOBO_BETWEEN_REQUESTS: 700,
  LUBIMYCZYTAC_BETWEEN_REQUESTS: 600,
  LIBROFM_BETWEEN_REQUESTS: 300,
  MANGABAKA_BETWEEN_REQUESTS: 2_000,
} as const;
