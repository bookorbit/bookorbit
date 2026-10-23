import type { MetadataCacheNamespace } from '@bookorbit/types';

export const METADATA_CACHE_CONFIG_KEY = 'metadata_cache_config';
export const METADATA_CACHE_CLEAR_MARKERS_KEY = 'metadata_cache_clear_markers';

/** Bumped on a breaking change to the stored candidate shape of a namespace. */
export const CACHE_SCHEMA_VERSION: Record<MetadataCacheNamespace, number> = { book: 1, author: 1 };

export const MAX_ENTRY_BYTES = 512 * 1024;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const CONFIG_MEMO_MS = 10 * SECOND;

/** Pre-release and just-released metadata churns, so such answers are kept for less time. */
export const NEW_RELEASE_WINDOW_MS = 60 * DAY;
export const NEW_RELEASE_TTL_CAP_MS = 3 * DAY;

export const ACCESS_FLUSH_INTERVAL_MS = MINUTE;
export const ACCESS_TOUCH_STALE_MS = 6 * HOUR;
export const ACCESS_MAX_TRACKED_KEYS = 10_000;

export const SWEEP_INTERVAL_MS = 6 * HOUR;
export const SWEEP_BATCH_SIZE = 1000;
export const SWEEP_TIME_BUDGET_MS = 60 * SECOND;
export const SWEEP_LONG_STATEMENT_TIMEOUT_MS = 30 * SECOND;
export const CLEAR_SYNC_BUDGET_MS = 2 * SECOND;
/** A clear marker only has to outlive operations that started before it. */
export const CLEAR_MARKER_RETENTION_MS = 15 * MINUTE;

/** Sweep when live payload passes this share of the budget, and evict down to the lower one. */
export const BUDGET_SWEEP_THRESHOLD = 0.9;
export const BUDGET_EVICT_TARGET = 0.8;

/**
 * The cache has its own small pool so a burst of concurrent provider lookups can never take the
 * connections the rest of the app needs, and so a slow read is cancelled by Postgres rather than
 * abandoned by a JS timer.
 */
export const CACHE_POOL = {
  max: 4,
  statementTimeoutMs: 1000,
  connectionTimeoutMs: 250,
  idleTimeoutMs: 30 * SECOND,
} as const;
