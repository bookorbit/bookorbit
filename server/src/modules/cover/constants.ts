export { COVER_CUSTOM_FILE_PREFIX, COVER_EXTRACTED_FILE_PREFIX, COVER_THUMBNAIL_FILE_NAME } from '../../common/book-cover-storage';

export const COVER_PROVIDERS = Symbol('COVER_PROVIDERS');

export const COVER_PROXY_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const COVER_PROXY_TIMEOUT_MS = 10_000;
export const COVER_PROXY_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const COVER_PROXY_MAX_REDIRECTS = 5;
