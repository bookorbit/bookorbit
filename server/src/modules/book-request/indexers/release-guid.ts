import { createHash } from 'crypto';

/**
 * The identifier a client sees for a release, and the one a grab names it by.
 *
 * A source guid shaped like a URL or a magnet can carry a credential: a Newznab guid is often the
 * API-keyed details link, a Torznab proxy may reuse the tracker's passkeyed download link, and a
 * private tracker's magnet names its passkeyed announce URL. A digest keeps the identity stable
 * from one search to the next without the value ever leaving the server. Anything else is
 * already an opaque id and passes through unchanged.
 */
export function publicReleaseGuid(indexerId: number, value: string): string {
  if (!/^(https?|magnet):/i.test(value)) return value;
  return createHash('sha256').update(String(indexerId)).update('\0release\0').update(value).digest('hex');
}
