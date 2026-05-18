export const HARDCOVER_GRAPHQL_URL = 'https://api.hardcover.app/v1/graphql';
export const HARDCOVER_MIN_INTERVAL_MS = 1100;
export const HARDCOVER_MAX_RETRIES = 3;

export const HARDCOVER_STATUS = {
  WANT_TO_READ: 1,
  CURRENTLY_READING: 2,
  READ: 3,
  PAUSED: 4,
  DNF: 5,
  IGNORED: 6,
} as const;

export const HARDCOVER_PRIVACY = {
  PUBLIC: 1,
  FOLLOWS: 2,
  PRIVATE: 3,
} as const;

export const HARDCOVER_EVENT = {
  RATING_CHANGED: 'hardcover.rating_changed',
} as const;
