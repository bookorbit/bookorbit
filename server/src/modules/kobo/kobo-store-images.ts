const KOBO_IMAGE_CDN_ORIGIN = 'https://cdn.kobo.com';
const KOBO_IMAGE_CDN_HOSTNAME = 'cdn.kobo.com';
const KOBO_IMAGE_CDN_PATH = '/book-images';

/**
 * Builds the Kobo CDN URL for a cover BookOrbit does not own.
 *
 * Initialization rewrites image_url_template to point at BookOrbit so local covers resolve, which
 * means the device also asks us for store-owned covers we have never heard of. Those live on the
 * image CDN advertised as image_host in KOBO_STORE_RESOURCES, not on storeapi.kobo.com, so the
 * generic proxy cannot reach them and every store cover 404s.
 *
 * Returns null when the request cannot be mapped onto a CDN path, so callers 404 rather than
 * redirect somewhere unintended.
 */
export function buildKoboStoreImageUrl(imageId: string, segments: readonly string[]): string | null {
  const parts = [imageId, ...segments];
  if (parts.some((part) => part.trim().length === 0)) return null;

  const path = parts.map((part) => encodeURIComponent(part)).join('/');
  const url = new URL(`${KOBO_IMAGE_CDN_PATH}/${path}/image.jpg`, KOBO_IMAGE_CDN_ORIGIN);
  if (url.hostname !== KOBO_IMAGE_CDN_HOSTNAME) return null;

  return url.toString();
}
