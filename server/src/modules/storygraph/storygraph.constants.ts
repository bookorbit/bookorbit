export const STORYGRAPH_BASE_URL = 'https://app.thestorygraph.com';
export const STORYGRAPH_MIN_INTERVAL_MS = 1500;
export const STORYGRAPH_REQUEST_TIMEOUT_MS = 30_000;
export const STORYGRAPH_MAX_RETRIES = 2;

export const STORYGRAPH_SESSION_COOKIE_NAME = '_storygraph_session';
export const STORYGRAPH_REMEMBER_COOKIE_NAME = 'remember_user_token';

export const STORYGRAPH_STATUS = {
  WANT_TO_READ: 'to-read',
  CURRENTLY_READING: 'currently-reading',
  REREADING: 'rereading',
  READ: 'read',
  PAUSED: 'paused',
  DID_NOT_FINISH: 'did-not-finish',
} as const;
