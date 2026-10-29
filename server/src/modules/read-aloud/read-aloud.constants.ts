export const READ_ALOUD_LEASE_MS = 5 * 60_000;
export const READ_ALOUD_HEARTBEAT_MS = 30_000;
export const READ_ALOUD_DISPATCH_INTERVAL_MS = 2_000;
export const READ_ALOUD_POLL_INTERVAL_MS = 1_500;

/** How long the worker may stay unreachable before a running job counts a failed attempt. */
export const READ_ALOUD_UNREACHABLE_WINDOW_MS = 30 * 60_000;
export const READ_ALOUD_UNREACHABLE_BACKOFF_MS = [5_000, 10_000, 30_000, 60_000] as const;
export const READ_ALOUD_MAX_ATTEMPTS = 4;
/** Worker restarts one run rides out by resubmitting; past this the run counts as a failed attempt. */
export const READ_ALOUD_MAX_RESUBMITS = 3;
export const READ_ALOUD_CANCEL_WAIT_MS = 60_000;

export const READ_ALOUD_REVIEW_TTL_MS = 14 * 24 * 60 * 60_000;
export const READ_ALOUD_REVIEW_REMINDER_BEFORE_MS = 7 * 24 * 60 * 60_000;
export const READ_ALOUD_FAILED_WORK_TTL_MS = 7 * 24 * 60 * 60_000;

export const READ_ALOUD_EVENTS_PER_JOB = 200;
export const READ_ALOUD_EVENTS_PAGE = 500;
export const READ_ALOUD_MAX_REPORT_BYTES = 16 * 1024 * 1024;
