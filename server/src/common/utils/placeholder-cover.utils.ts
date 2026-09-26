import { createHash } from 'crypto';

/**
 * Fingerprints of the "no cover" image Google Books serves in place of art. It is a full-size
 * portrait PNG, so neither a size floor nor a shape check can tell it from a real jacket.
 */
export const GOOGLE_BOOKS_PLACEHOLDER_LENGTHS: ReadonlySet<number> = new Set([9_103]);
export const GOOGLE_BOOKS_PLACEHOLDER_HASHES: ReadonlySet<string> = new Set(['3efa8c43e5b4348f303a528c81adf435f0111ea752fe9f0f6241478b60987fa6']);

export function isKnownPlaceholderCover(bytes: Buffer): boolean {
  if (!GOOGLE_BOOKS_PLACEHOLDER_LENGTHS.has(bytes.length)) return false;
  return GOOGLE_BOOKS_PLACEHOLDER_HASHES.has(createHash('sha256').update(bytes).digest('hex'));
}
