export const AI_JOBS_LEASE_MS = 2 * 60_000;
export const AI_JOBS_RENEW_MS = 30_000;
export const AI_JOBS_DISPATCH_INTERVAL_MS = 2_000;
export const AI_JOBS_RECOVERY_INTERVAL_MS = 30_000;
export const AI_JOBS_HOUSEKEEPING_INTERVAL_MS = 60_000;
export const AI_JOBS_SWEEP_INTERVAL_MS = 6 * 60 * 60_000;

/** A job that keeps losing its lease (it takes its server down, say) fails instead of looping. */
export const AI_JOBS_MAX_ATTEMPTS = 5;

/** Units of one parallel step in flight at once. The connection's limiter bounds actual requests. */
export const AI_JOBS_UNIT_CONCURRENCY = 12;

/** How often a running job re-reads its own row before a request, to notice a cancel from another server. */
export const AI_JOBS_STATE_CHECK_MS = 1_000;

/** Below this share of finished units, a step fails the job with `low-coverage`. */
export const AI_JOBS_MIN_COVERAGE = 0.9;

/** A unit whose reply is still cut short at this many characters of input is left out as `too-long`. */
export const AI_JOBS_SPLIT_FLOOR_CHARS = 1_000;

/** A build pauses `over-estimate` once it has spent this many times its estimate. */
export const AI_JOBS_OVER_ESTIMATE_FACTOR = 3;

/** A job paused `provider-down` this long fails. */
export const AI_JOBS_PROVIDER_DOWN_GIVE_UP_MS = 24 * 60 * 60_000;

/** Failed jobs leave status after this long. */
export const AI_JOBS_FAILED_VISIBLE_MS = 30 * 24 * 60 * 60_000;

/** Cached units no current artifact or unfinished job uses are removed after this long unused. */
export const AI_JOBS_STEP_CACHE_TTL_MS = 30 * 24 * 60 * 60_000;

export const AI_JOBS_EVENTS_PER_JOB = 300;
export const AI_JOBS_EVENTS_PAGE = 500;
