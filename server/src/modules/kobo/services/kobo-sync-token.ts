// Older BookOrbit tokens, still sent back by devices that last synced before the Kobo-standard shape.
const TOKEN_PREFIX = 'PX.';
const COMPACT_TOKEN_PREFIX = 'PX2.';

// A Kobo on firmware 4.45 was reported failing every sync on BookOrbit's prefixed token and passing
// on Calibre-Web's (#1175), so a device is only ever handed a shape Kobo devices are known to take:
// Kobo's own cursor verbatim, or the base64 JSON token Calibre-Web has always sent. The token
// identifies no snapshot; the sync service finds that by device.
const CALIBRE_WEB_TOKEN_VERSION = '1-1-0';
const CALIBRE_WEB_EPOCH_FLOOR = -62135596800;

// Kobo's own sync tokens are opaque and we round-trip them through the device, so a hostile or
// corrupted upstream value cannot be allowed to grow the response header without bound. A small
// store library already produces a 3,300 character cursor and continuation pages carry more, so this
// leaves room for those while the whole header stays under the common 8 KB proxy line limit.
// Anything larger is dropped, and store paging for that sync stops instead of restarting.
const MAX_KOBO_SYNC_TOKEN_LENGTH = 7000;

export type KoboSyncTokenParts = {
  koboSyncToken?: string;
};

/**
 * Whether an upstream cursor is small enough to carry. Callers holding a logger should check this
 * before handing a cursor over, because dropping one silently restarts store paging from scratch.
 */
export function isUsableKoboSyncToken(koboSyncToken: string): boolean {
  return koboSyncToken.length > 0 && koboSyncToken.length <= MAX_KOBO_SYNC_TOKEN_LENGTH;
}

export function encodeSyncToken(koboSyncToken?: string): string {
  if (koboSyncToken && isUsableKoboSyncToken(koboSyncToken)) return koboSyncToken;
  return Buffer.from(
    JSON.stringify({
      version: CALIBRE_WEB_TOKEN_VERSION,
      data: {
        raw_kobo_store_token: '',
        books_last_modified: CALIBRE_WEB_EPOCH_FLOOR,
        books_last_created: CALIBRE_WEB_EPOCH_FLOOR,
        archive_last_modified: CALIBRE_WEB_EPOCH_FLOOR,
        reading_state_last_modified: CALIBRE_WEB_EPOCH_FLOOR,
        tags_last_modified: CALIBRE_WEB_EPOCH_FLOOR,
      },
    }),
  ).toString('base64');
}

/**
 * Reads the upstream cursor out of whatever token the device sends back: Kobo's own, a Calibre-Web
 * shaped one (ours, or one left by Calibre-Web before BookOrbit was put in the path), or an older
 * BookOrbit `PX.` / `PX2.` token. None of them may throw: a token we cannot read costs a store page,
 * never a broken sync.
 */
export function decodeSyncToken(raw: string | undefined): KoboSyncTokenParts {
  const value = raw?.trim();
  if (!value) return {};
  if (value.startsWith(COMPACT_TOKEN_PREFIX)) {
    const rest = value.slice(COMPACT_TOKEN_PREFIX.length);
    const separator = rest.indexOf('.');
    return usableCursor(separator === -1 ? '' : rest.slice(separator + 1));
  }
  if (value.startsWith(TOKEN_PREFIX)) {
    const decoded = parseBase64Json(value.slice(TOKEN_PREFIX.length));
    return usableCursor(decoded?.koboSyncToken);
  }
  const calibreWeb = parseBase64Json(value);
  if (calibreWeb && typeof calibreWeb.data === 'object' && calibreWeb.data !== null && !Array.isArray(calibreWeb.data)) {
    return usableCursor((calibreWeb.data as Record<string, unknown>).raw_kobo_store_token);
  }
  return usableCursor(value);
}

/**
 * Re-stamps a token minted by KoboSyncService with the upstream cursor, which then travels alone.
 * Returns the token unchanged when there is no upstream cursor to carry.
 */
export function withKoboSyncToken(compositeToken: string, koboSyncToken: string | undefined): string {
  if (!koboSyncToken || !isUsableKoboSyncToken(koboSyncToken)) return compositeToken;
  return encodeSyncToken(koboSyncToken);
}

function usableCursor(value: unknown): KoboSyncTokenParts {
  return typeof value === 'string' && isUsableKoboSyncToken(value) ? { koboSyncToken: value } : {};
}

// Kobo's own cursor is dotted base64url, which never parses to a JSON object here.
function parseBase64Json(value: string): Record<string, unknown> | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
    return decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? (decoded as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
